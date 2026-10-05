// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
  MAX_SEARCH_RUNTIME_BYTES,
  SEARCH_RUNTIME,
  SEARCH_RUNTIME_DEADLINE_MS,
  isSearchRuntimeError
} from "../../../services/semantic/search-runtime";

/** What the release would serve, by URL; a request for anything else is a 404. */
const release = new Map<string, ArrayBuffer | (() => Promise<never>)>();
const requested: string[] = [];

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestUrl: async ({ url }: { url: string }) => {
    requested.push(url);
    const served = release.get(url);
    if (typeof served === "function") return served();
    return served
      ? { status: 200, arrayBuffer: served }
      : { status: 404, arrayBuffer: new ArrayBuffer(0) };
  }
}));

import { SearchRuntimeLoader } from "./search-runtime-loader";

const DIR = ".obsidian/plugins/schreibstube";
const PATH = `${DIR}/${SEARCH_RUNTIME.name}`;
const URL_OF_RELEASE = `https://github.com/smsag/schreibstube/releases/download/1.76.0/${SEARCH_RUNTIME.name}`;

/** The pinned module itself, as the lockfile installs it. */
const pinned = new Uint8Array(
  readFileSync(
    // Node's URL: happy-dom puts its own in place of the global one.
    new NodeURL(
      `../../../../node_modules/${SEARCH_RUNTIME.package}/${SEARCH_RUNTIME.source}`,
      import.meta.url
    )
  )
).buffer;

/** The plugin folder, as far as the loader reaches into it. */
const files = new Map<string, ArrayBuffer>();
const reads: string[] = [];
const adapter = {
  exists: async (path: string) => files.has(path),
  stat: async (path: string) => {
    const bytes = files.get(path);
    return bytes ? { type: "file", size: bytes.byteLength, ctime: 0, mtime: 0 } : null;
  },
  readBinary: async (path: string) => {
    reads.push(path);
    const bytes = files.get(path);
    if (!bytes) throw new Error(`no ${path}`);
    return bytes;
  },
  writeBinary: async (path: string, bytes: ArrayBuffer) => {
    files.set(path, bytes);
  },
  list: async (dir: string) => ({
    files: [...files.keys()].filter((path) => path.startsWith(`${dir}/`)),
    folders: []
  }),
  remove: async (path: string) => {
    files.delete(path);
  }
};
const app = { vault: { adapter } } as unknown as App;
const logger = { warn: vi.fn(), debug: vi.fn() };

function loader(): SearchRuntimeLoader {
  return new SearchRuntimeLoader(app, DIR, "1.76.0", logger);
}

/** Same length, different bytes: what a tampered file would look like. */
function tampered(): ArrayBuffer {
  const bytes = new Uint8Array(pinned.slice(0));
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
  return bytes.buffer;
}

beforeEach(() => {
  release.clear();
  requested.length = 0;
  files.clear();
  reads.length = 0;
  logger.warn.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchRuntimeLoader", () => {
  it("fetches the module from the installed version's release, once, and keeps it beside the plugin", async () => {
    release.set(URL_OF_RELEASE, pinned);
    files.set(`${DIR}/search-runtime-1.22.0.wasm`, new ArrayBuffer(4));
    files.set(`${DIR}/main.js`, new ArrayBuffer(4));

    const bytes = await loader().bytes();

    expect(bytes.byteLength).toBe(SEARCH_RUNTIME.bytes);
    expect(requested).toEqual([URL_OF_RELEASE]);
    expect(files.get(PATH)).toBe(bytes);
    // The previous version's 14 MB goes; a file the plugin did not name stays.
    expect([...files.keys()].sort()).toEqual([`${DIR}/main.js`, PATH].sort());
  });

  it("uses the kept file when it is still the pinned one, without a request", async () => {
    files.set(PATH, pinned);
    expect(await loader().bytes()).toBe(pinned);
    expect(requested).toEqual([]);
  });

  it("refuses a kept file of the wrong length without reading it, and fetches again", async () => {
    files.set(PATH, new ArrayBuffer(SEARCH_RUNTIME.bytes + 1));
    release.set(URL_OF_RELEASE, pinned);
    expect((await loader().bytes()).byteLength).toBe(SEARCH_RUNTIME.bytes);
    expect(reads).toEqual([]);
    expect(requested).toEqual([URL_OF_RELEASE]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("cached search runtime rejected")
    );
  });

  it("refuses a kept file whose bytes changed, and fetches again", async () => {
    files.set(PATH, tampered());
    release.set(URL_OF_RELEASE, pinned);
    expect(await loader().bytes()).toBe(pinned);
    expect(files.get(PATH)).toBe(pinned);
  });

  it("refuses a download that is not the pinned module, and keeps nothing of it", async () => {
    release.set(URL_OF_RELEASE, tampered());
    const error: unknown = await loader()
      .bytes()
      .catch((e: unknown) => e);
    expect(isSearchRuntimeError(error)).toBe(true);
    expect(String(error)).toContain("not what this version expects");
    expect(files.has(PATH)).toBe(false);
  });

  it("refuses a download larger than the bound before hashing it", async () => {
    release.set(URL_OF_RELEASE, new ArrayBuffer(MAX_SEARCH_RUNTIME_BYTES + 1));
    await expect(loader().bytes()).rejects.toThrow(/more than/);
    expect(files.has(PATH)).toBe(false);
  });

  it("says the release could not be reached, as a runtime failure", async () => {
    const error: unknown = await loader()
      .bytes()
      .catch((e: unknown) => e);
    expect(isSearchRuntimeError(error)).toBe(true);
    expect(String(error)).toContain("HTTP 404");
  });

  it("gives up on a download that does not answer within its deadline", async () => {
    vi.useFakeTimers();
    release.set(URL_OF_RELEASE, () => new Promise<never>(() => {}));
    const asked = loader()
      .bytes()
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(SEARCH_RUNTIME_DEADLINE_MS + 1);
    const error = await asked;
    expect(isSearchRuntimeError(error)).toBe(true);
    expect(String(error)).toContain(`no answer within ${SEARCH_RUNTIME_DEADLINE_MS / 1000} s`);
  });

  it("makes one download for two loads that ask at once, and reads anew for the next", async () => {
    release.set(URL_OF_RELEASE, pinned);
    const runtime = loader();
    const [a, b] = await Promise.all([runtime.bytes(), runtime.bytes()]);
    expect(a).toBe(b);
    expect(requested).toHaveLength(1);
    await runtime.bytes();
    expect(requested).toHaveLength(1);
    expect(reads).toEqual([PATH]);
  });
});
