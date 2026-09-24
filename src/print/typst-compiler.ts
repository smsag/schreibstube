/**
 * Getting the typesetter onto the device, and running it.
 *
 * Two jobs that look like one. Acquiring the runtime is a download, a hash
 * check and a write, done once per device and per pinned version. Running it
 * is instantiating a WebAssembly module in a worker and handing it a job.
 *
 * Both live here rather than in a service because both are entirely platform:
 * `requestUrl`, the vault's adapter, `crypto.subtle`, `Worker`. What can be
 * decided without any of those — which bytes are the right bytes, what the
 * compiler's answer means — is decided in `services/typst-runtime.ts` and
 * tested there.
 */
import { toArrayBuffer } from "../utils/array-buffer";
import { withTimeout } from "../utils/with-timeout";
import { requestUrl, type App } from "obsidian";
import { WORKER_SOURCE } from "./typst-worker";
import type { Logger } from "../services/logger";
import type { PrintJob } from "../services/print-job";
import { MAIN_FILE } from "../services/print-job";
import { COMPILE_TIMEOUT_MS } from "../services/print-template";
import {
  checkRuntimeBytes,
  LOADER_ASSET,
  readCompileResult,
  RUNTIME_ASSETS,
  runtimeAssetUrl,
  runtimeCachePath,
  RUNTIME_MEGABYTES,
  staleRuntimeFiles,
  toHex,
  WASM_ASSET,
  type CompileOutcome,
  type RuntimeAsset
} from "../services/typst-runtime";

/** How long the runtime's download may take before it is called a failure. */
const DOWNLOAD_TIMEOUT_MS = 180_000;

/** Said while a person waits, so a long first print explains itself. */
export type ProgressReport = (message: string) => void;

export interface RuntimeStrings {
  downloading: (label: string, megabytes: number) => string;
  verifying: string;
  starting: string;
  compiling: string;
  mismatch: (detail: string) => string;
  unreachable: (detail: string) => string;
  timeout: (seconds: number) => string;
}

interface Pending {
  resolve: (value: WorkerReply) => void;
  reject: (error: Error) => void;
  timer: number;
}

interface WorkerReply {
  ok: boolean;
  pdf?: Uint8Array;
  diagnostics?: unknown[];
  error?: string;
}

export class TypstCompiler {
  private module: WebAssembly.Module | null = null;
  private loader: string | null = null;
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly app: App,
    private readonly pluginDir: string,
    private readonly pluginVersion: string,
    private readonly strings: RuntimeStrings,
    private readonly logger: Logger
  ) {}

  /**
   * Compile a job to PDF.
   *
   * The runtime is acquired on the first call and kept for the session, so the
   * second print of a working day costs the compile and nothing else.
   */
  async compile(job: PrintJob, progress: ProgressReport): Promise<CompileOutcome> {
    await this.load(progress);
    progress(this.strings.compiling);

    const sources: { path: string; text: string }[] = [{ path: `/${MAIN_FILE}`, text: job.main }];
    const binaries: { path: string; bytes: Uint8Array }[] = [];

    for (const file of job.files) {
      if (file.path.endsWith(".typ")) {
        sources.push({ path: `/${file.path}`, text: new TextDecoder().decode(file.bytes) });
      } else {
        binaries.push({ path: `/${file.path}`, bytes: file.bytes });
      }
    }

    const reply = await this.request(
      "compile",
      { main: `/${MAIN_FILE}`, fonts: job.fonts, sources, binaries },
      COMPILE_TIMEOUT_MS
    );

    if (reply.pdf) return readCompileResult(reply.pdf);
    return readCompileResult({ diagnostics: reply.diagnostics ?? [] });
  }

  /**
   * Fetch and check the typesetter without setting anything.
   *
   * So that somebody who has just switched printing on can spend the download
   * while they are on wifi and thinking about it, rather than meeting it in
   * the middle of their first print on a train.
   */
  async prepare(progress: ProgressReport): Promise<void> {
    await this.load(progress);
  }

  /** Whether the runtime is already on this device, so a command can say so. */
  async isInstalled(): Promise<boolean> {
    for (const asset of RUNTIME_ASSETS) {
      if (!(await this.app.vault.adapter.exists(runtimeCachePath(this.pluginDir, asset)))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Take the typesetter off the device.
   *
   * Somebody switching printing off has 28 MB sitting in their vault folder
   * for a feature they stopped using, and no way to see it from inside the app.
   * Removing it is safe: the next print fetches and checks it again.
   */
  async remove(): Promise<void> {
    this.dispose();
    const adapter = this.app.vault.adapter;
    for (const asset of RUNTIME_ASSETS) {
      const path = runtimeCachePath(this.pluginDir, asset);
      try {
        if (await adapter.exists(path)) await adapter.remove(path);
      } catch (error) {
        this.logger.warn(`print: ${asset.name} could not be removed`, error);
      }
    }
    await this.removeStale();
  }

  /** Runtimes of earlier pinned versions, which nothing will load again. */
  private async removeStale(): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      const listed = await adapter.list(this.pluginDir);
      const names = listed.files.map((path) => path.split("/").pop() ?? "");
      for (const name of staleRuntimeFiles(names)) {
        await adapter.remove(`${this.pluginDir.replace(/\/+$/, "")}/${name}`);
      }
    } catch (error) {
      this.logger.warn("print: an earlier runtime could not be removed", error);
    }
  }

  /** Let go of the worker and the module; the next print starts them again. */
  dispose(): void {
    this.stopWorker();
    this.ready = null;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("printing was stopped"));
    }
    this.pending.clear();
  }

  /** The thread and the URL it was started from, both let go. */
  private stopWorker(): void {
    this.worker?.terminate();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.worker = null;
    this.workerUrl = null;
  }

  /** One acquisition at a time, however many prints ask for it at once. */
  private load(progress: ProgressReport): Promise<void> {
    this.ready ??= this.acquire(progress).catch((error: unknown) => {
      // A failed load must not be remembered as done: the next print tries again.
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async acquire(progress: ProgressReport): Promise<void> {
    const wasm = await this.bytesOf(WASM_ASSET, progress);
    const loader = await this.bytesOf(LOADER_ASSET, progress);

    progress(this.strings.starting);
    this.module ??= await WebAssembly.compile(wasm as BufferSource);
    this.loader = new TextDecoder().decode(loader);

    // A start that failed leaves a thread and a blob URL behind unless they
    // are let go before the next attempt takes their place.
    this.stopWorker();
    this.worker = this.startWorker();
    await this.request("init", { module: this.module, loader: this.loader }, DOWNLOAD_TIMEOUT_MS);
    await this.removeStale();
  }

  /**
   * The asset's bytes: from beside the plugin if they are there and still what
   * they should be, otherwise from the release.
   *
   * A cached file is hashed as well as a downloaded one. It sits in a folder a
   * person can open, and "it worked yesterday" is not a reason to run whatever
   * is there today.
   */
  private async bytesOf(asset: RuntimeAsset, progress: ProgressReport): Promise<Uint8Array> {
    const path = runtimeCachePath(this.pluginDir, asset);
    const adapter = this.app.vault.adapter;

    if (await adapter.exists(path)) {
      const cached = new Uint8Array(await adapter.readBinary(path));
      const problem = checkRuntimeBytes(asset, await sha256(cached));
      if (problem === null) return cached;
      this.logger.warn(`print: cached runtime rejected — ${problem}`);
    }

    const downloaded = await this.download(asset, progress);
    progress(this.strings.verifying);

    const problem = checkRuntimeBytes(asset, await sha256(downloaded));
    if (problem !== null) throw new Error(this.strings.mismatch(problem));

    await adapter.writeBinary(path, toArrayBuffer(downloaded));
    return downloaded;
  }

  private async download(asset: RuntimeAsset, progress: ProgressReport): Promise<Uint8Array> {
    const url = runtimeAssetUrl(this.pluginVersion, asset);
    progress(this.strings.downloading(asset.label, Math.round(megabytesOf(asset))));
    this.logger.debug(`print: fetching ${url}`);

    let response: Awaited<ReturnType<typeof requestUrl>>;
    try {
      response = await withTimeout(
        requestUrl({ url, method: "GET", throw: false }),
        DOWNLOAD_TIMEOUT_MS,
        (seconds) => this.strings.timeout(seconds)
      );
    } catch (error) {
      throw new Error(
        this.strings.unreachable(error instanceof Error ? error.message : String(error)),
        { cause: error }
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(this.strings.unreachable(`HTTP ${response.status}`));
    }
    return new Uint8Array(response.arrayBuffer);
  }

  private startWorker(): Worker {
    // Built from its own source text, because a plugin has no URL to start a
    // worker from. Revoked when the compiler is let go.
    const blob = new Blob([WORKER_SOURCE], { type: "text/javascript" });
    this.workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(this.workerUrl, { type: "module" });

    worker.onmessage = (event: MessageEvent<WorkerReply & { id: number }>) => {
      const { id, ...reply } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      window.clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply);
      else pending.reject(new Error(reply.error ?? "the compiler failed"));
    };

    worker.onerror = (event: ErrorEvent) => {
      this.fail(new Error(event.message || "the compiler thread stopped"));
    };
    // A reply that cannot be read carries no id to answer, so whatever was
    // waiting would otherwise wait out its whole deadline for nothing.
    worker.onmessageerror = () => {
      this.fail(new Error("the compiler answered in a form that could not be read"));
    };

    return worker;
  }

  /** Everything waiting is told why, and the thread is let go. */
  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.dispose();
  }

  private request(kind: string, payload: unknown, timeoutMs: number): Promise<WorkerReply> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("the compiler is not running"));

    const id = this.nextId++;
    return new Promise<WorkerReply>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        // A compile that has not finished by now is not going to, and the
        // thread it is on cannot be interrupted — so it is thrown away.
        this.dispose();
        reject(new Error(`the compiler did not finish within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, kind, payload });
    });
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)));
}

function megabytesOf(asset: RuntimeAsset): number {
  return asset.label === "compiler" ? RUNTIME_MEGABYTES : 1;
}
