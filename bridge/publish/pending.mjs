/**
 * Uploads between two commits: what they may weigh, and the record that lets
 * a commit remove the ones no index came to use.
 *
 * Uploads happen outside the publish lock, before the commit that names them.
 * An asset the plugin uploaded and then never committed — it gave up, the
 * phone slept, the bridge restarted — was a file on the host that no manifest
 * knew of, so nothing would ever remove it; and nothing stopped a token holder
 * from uploading until the disk was full. Each asset is now recorded in the
 * state directory before it is written, and the next commit removes what it
 * does not keep; and a target takes so many uploads and bytes between two
 * commits and no more.
 */
import { createHash } from "node:crypto";
import { httpError } from "../http.mjs";
import { UPLOADED_ASSET } from "./manifest.mjs";
import { checkRelativePath, PathError } from "./path.mjs";

export const PENDING_VERSION = 1;

/** More than the uploads a target may take between commits by default. */
export const MAX_PENDING_ENTRIES = 10_000;

/**
 * The record as read from the host, reduced to what may be acted on: a
 * pending path is one the next commit may delete, so only the names the bridge
 * gives uploads — `assets/<hash>-…`, `assets/thumbs/<hash>-…` — are kept, and a
 * record edited to name a page or someone else's file names nothing.
 */
export function normalizePending(raw) {
  const pending = new Map();
  const files =
    raw && typeof raw === "object" && raw.version === PENDING_VERSION ? raw.files : null;
  if (!files || typeof files !== "object") return pending;

  for (const [path, entry] of Object.entries(files)) {
    if (pending.size >= MAX_PENDING_ENTRIES) break;
    if (!UPLOADED_ASSET.test(path)) continue;
    try {
      checkRelativePath(path);
    } catch (err) {
      if (err instanceof PathError) continue;
      throw err;
    }
    const sha256 = entry?.sha256;
    const bytes = entry?.bytes;
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) continue;
    if (!Number.isSafeInteger(bytes) || bytes < 0) continue;
    pending.set(path, { sha256, bytes });
  }
  return pending;
}

/** The record as it is written. */
export function serializePending(target, pending) {
  const files = Object.fromEntries([...pending].sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ version: PENDING_VERSION, target, files }, null, 2);
}

/** Pending uploads the new manifest does not keep: the ones to remove. */
export function orphanUploads(pending, manifestFiles) {
  return [...pending.keys()].filter((path) => !Object.hasOwn(manifestFiles, path)).sort();
}

/** Whether bytes are the content an entry promises. */
export function matches(bytes, entry) {
  return (
    bytes.length === entry.bytes &&
    createHash("sha256").update(bytes).digest("hex") === entry.sha256
  );
}

/**
 * What each target has been sent since its last commit, in this process.
 * Counted when an upload is admitted, so an upload that fails halfway still
 * counts: its bytes may be on the host.
 */
export class UploadQuota {
  #used = new Map();

  constructor({ maxBytes, maxUploads }) {
    this.maxBytes = maxBytes;
    this.maxUploads = maxUploads;
  }

  /** Count an upload of `bytes`, or refuse it with 413 when it would pass a limit. */
  admit(target, bytes) {
    const used = this.#used.get(target) ?? { uploads: 0, bytes: 0 };
    if (used.uploads + 1 > this.maxUploads || used.bytes + bytes > this.maxBytes) {
      throw httpError(
        413,
        "quota_exceeded",
        `${target} has taken ${used.uploads} upload(s) and ${used.bytes} bytes since its ` +
          `last commit; the limit is ${this.maxUploads} and ${this.maxBytes}. Commit first.`
      );
    }
    this.#used.set(target, { uploads: used.uploads + 1, bytes: used.bytes + bytes });
  }

  used(target) {
    return this.#used.get(target) ?? { uploads: 0, bytes: 0 };
  }

  /** A commit took what was sent; the next publish starts afresh. */
  reset(target) {
    this.#used.delete(target);
  }
}
