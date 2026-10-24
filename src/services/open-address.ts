/**
 * Whether an address written in a note may be handed to `window.open`.
 *
 * A note is anybody's to write — a shared vault, a web clipping, a mail
 * imported — and `window.open` runs whatever scheme it is given: in Obsidian,
 * a `javascript:` address runs with everything the app can reach. Other apps'
 * own schemes (`zotero:`, `things:`) are what an icon link is often for, so
 * only the few that run or read something in place of opening it are
 * refused, read the way the browser reads them: tabs and line breaks dropped.
 */
const REFUSED = new Set(["javascript:", "vbscript:", "data:", "blob:", "file:"]);

export function isOpenableAddress(href: string): boolean {
  try {
    return !REFUSED.has(new URL(href).protocol);
  } catch {
    return false;
  }
}
