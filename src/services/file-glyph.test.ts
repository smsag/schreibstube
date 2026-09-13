import { describe, expect, it } from "vitest";
import { fileGlyph } from "./file-glyph";

describe("fileGlyph", () => {
  it("draws the chosen icon whatever the file is", () => {
    expect(fileGlyph("star", { kind: "folder", open: true })).toBe("star");
    expect(fileGlyph("star", { kind: "file", extension: "md" })).toBe("star");
  });

  it("treats an empty choice as no choice", () => {
    expect(fileGlyph("", { kind: "file", extension: "md" })).toBe("file-text");
    expect(fileGlyph(null, { kind: "file", extension: "md" })).toBe("file-text");
    expect(fileGlyph(undefined, { kind: "file", extension: "md" })).toBe("file-text");
  });

  it("says whether a folder is open", () => {
    expect(fileGlyph(null, { kind: "folder", open: true })).toBe("folder-open");
    expect(fileGlyph(null, { kind: "folder", open: false })).toBe("folder");
  });

  it("draws notes as text and attachments as pictures, whatever the case of the extension", () => {
    expect(fileGlyph(null, { kind: "file", extension: "md" })).toBe("file-text");
    expect(fileGlyph(null, { kind: "file", extension: "PNG" })).toBe("photo");
    expect(fileGlyph(null, { kind: "file", extension: "m4a" })).toBe("photo");
    expect(fileGlyph(null, { kind: "file", extension: "pdf" })).toBe("file");
    expect(fileGlyph(null, { kind: "file", extension: "" })).toBe("file");
  });

  it("falls back to a plain file for anything else", () => {
    expect(fileGlyph(null, { kind: "other" })).toBe("file");
  });
});
