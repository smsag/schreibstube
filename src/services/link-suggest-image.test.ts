import { describe, expect, it } from "vitest";
import { MAX_THUMBNAIL_BYTES, suggestedImage } from "./link-suggest-image";

/** A row as Obsidian's link suggester hands it over for a file. */
function fileRow(path: string, extension: string, size = 2_000_000) {
  return { type: "file", path, file: { path, extension, stat: { size } }, score: 1, matches: null };
}

describe("suggestedImage", () => {
  it("names a photo and lets it fill the square", () => {
    expect(suggestedImage(fileRow("Dieses Leben/Panorama.jpg", "jpg"))).toEqual({
      path: "Dieses Leben/Panorama.jpg",
      fit: "cover"
    });
  });

  it("shows a drawing whole", () => {
    expect(suggestedImage(fileRow("Dieses Leben/pythia.svg", "svg"))).toEqual({
      path: "Dieses Leben/pythia.svg",
      fit: "contain"
    });
  });

  it("reads the extension whatever its case", () => {
    expect(suggestedImage(fileRow("Scans/IMG_2041.JPEG", "JPEG"))?.fit).toBe("cover");
    expect(suggestedImage(fileRow("Logo.SVG", "SVG"))?.fit).toBe("contain");
  });

  it("leaves notes and other files alone", () => {
    expect(suggestedImage(fileRow("Projekte/pythia.md", "md"))).toBeNull();
    expect(suggestedImage(fileRow("Vertrag.pdf", "pdf"))).toBeNull();
    expect(suggestedImage(fileRow("Ohne Endung", ""))).toBeNull();
  });

  it("leaves every other kind of row alone", () => {
    const file = { path: "bild.png", extension: "png", stat: { size: 10 } };
    expect(suggestedImage({ type: "alias", alias: "300", path: "bild.png", file })).toBeNull();
    expect(suggestedImage({ type: "heading", heading: "Lage", path: "bild.png", file })).toBeNull();
    expect(suggestedImage({ type: "linktext", path: "Noch nicht da" })).toBeNull();
    expect(suggestedImage({ type: "none" })).toBeNull();
  });

  it("draws nothing for a picture too large to decode for a list", () => {
    expect(suggestedImage(fileRow("Poster.png", "png", MAX_THUMBNAIL_BYTES))).not.toBeNull();
    expect(suggestedImage(fileRow("Poster.png", "png", MAX_THUMBNAIL_BYTES + 1))).toBeNull();
  });

  it("draws a picture whose size nobody states", () => {
    const row = { type: "file", file: { path: "bild.png", extension: "png" } };
    expect(suggestedImage(row)).toEqual({ path: "bild.png", fit: "cover" });
    expect(
      suggestedImage({ type: "file", file: { path: "bild.png", extension: "png", stat: {} } })
    ).not.toBeNull();
  });

  it("takes nothing on trust from a row of another shape", () => {
    for (const row of [
      null,
      undefined,
      "bild.png",
      42,
      [],
      {},
      { type: "file" },
      { type: "file", file: null },
      { type: "file", file: "bild.png" },
      { type: "file", file: { path: 7, extension: "png" } },
      { type: "file", file: { path: "", extension: "png" } },
      { type: "file", file: { path: "bild.png" } },
      { type: "file", file: { path: "bild.png", extension: 3 } }
    ]) {
      expect(suggestedImage(row)).toBeNull();
    }
  });
});
