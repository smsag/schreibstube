import { describe, expect, it } from "vitest";
import { hasSignature, SIGNED_EXTENSIONS } from "./signatures.mjs";

/** First bytes of each kind of file a site serves from an upload. */

const bytes = (...parts) =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part)
    )
  );
const box = (type, brand, ...compatible) => {
  const body = bytes(type, brand, [0, 0, 0, 0], ...compatible);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length + 4, 0);
  return bytes(size, body);
};

const files = {
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
  jpg: bytes([0xff, 0xd8, 0xff, 0xe0]),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xdb]),
  gif: bytes("GIF89a", [1, 0]),
  webp: bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "),
  avif: box("ftyp", "avif", "mif1", "miaf"),
  mp4: box("ftyp", "isom", "mp41"),
  m4v: box("ftyp", "M4V ", "isom"),
  mov: box("ftyp", "qt  "),
  webm: bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]),
  ogv: bytes("OggS", [0, 2])
};

describe("hasSignature", () => {
  for (const [extension, content] of Object.entries(files)) {
    it(`takes a ${extension} that begins like one`, () => {
      expect(hasSignature(content, extension)).toBe(true);
      expect(hasSignature(content, extension.toUpperCase())).toBe(true);
    });

    it(`refuses a page named .${extension}`, () => {
      expect(hasSignature(Buffer.from("<html><script>alert(1)</script>"), extension)).toBe(false);
    });
  }

  it("covers every picture and video a target serves by default", () => {
    expect([...SIGNED_EXTENSIONS].sort()).toEqual(Object.keys(files).sort());
  });

  it("tells one container from another", () => {
    expect(hasSignature(files.mp4, "avif")).toBe(false);
    expect(hasSignature(box("ftyp", "mif1", "avif"), "avif")).toBe(true);
    expect(hasSignature(files.png, "gif")).toBe(false);
    expect(hasSignature(bytes("RIFF", [0, 0, 0, 0], "WAVE"), "webp")).toBe(false);
  });

  it("takes an old QuickTime file that begins with its movie", () => {
    expect(hasSignature(bytes([0, 0, 0, 8], "moov", [0, 0, 0, 0]), "mov")).toBe(true);
    expect(hasSignature(bytes([0, 0, 0, 8], "moov", [0, 0, 0, 0]), "mp4")).toBe(false);
  });

  it("takes an extension it has no signature for on its name", () => {
    expect(hasSignature(Buffer.from("anything"), "ico")).toBe(true);
  });

  it("refuses a file too short to say what it is", () => {
    expect(hasSignature(Buffer.from("GIF89a"), "gif")).toBe(false);
    expect(hasSignature(Buffer.from([0, 0, 0, 8]), "mp4")).toBe(false);
  });
});
