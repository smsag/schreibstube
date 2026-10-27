import { describe, expect, it } from "vitest";
import { isDraftCallout, stripDraftMarkers } from "./print-drafts";

describe("stripDraftMarkers", () => {
  it("drops a marker and the space before it", () => {
    expect(stripDraftMarkers("Der Mieter [TODO: Name] zieht aus.")).toEqual({
      text: "Der Mieter zieht aus.",
      markers: 1
    });
  });

  it("knows TBD, FIXME and PRÜFEN as well", () => {
    const { text, markers } = stripDraftMarkers("a [TBD] b [FIXME later] c [PRÜFEN — Datum] d");
    expect(text).toBe("a b c d");
    expect(markers).toBe(3);
  });

  it("drops a code span that is nothing but a marker, as an article quotes one", () => {
    const source = "Trage die Objekt-ID ein. `[TODO: verify — wo die ID steht]`";
    expect(stripDraftMarkers(source)).toEqual({ text: "Trage die Objekt-ID ein.", markers: 1 });
  });

  it("keeps code that only mentions a marker", () => {
    const source = "Schreib `grep '[TODO]'` oder ``[TODO]` drin``.";
    expect(stripDraftMarkers(source)).toEqual({ text: source, markers: 0 });
  });

  it("leaves fenced blocks alone", () => {
    const source = "```\n[TODO: im Code]\n```";
    expect(stripDraftMarkers(source)).toEqual({ text: source, markers: 0 });
  });

  it("leaves no blank where a line was only a marker", () => {
    expect(stripDraftMarkers("eins\n[TODO: prüfen]\nzwei").text).toBe("eins\nzwei");
  });

  it("keeps lines that were blank to begin with", () => {
    expect(stripDraftMarkers("eins\n\nzwei").text).toBe("eins\n\nzwei");
  });

  it("takes upper case only, since a word in brackets can be prose", () => {
    const source = "Siehe [todo] und [Prüfen Sie die Angaben].";
    expect(stripDraftMarkers(source).markers).toBe(0);
  });

  it("leaves links, references, wikilinks and escaped brackets alone", () => {
    const source = [
      "[TODO-Liste](https://example.com)",
      "[TODO][ref]",
      "[TODO]: https://example.com",
      "[[TODO Ideen]]",
      "\\[TODO] steht so da"
    ].join("\n");
    expect(stripDraftMarkers(source)).toEqual({ text: source, markers: 0 });
  });

  it("does not take a longer word for the marker", () => {
    expect(stripDraftMarkers("[TODOS für morgen]").markers).toBe(0);
  });

  it("reads past backticks that never close", () => {
    expect(stripDraftMarkers("ein ` allein [TODO] hier").text).toBe("ein ` allein hier");
  });
});

describe("isDraftCallout", () => {
  it("is the todo kind, in any case", () => {
    expect(isDraftCallout("todo")).toBe(true);
    expect(isDraftCallout("TODO")).toBe(true);
    expect(isDraftCallout("note")).toBe(false);
    expect(isDraftCallout(undefined)).toBe(false);
  });
});
