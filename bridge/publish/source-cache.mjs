/**
 * The notes a commit renders, kept in memory between publishes.
 *
 * Every commit renders the whole site, and read every stored note back from
 * the web host to do it: three hundred notes cost three hundred reads for one
 * edited sentence. A stored note is addressed by the hash of its content, so
 * a copy kept here can never be out of date — a changed note is a new hash —
 * and nothing ever has to be invalidated. Only text whose hash was checked
 * goes in, so a key always names exactly its value.
 *
 * Bounded by size, least recently used first out, because the bridge runs for
 * months on a small container. A note that falls out is read again next time;
 * the cache only ever saves work, it never decides anything.
 */
import { createHash } from "node:crypto";

/** What the cache may hold. A few hundred notes of prose are a few megabytes. */
export const MAX_CACHED_SOURCE_BYTES = 32_000_000;

export class SourceCache {
  constructor({ maxBytes = MAX_CACHED_SOURCE_BYTES } = {}) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.entries = new Map();
  }

  /** The text for a hash, or undefined; a hit counts as a use. */
  get(hash) {
    const entry = this.entries.get(hash);
    if (entry === undefined) return undefined;
    this.entries.delete(hash);
    this.entries.set(hash, entry);
    return entry.text;
  }

  /**
   * Keep `content` under `hash` if it hashes to it; returns whether it was
   * kept. Content that does not match is refused rather than stored under a
   * name it would contradict.
   */
  set(hash, content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    if (createHash("sha256").update(buffer).digest("hex") !== hash) return false;
    if (buffer.length > this.maxBytes) return false;

    this.#forget(hash);
    this.entries.set(hash, { text: buffer.toString("utf8"), bytes: buffer.length });
    this.bytes += buffer.length;
    for (const [oldest] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.#forget(oldest);
    }
    return true;
  }

  get size() {
    return this.entries.size;
  }

  #forget(hash) {
    const entry = this.entries.get(hash);
    if (!entry) return;
    this.entries.delete(hash);
    this.bytes -= entry.bytes;
  }
}
