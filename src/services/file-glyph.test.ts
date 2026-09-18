import { describe, expect, it } from "vitest";
import { fileGlyph, fileNameParts, isDrawing } from "./file-glyph";

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
    expect(fileGlyph(null, { kind: "file", extension: "zip" })).toBe("file");
    expect(fileGlyph(null, { kind: "file", extension: "" })).toBe("file");
  });

  it("falls back to a plain file for anything else", () => {
    expect(fileGlyph(null, { kind: "other" })).toBe("file");
  });
});

describe("fileGlyph for PDFs and drawings", () => {
  it("gives a PDF its own icon", () => {
    expect(fileGlyph(null, { kind: "file", extension: "pdf", name: "Vertrag.pdf" })).toBe(
      "file-type-pdf"
    );
    expect(fileGlyph(null, { kind: "file", extension: "PDF" })).toBe("file-type-pdf");
  });

  it("gives an Excalidraw drawing its own icon, in either format", () => {
    const subject = (name: string, extension: string) =>
      fileGlyph(null, { kind: "file", extension, name });
    expect(subject("Plan.excalidraw.md", "md")).toBe("scribble");
    expect(subject("Plan.Excalidraw.md", "md")).toBe("scribble");
    expect(subject("Plan.excalidraw", "excalidraw")).toBe("scribble");
  });

  it("draws a drawing's exported picture as a picture", () => {
    expect(fileGlyph(null, { kind: "file", extension: "svg", name: "Plan.excalidraw.svg" })).toBe(
      "photo"
    );
  });

  it("still prefers a chosen icon", () => {
    expect(fileGlyph("star", { kind: "file", extension: "pdf", name: "a.pdf" })).toBe("star");
  });
});

describe("isDrawing", () => {
  it("does not take a note that merely mentions the word for a drawing", () => {
    expect(isDrawing("excalidraw tips.md", "md")).toBe(false);
    expect(isDrawing("Plan.md", "md")).toBe(false);
  });
});

describe("fileNameParts", () => {
  it("shows a note, an SVG and a drawing by their stem", () => {
    expect(fileNameParts("Plan.md", "md")).toEqual({ stem: "Plan", suffix: ".md", hidden: true });
    expect(fileNameParts("Plan.svg", "svg")).toEqual({
      stem: "Plan",
      suffix: ".svg",
      hidden: true
    });
    expect(fileNameParts("Plan.excalidraw.md", "md")).toEqual({
      stem: "Plan",
      suffix: ".excalidraw.md",
      hidden: true
    });
    expect(fileNameParts("Plan.excalidraw.svg", "svg")).toEqual({
      stem: "Plan",
      suffix: ".excalidraw.svg",
      hidden: true
    });
    expect(fileNameParts("Plan.excalidraw", "excalidraw")).toEqual({
      stem: "Plan",
      suffix: ".excalidraw",
      hidden: true
    });
  });

  it("keeps the extension on screen for every other attachment", () => {
    expect(fileNameParts("photo.png", "png")).toEqual({
      stem: "photo",
      suffix: ".png",
      hidden: false
    });
    expect(fileNameParts("Plan.excalidraw.png", "png")).toMatchObject({
      stem: "Plan.excalidraw",
      hidden: false
    });
  });

  it("keeps the suffix's own case", () => {
    expect(fileNameParts("Plan.Excalidraw.MD", "MD")).toEqual({
      stem: "Plan",
      suffix: ".Excalidraw.MD",
      hidden: true
    });
  });

  it("never leaves an empty stem", () => {
    expect(fileNameParts(".excalidraw.md", "md").stem).toBe(".excalidraw");
  });

  it("leaves a file without an extension whole", () => {
    expect(fileNameParts("LICENSE", "")).toEqual({ stem: "LICENSE", suffix: "", hidden: false });
  });
});
