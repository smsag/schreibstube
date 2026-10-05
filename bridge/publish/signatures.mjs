/**
 * Whether uploaded bytes begin the way their extension says they must.
 *
 * The site serves an upload under its extension's type, and a browser that is
 * told `nosniff` believes it; one that is not may look at the bytes and decide
 * for itself. A file named `.webp` that is really HTML is therefore a page on
 * the site's domain, with no picture anywhere. Only the first bytes are read:
 * a decoder is what the browser has, and the bridge has no need of one to
 * tell a picture from a page.
 */

const ascii = (bytes, at, text) =>
  bytes.length >= at + text.length &&
  [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

const prefix = (bytes, signature) =>
  bytes.length > signature.length && signature.every((byte, i) => bytes[i] === byte);

/**
 * An ISO base media file (MP4, M4V, QuickTime, AVIF) is a series of boxes, the
 * first of which names its type at offset 4. `ftyp` then names the brand; an
 * old QuickTime file may begin with its movie or its data instead.
 */
function boxType(bytes) {
  return bytes.length >= 12 ? String.fromCharCode(...bytes.subarray(4, 8)) : "";
}

function brands(bytes) {
  if (boxType(bytes) !== "ftyp") return [];
  // Only the first few brands are read: a box that claims more is not a reason
  // to read further into the file.
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const end = Math.min(size, bytes.length, 64);
  const found = [];
  for (let at = 8; at + 4 <= end; at += 4) {
    if (at === 12) continue; // the minor version, not a brand
    found.push(String.fromCharCode(...bytes.subarray(at, at + 4)));
  }
  return found;
}

const SIGNATURES = new Map([
  ["png", (b) => prefix(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ["jpg", (b) => prefix(b, [0xff, 0xd8, 0xff])],
  ["jpeg", (b) => prefix(b, [0xff, 0xd8, 0xff])],
  ["gif", (b) => (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a")) && b.length > 6],
  ["webp", (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")],
  ["avif", (b) => brands(b).some((brand) => brand === "avif" || brand === "avis")],
  ["mp4", (b) => boxType(b) === "ftyp"],
  ["m4v", (b) => boxType(b) === "ftyp"],
  ["mov", (b) => ["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(boxType(b))],
  ["webm", (b) => prefix(b, [0x1a, 0x45, 0xdf, 0xa3])],
  ["ogv", (b) => ascii(b, 0, "OggS") && b.length > 4]
]);

/** The extensions whose first bytes are checked. */
export const SIGNED_EXTENSIONS = new Set(SIGNATURES.keys());

/**
 * Whether `bytes` begin like a file of `extension`. An extension without a
 * signature here — one an operator added to a target's list — is taken on
 * its name, as every upload was before.
 */
export function hasSignature(bytes, extension) {
  const check = SIGNATURES.get(String(extension).toLowerCase());
  return check ? check(bytes) : true;
}
