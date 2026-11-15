/**
 * 32-bit FNV-1a over UTF-16 code units. Cheap and dependency-free, for telling
 * whether text changed; not for security. Its results are stored (index files,
 * sync records), so the arithmetic must never change.
 */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
