import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmbeddingBackend } from "../../../services/semantic/embedding-provider";

// Which constructed provider should fail `ready()`. The factory news these up
// itself (no injection), so the modules are mocked rather than the instances.
const fail = { blobWorker: false, resourceWorker: false, iframe: false };
/** When set, a backend's `ready()` blocks until the test releases it (#363). */
const hold: { release: (() => void) | null; on: string | null } = { release: null, on: null };
/** Every backend instance that was told to unload — the model's only release. */
const unloaded: string[] = [];
/** The message a failing backend throws, when a test needs a specific one. */
const failWith: { message: string | null; error: Error | null } = { message: null, error: null };
const built: string[] = [];
/** Backends that failed after they were ready (a Worker's error event). */
const dead = new Set<string>();

vi.mock("./worker-embedding-provider", () => ({
  WorkerEmbeddingProvider: class {
    readonly dim = 4;
    private readonly kind: string;
    constructor(_id: string, _runtime: unknown, _p?: unknown, spawnUrl?: () => Promise<string>) {
      this.kind = spawnUrl ? "resourceWorker" : "blobWorker";
      built.push(this.kind);
    }
    async ready(): Promise<void> {
      if (hold.on === this.kind)
        await new Promise<void>((r) => {
          hold.release = r;
        });
      if (fail[this.kind as "blobWorker" | "resourceWorker"])
        throw failWith.error ?? new Error(failWith.message ?? `${this.kind} unavailable`);
    }
    async embed(): Promise<Float32Array[]> {
      return [];
    }
    isOffThread(): boolean {
      return true;
    }
    isAlive(): boolean {
      return !dead.has(this.kind);
    }
    unload(): void {
      unloaded.push(this.kind);
    }
  }
}));

vi.mock("./iframe-embedding-provider", () => ({
  IframeEmbeddingProvider: class {
    readonly dim = 4;
    constructor() {
      built.push("iframe");
    }
    async ready(): Promise<void> {
      if (hold.on === "iframe")
        await new Promise<void>((r) => {
          hold.release = r;
        });
      if (fail.iframe) throw new Error("iframe unavailable");
    }
    async embed(): Promise<Float32Array[]> {
      return [];
    }
    isOffThread(): boolean {
      return false;
    }
    unload(): void {
      unloaded.push("iframe");
    }
  }
}));

import { createEmbeddingProvider } from "./embedding-provider-factory";

/** The runtime's bytes; the mocked backends never read them. */
const runtime = async (): Promise<ArrayBuffer> => new ArrayBuffer(8);
import { DEFAULT_EMBEDDING_MODEL_ID } from "../../../services/semantic/embedding-models";
import { SearchRuntimeError } from "../../../services/semantic/search-runtime";

const make = (): {
  provider: ReturnType<typeof createEmbeddingProvider>;
  seen: EmbeddingBackend[];
} => {
  const seen: EmbeddingBackend[] = [];
  const provider = createEmbeddingProvider(
    DEFAULT_EMBEDDING_MODEL_ID,
    runtime,
    undefined,
    async () => "app://resource/worker.mjs",
    (b) => seen.push(b)
  );
  return { provider, seen };
};

beforeEach(() => {
  fail.blobWorker = false;
  fail.resourceWorker = false;
  fail.iframe = false;
  failWith.message = null;
  failWith.error = null;
  built.length = 0;
  hold.on = null;
  hold.release = null;
  unloaded.length = 0;
  dead.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("FallbackEmbeddingProvider — which backend started (Pythia ADR-182)", () => {
  it("reports the blob Worker when it starts, and never builds the others", async () => {
    const { provider, seen } = make();
    await provider.ready();
    expect(seen).toEqual(["worker (blob)"]);
    expect(built).toEqual(["blobWorker"]);
  });

  it("falls through to the resource Worker and says so", async () => {
    fail.blobWorker = true;
    const { provider, seen } = make();
    await provider.ready();
    expect(seen).toEqual(["worker (resource)"]);
    expect(provider.isOffThread?.()).toBe(true); // still off the UI thread
    expect(built).toEqual(["blobWorker", "resourceWorker"]);
  });

  it("names the iframe when BOTH Workers are refused — the slow path, no longer silent", async () => {
    fail.blobWorker = true;
    fail.resourceWorker = true;
    const { provider, seen } = make();
    await provider.ready();
    expect(seen).toEqual(["iframe (UI thread)"]);
    expect(provider.isOffThread?.()).toBe(false);
  });

  it("tries the three backends in order, and only as far as it must", async () => {
    fail.blobWorker = true;
    fail.resourceWorker = true;
    const { provider } = make();
    await provider.ready();
    expect(built).toEqual(["blobWorker", "resourceWorker", "iframe"]);
  });

  it("reports nothing before ready() has resolved", () => {
    const { provider, seen } = make();
    expect(provider.isOffThread?.()).toBe(false);
    expect(seen).toEqual([]);
  });

  it("reports once per resolution, not once per embed", async () => {
    const { provider, seen } = make();
    await provider.ready();
    await provider.ready();
    await provider.embed(["a"]);
    expect(seen).toEqual(["worker (blob)"]);
  });

  it("forgets the backend on unload, and reports the next load afresh", async () => {
    const { provider, seen } = make();
    await provider.ready();
    provider.unload();
    expect(provider.isOffThread?.()).toBe(false);
    await provider.ready();
    expect(seen).toEqual(["worker (blob)", "worker (blob)"]);
  });
});

describe("FallbackEmbeddingProvider — why the others failed (Pythia ADR-185)", () => {
  /** The callback's report of each load: the winner and why the others lost. */
  const reporting = (): {
    provider: ReturnType<typeof createEmbeddingProvider>;
    seen: { backend: string; failures: string[] }[];
  } => {
    const seen: { backend: string; failures: string[] }[] = [];
    const provider = createEmbeddingProvider(
      DEFAULT_EMBEDDING_MODEL_ID,
      runtime,
      undefined,
      async () => "app://resource/worker.mjs",
      (backend, failures) => seen.push({ backend, failures })
    );
    return { provider, seen };
  };

  it("reports each failure REASON alongside the winner, not just that it fell back", async () => {
    // "Unsupported device: wasm" and "Not allowed to load local resource: blob:"
    // are different bugs with different fixes. The chain knew which and threw it
    // into console.warn, where nobody looks until asked.
    fail.blobWorker = true;
    fail.resourceWorker = true;
    const { provider, seen } = reporting();
    await provider.ready();
    expect(seen[0]!.backend).toBe("iframe (UI thread)");
    const failures = seen[0]!.failures;
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("worker (blob)");
    expect(failures[0]).toContain("blobWorker unavailable");
    expect(failures[1]).toContain("worker (resource)");
  });

  it("reports nothing when the first choice won", async () => {
    const { provider, seen } = reporting();
    await provider.ready();
    expect(seen).toEqual([{ backend: "worker (blob)", failures: [] }]);
  });

  it("forgets the reasons on unload, so a retry cannot inherit stale ones", async () => {
    fail.blobWorker = true;
    const { provider, seen } = reporting();
    await provider.ready();
    expect(seen[0]!.failures).toHaveLength(1);
    provider.unload();
    await provider.ready();
    expect(seen[1]!.failures).toHaveLength(1);
  });
});

describe("FallbackEmbeddingProvider — out of memory ends the chain (Pythia ADR-199)", () => {
  it("does not load the model again in the next backend when the first ran out of memory", async () => {
    // Measured on iOS: every backend shares one WebContent process, so the
    // chain went on to load the model twice more — the last time on the UI thread.
    fail.blobWorker = true;
    failWith.message = "no available backend found. ERR: [wasm] RangeError: Out of memory";
    const { provider, seen } = make();
    await expect(provider.ready()).rejects.toThrow(/ran out of memory/);
    expect(built).toEqual(["blobWorker"]);
    expect(seen).toEqual([]);
  });

  it("still falls through on a refusal, which is what the chain is for", async () => {
    fail.blobWorker = true;
    failWith.message = "Not allowed to load local resource: blob:";
    const { provider } = make();
    await provider.ready();
    expect(built).toEqual(["blobWorker", "resourceWorker"]);
  });
});

describe("FallbackEmbeddingProvider — a runtime that cannot be had ends the chain", () => {
  it("does not fetch it again for the next backend, which runs the same module", async () => {
    fail.blobWorker = true;
    failWith.error = new SearchRuntimeError("the search runtime could not be fetched (HTTP 404)");
    const { provider, seen } = make();
    await expect(provider.ready()).rejects.toBe(failWith.error);
    expect(built).toEqual(["blobWorker"]);
    expect(seen).toEqual([]);
  });

  it("nor do model files that are not the pinned ones, told apart after crossing as text", async () => {
    fail.blobWorker = true;
    failWith.message = "model pin mismatch: tokenizer.json: expected 1 bytes, got 2";
    const { provider, seen } = make();
    await expect(provider.ready()).rejects.toThrow(/model pin mismatch/);
    expect(built).toEqual(["blobWorker"]);
    expect(seen).toEqual([]);
  });
});

describe("FallbackEmbeddingProvider — unloaded while the model is still loading (#363)", () => {
  // A model change or a plugin reload during the first download. `unload()` could
  // not reach the backend, because a backend becomes `active` only once it is
  // ready — so the model finished loading into a provider nobody held, and on a
  // phone several hundred MB stayed in the process with nothing able to free it.

  it("releases a backend that becomes ready after the unload", async () => {
    hold.on = "blobWorker";
    const { provider } = make();
    const loading = provider.ready().catch(() => "rejected");
    await Promise.resolve();
    expect(hold.release).not.toBeNull();

    provider.unload();
    hold.release?.(); // the download finishes regardless
    await expect(loading).resolves.toBe("rejected");
    expect(unloaded).toContain("blobWorker");
    expect(provider.isOffThread?.()).toBe(false);
  });

  it("unloads the backend the load is waiting on, right away", async () => {
    hold.on = "blobWorker";
    const { provider } = make();
    void provider.ready().catch(() => undefined);
    await Promise.resolve();
    provider.unload();
    expect(unloaded).toContain("blobWorker");
    hold.release?.();
  });

  it("a load after the unload starts again and engages normally", async () => {
    hold.on = "blobWorker";
    const { provider, seen } = make();
    void provider.ready().catch(() => undefined);
    await Promise.resolve();
    provider.unload();
    hold.release?.();
    await Promise.resolve();

    hold.on = null;
    await provider.ready();
    expect(provider.isOffThread?.()).toBe(true);
    expect(seen).toEqual(["worker (blob)"]);
  });
});

describe("FallbackEmbeddingProvider — an unload is not a refusal", () => {
  it("stops the chain when unloaded while the first backend loads", async () => {
    hold.on = "blobWorker";
    const { provider } = make();
    const load = provider.ready();
    await new Promise((resolve) => setTimeout(resolve, 0));
    provider.unload();
    hold.release?.();
    await expect(load).rejects.toThrow("unloaded");
    // No second or third model loaded for a provider nobody wants any more.
    expect(built).toEqual(["blobWorker"]);
  });

  it("starts a backend again when the one that was ready has failed", async () => {
    const { provider } = make();
    await provider.ready();
    dead.add("blobWorker");
    const again = provider.embed(["x"]);
    dead.clear();
    await again;
    expect(built).toEqual(["blobWorker", "blobWorker"]);
  });

  it("says a load failed until one starts again, and refuses to load once disposed", async () => {
    fail.blobWorker = true;
    fail.resourceWorker = true;
    fail.iframe = true;
    const { provider } = make();
    await expect(provider.ready()).rejects.toThrow();
    await Promise.resolve();
    expect(provider.loadFailed?.()).toBe(true);
    provider.unload();
    expect(provider.loadFailed?.()).toBe(false);

    fail.blobWorker = false;
    provider.dispose?.();
    await expect(provider.ready()).rejects.toThrow("disposed");
    await expect(provider.embed(["x"])).rejects.toThrow("disposed");
  });

  it("tells a model that will not load apart from a bad text", async () => {
    fail.blobWorker = true;
    fail.resourceWorker = true;
    fail.iframe = true;
    const { provider } = make();
    await expect(provider.embed(["x"])).rejects.toMatchObject({ name: "BackendGoneError" });
  });
});
