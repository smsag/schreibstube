/**
 * Getting the search runtime's WebAssembly onto the device: a download from
 * the plugin's release, a check against the pin, and a write beside the plugin.
 *
 * Platform only — `requestUrl`, the vault's adapter, `crypto.subtle`. Which
 * bytes are the right bytes is decided in `services/semantic/search-runtime.ts`
 * and tested there.
 */
import { requestUrl, type App } from "obsidian";
import { t } from "../../../i18n";
import type { Logger } from "../../../services/logger";
import {
  checkSearchRuntime,
  checkSearchRuntimeSize,
  MAX_SEARCH_RUNTIME_BYTES,
  SEARCH_RUNTIME_DEADLINE_MS,
  SearchRuntimeError,
  searchRuntimePath,
  searchRuntimeUrl,
  staleSearchRuntimeFiles
} from "../../../services/semantic/search-runtime";
import { sha256 } from "../../../utils/sha256";
import { withTimeout } from "../../../utils/with-timeout";

export class SearchRuntimeLoader {
  /** The acquisition in flight, shared by whoever asks while it runs. */
  private inflight: Promise<ArrayBuffer> | null = null;

  constructor(
    private readonly app: App,
    private readonly pluginDir: string,
    private readonly pluginVersion: string,
    private readonly logger: Pick<Logger, "warn" | "debug">
  ) {}

  /**
   * The checked bytes, read anew for each load that asks. Kept by nobody
   * between loads: 14 MB held in the plugin's own heap for a module that is
   * already running in a worker is memory a phone does not have to spare.
   */
  bytes(): Promise<ArrayBuffer> {
    this.inflight ??= this.acquire().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /**
   * From beside the plugin when the file there is still the pinned one,
   * otherwise from the release. A cached file is checked like a downloaded
   * one: it sits in a folder a person, a sync client or another plugin can
   * write to, and "it worked yesterday" is not a reason to run it today.
   */
  private async acquire(): Promise<ArrayBuffer> {
    const path = searchRuntimePath(this.pluginDir);
    const adapter = this.app.vault.adapter;

    if (await adapter.exists(path)) {
      // The length is read from the folder first, so a file that cannot be
      // the runtime is refused without spending the memory to hash it.
      const stat = await adapter.stat(path);
      let problem = checkSearchRuntimeSize(stat?.size ?? -1);
      if (problem === null) {
        const cached = await adapter.readBinary(path);
        problem = await problemWith(cached);
        if (problem === null) return cached;
      }
      this.logger.warn(`semantic engine: cached search runtime rejected — ${problem}`);
    }

    const downloaded = await this.download();
    const problem = await problemWith(downloaded);
    if (problem !== null) throw new SearchRuntimeError(t().semantic.runtime.mismatch(problem));
    await adapter.writeBinary(path, downloaded);
    await this.removeStale();
    return downloaded;
  }

  private async download(): Promise<ArrayBuffer> {
    const strings = t().semantic.runtime;
    const url = searchRuntimeUrl(this.pluginVersion);
    this.logger.debug(`semantic engine: fetching ${url}`);

    let response: Awaited<ReturnType<typeof requestUrl>>;
    try {
      response = await withTimeout(
        requestUrl({ url, method: "GET", throw: false }),
        SEARCH_RUNTIME_DEADLINE_MS,
        (seconds) => strings.slow(seconds)
      );
    } catch (error) {
      throw new SearchRuntimeError(
        strings.unreachable(error instanceof Error ? error.message : String(error)),
        { cause: error }
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SearchRuntimeError(strings.unreachable(`HTTP ${response.status}`));
    }
    // `requestUrl` hands over the whole body or nothing, so the bound is
    // applied as soon as it can be: before the bytes are hashed or written.
    const body = response.arrayBuffer;
    if (body.byteLength > MAX_SEARCH_RUNTIME_BYTES) {
      throw new SearchRuntimeError(
        strings.mismatch(`${body.byteLength} bytes, more than ${MAX_SEARCH_RUNTIME_BYTES}`)
      );
    }
    return body;
  }

  /** Runtimes of earlier versions, which nothing will load again. */
  private async removeStale(): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      const listed = await adapter.list(this.pluginDir);
      const names = listed.files.map((path) => path.slice(path.lastIndexOf("/") + 1));
      for (const name of staleSearchRuntimeFiles(names)) {
        await adapter.remove(`${this.pluginDir.replace(/\/+$/, "")}/${name}`);
      }
    } catch (error) {
      // A stale file costs disk, not correctness; the next load tries again.
      this.logger.warn("semantic engine: an earlier search runtime could not be removed", error);
    }
  }
}

async function problemWith(bytes: ArrayBuffer): Promise<string | null> {
  return checkSearchRuntime(bytes.byteLength, await sha256(new Uint8Array(bytes)));
}
