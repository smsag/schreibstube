// Pure vector operations for semantic similarity between conversations.
//
// Vectors are stored quantized to Int8 (obsidian-similarity's storage form): a
// raw model vector is L2-normalized then scaled by ±127. Cosine similarity of two
// such vectors is their dot product divided by 127² (since each was unit-length
// before scaling). Quantization introduces a small rounding error — fine for
// ranking and thresholding, and it quarters the on-disk index size vs Float32.

export const QUANT_SCALE = 127;

/** L2-normalize a vector to unit length. A zero vector is returned unchanged. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  if (sumSq === 0) return v.slice();
  const inv = 1 / Math.sqrt(sumSq);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) * inv;
  return out;
}

/** Normalize then quantize a raw model vector to Int8 for storage. */
export function quantize(v: Float32Array): Int8Array {
  const n = l2Normalize(v);
  const out = new Int8Array(n.length);
  for (let i = 0; i < n.length; i++) {
    const q = Math.round((n[i] ?? 0) * QUANT_SCALE);
    // Manual clamp: Int8Array assignment wraps (128 → -128) instead of saturating.
    out[i] = q > 127 ? 127 : q < -127 ? -127 : q;
  }
  return out;
}

/** Cosine similarity of two Int8-quantized (already normalized) vectors, ≈ [-1, 1]. */
export function cosine(a: Int8Array, b: Int8Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot / (QUANT_SCALE * QUANT_SCALE);
}

/**
 * The most passages of a source note that rank the rest of the index.
 *
 * A note is stored as up to 96 passages, and ranking compares each of them with
 * every passage of every other note: a long note against a large index was
 * tens of millions of cosines on the UI thread while the Recommended panel
 * waited. Its first passages — the title, the opening — say what it is about;
 * the rest mostly repeat that at a higher price.
 */
export const MAX_SOURCE_CHUNKS = 8;

/** Items scored between cooperative yields when one vector ranks the index. */
export const RANK_YIELD_EVERY = 2000;

/** Items scored between yields when `sourceChunks` vectors rank the index: the
 *  work per item grows with the source, so the yields come sooner. */
export function rankYieldEvery(sourceChunks: number): number {
  return Math.max(50, Math.floor(RANK_YIELD_EVERY / Math.max(1, sourceChunks)));
}

/**
 * Best chunk-to-chunk cosine between two conversations' chunk-vector sets — the
 * similarity of the closest pair of chunks. Returns 0 when either set is empty.
 */
export function maxPairwiseCosine(a: Int8Array[], b: Int8Array[]): number {
  let best = -Infinity;
  for (const x of a) {
    for (const y of b) {
      const s = cosine(x, y);
      if (s > best) best = s;
    }
  }
  return Number.isFinite(best) ? best : 0;
}
