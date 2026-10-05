/**
 * The WebAssembly module search by meaning runs, and how a device knows it got
 * the right one.
 *
 * The model runtime is onnxruntime-web. Its JavaScript is bundled into main.js
 * (`scripts/embedding-bundle.mjs`); its WebAssembly module is 14 MB, too large
 * for a bundle every vault parses on every start, so it is fetched once per
 * device from this plugin's own release and kept beside the plugin, the way the
 * typesetter is. Those bytes are executed, so they are pinned: the release
 * workflow refuses to attach a file that does not hash to `search-runtime.json`,
 * and the device hashes it again after the download and on every load.
 *
 * The pin lives in JSON because the release script reads the same file, and a
 * second copy of a hash is how the two would come apart.
 */
import PIN from "./search-runtime.json";
import { checkRuntimeBytes, runtimeAssetUrl, runtimeCachePath } from "../typst-runtime";

export interface SearchRuntimePin {
  /** The npm package the module is taken from, at `version`. */
  package: string;
  version: string;
  /** Where in that package the file is. */
  source: string;
  /** The file's name on the release and beside the plugin. */
  name: string;
  /** Lowercase hex SHA-256 of the exact bytes that must arrive. */
  sha256: string;
  /** Their exact length, checked before anything is hashed. */
  bytes: number;
}

export const SEARCH_RUNTIME: SearchRuntimePin = PIN;

/**
 * The most a device reads of a file claiming to be the runtime.
 *
 * Above the pinned length, so a version bump has room before this needs to
 * move, and far below what would hurt a phone to hold for the moment it takes
 * to refuse it.
 */
export const MAX_SEARCH_RUNTIME_BYTES = 32 * 1024 * 1024;

/** How long the download may take. A phone on a slow line gets three minutes for 14 MB. */
export const SEARCH_RUNTIME_DEADLINE_MS = 180_000;

/** Where a device fetches it: the release of the plugin version that is installed. */
export function searchRuntimeUrl(pluginVersion: string): string {
  return runtimeAssetUrl(pluginVersion, SEARCH_RUNTIME);
}

/** Where it is kept once fetched. */
export function searchRuntimePath(pluginDir: string): string {
  return runtimeCachePath(pluginDir, SEARCH_RUNTIME);
}

/**
 * Whether a file of this length can be the runtime, before it is read. A file
 * that is not is refused without spending the memory to hash it.
 */
export function checkSearchRuntimeSize(size: number): string | null {
  if (size === SEARCH_RUNTIME.bytes) return null;
  return `${SEARCH_RUNTIME.name}: expected ${SEARCH_RUNTIME.bytes} bytes, got ${size}`;
}

/** Whether these are the pinned bytes: the length first, then the hash. */
export function checkSearchRuntime(size: number, actualSha256: string): string | null {
  return checkSearchRuntimeSize(size) ?? checkRuntimeBytes(SEARCH_RUNTIME, actualSha256);
}

/**
 * Runtime files beside the plugin that no longer belong to it: a version bump
 * leaves the previous 14 MB behind, and nobody can see it from inside the app.
 * Only names this module gives are offered, so a person's own file is never.
 */
export function staleSearchRuntimeFiles(names: readonly string[]): string[] {
  return names.filter(
    (name) => /^search-runtime-[\w.-]+\.wasm$/.test(name) && name !== SEARCH_RUNTIME.name
  );
}

/**
 * The runtime could not be had: not fetched, or not the pinned bytes.
 *
 * Ends the chain of backends the way running out of memory does. Every backend
 * runs the same module, so the next one would only fetch it again and be
 * refused for the same reason.
 */
export class SearchRuntimeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SearchRuntimeError";
  }
}

export function isSearchRuntimeError(err: unknown): boolean {
  return err instanceof SearchRuntimeError;
}
