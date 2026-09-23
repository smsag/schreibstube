import { describe, expect, it } from "vitest";
import { pdfReferences } from "./pdf-references";

const paths = (embeds: string[], links: string[] = []): { embeds: string[]; links: string[] } => ({
  embeds,
  links
});

describe("pdfReferences", () => {
  it("finds an embedded PDF", () => {
    expect(pdfReferences(paths(["Anhang/Bericht.pdf"]))).toEqual(["Anhang/Bericht.pdf"]);
  });

  it("finds a linked PDF as well as an embedded one", () => {
    expect(pdfReferences(paths(["A.pdf"], ["B.pdf"]))).toEqual(["A.pdf", "B.pdf"]);
  });

  it("offers the embedded PDF before the merely linked one", () => {
    expect(pdfReferences(paths(["Gezeigt.pdf"], ["Erwähnt.pdf"]))[0]).toBe("Gezeigt.pdf");
  });

  it("counts a PDF once even when a note embeds and links it", () => {
    expect(pdfReferences(paths(["Bericht.pdf"], ["Bericht.pdf"]))).toEqual(["Bericht.pdf"]);
  });

  it("treats a jump mark as the file it points into, not a second document", () => {
    expect(pdfReferences(paths(["Bericht.pdf#page=4&selection=1,0,2,5"], ["Bericht.pdf"]))).toEqual(
      ["Bericht.pdf"]
    );
  });

  it("ignores everything that is not a PDF", () => {
    expect(pdfReferences(paths(["Bild.png", "Notiz.md"], ["Tabelle.csv"]))).toEqual([]);
  });

  it("accepts an uppercase extension, which a scanner writes", () => {
    expect(pdfReferences(paths(["SCAN.PDF"]))).toEqual(["SCAN.PDF"]);
  });

  it("answers with nothing for a note that references no file", () => {
    expect(pdfReferences(paths([], []))).toEqual([]);
  });
});
