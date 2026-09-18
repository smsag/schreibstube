/**
 * Whether this device can typeset at all.
 *
 * Printing needs three things the platform either has or does not: a
 * WebAssembly engine to run the typesetter, a worker to run it away from the
 * interface, and a digest to check the bytes with. Every platform Obsidian
 * supports has all three — desktop and mobile are the same Chromium — so this
 * is not a platform test and must never become one. It is the question asked
 * instead of a platform test, because a browser engine is a moving target and
 * "which phone is this" is the wrong thing to know.
 *
 * A missing one is said plainly and printing stops. There is no second path:
 * the typesetter runs on the device or the document is not made, and pretending
 * otherwise would mean a server, which is the thing this feature exists without.
 */

/** What printing needs, as the surrounding code can see it. */
export interface PlatformFeatures {
  /** `WebAssembly.compile` — the typesetter is a WebAssembly module. */
  webAssembly: boolean;
  /** `Worker` — so a long document does not freeze the window. */
  worker: boolean;
  /** `crypto.subtle` — so the downloaded typesetter can be checked. */
  digest: boolean;
}

export type MissingCapability = "webAssembly" | "worker" | "digest";

/**
 * The first thing this device is missing, or null when it has everything.
 *
 * First rather than all of them: a platform without WebAssembly is not going
 * to be talked into printing by a longer list, and the first answer is the one
 * a person can act on.
 */
export function missingCapability(features: PlatformFeatures): MissingCapability | null {
  if (!features.webAssembly) return "webAssembly";
  if (!features.worker) return "worker";
  if (!features.digest) return "digest";
  return null;
}

/** What the running platform actually offers, read once where the globals are. */
export function readPlatformFeatures(scope: typeof globalThis): PlatformFeatures {
  return {
    webAssembly: typeof scope.WebAssembly?.compile === "function",
    worker: typeof scope.Worker === "function",
    digest: typeof scope.crypto?.subtle?.digest === "function"
  };
}
