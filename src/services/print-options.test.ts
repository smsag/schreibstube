import { describe, expect, it } from "vitest";
import {
  applyOptions,
  frontmatterRows,
  initialOptions,
  layoutFixesMargin,
  layoutReadsMonospace,
  MARGIN_PRESETS,
  noteMonospace,
  noteSlideAlign,
  noteSlideFormat,
  withTemplate
} from "./print-options";
import { parseTemplate } from "./print-template";

const template = (frontmatter: Record<string, unknown> = {}) =>
  parseTemplate("Vorlagen/Druck/Bericht", frontmatter).template;

describe("initialOptions", () => {
  it("starts from the template as it is, with no properties on paper", () => {
    const own = template({ schreibstubeHrIsPageBreak: true });
    expect(initialOptions(own)).toEqual({
      template: own,
      margin: "standard",
      hrIsPageBreak: true,
      frontmatter: false,
      slideshows: "layout",
      format: "16:9",
      align: "center",
      speakerNotes: false,
      monospace: true,
      pythiaFootnotes: false,
      breaksBefore: []
    });
  });

  it("puts Pythia's footnotes on whenever the note links to Pythia", () => {
    expect(initialOptions(template(), null, 3).pythiaFootnotes).toBe(true);
    expect(initialOptions(template(), null, 0).pythiaFootnotes).toBe(false);
  });

  it("starts the text face where the note asks for it", () => {
    const off = { schreibstubePrint: { monospace: false } };
    expect(initialOptions(template(), off).monospace).toBe(false);
    expect(initialOptions(template(), { schreibstubePrint: { monospace: "nein" } }).monospace).toBe(
      true
    );
  });

  it("offers the three presets, smallest first", () => {
    expect(MARGIN_PRESETS).toEqual(["small", "standard", "wide"]);
  });
});

describe("withTemplate", () => {
  it("takes the new template's page-break habit and keeps the other choices", () => {
    // The breaks set in the preview too: they name blocks of the same text.
    const start = {
      ...initialOptions(template()),
      margin: "wide" as const,
      frontmatter: true,
      breaksBefore: [3]
    };
    const other = template({ schreibstubeHrIsPageBreak: true });
    expect(withTemplate(start, other)).toEqual({
      template: other,
      margin: "wide",
      hrIsPageBreak: true,
      frontmatter: true,
      slideshows: "layout",
      format: "16:9",
      align: "center",
      speakerNotes: false,
      monospace: true,
      pythiaFootnotes: false,
      breaksBefore: [3]
    });
  });
});

describe("applyOptions", () => {
  const own = template({ schreibstubePage: { size: "a5", margin: "20mm 18mm" } });

  it("keeps the template's own margin for standard", () => {
    expect(applyOptions(initialOptions(own)).page).toEqual({ size: "a5", margin: "20mm 18mm" });
  });

  it("replaces it with the preset's for small and wide, and keeps the paper", () => {
    expect(applyOptions({ ...initialOptions(own), margin: "small" }).page).toEqual({
      size: "a5",
      margin: "15mm"
    });
    expect(applyOptions({ ...initialOptions(own), margin: "wide" }).page.margin).toBe("35mm");
  });

  it("carries the page-break choice, and leaves the template itself untouched", () => {
    const applied = applyOptions({ ...initialOptions(own), hrIsPageBreak: true, margin: "small" });
    expect(applied.hrIsPageBreak).toBe(true);
    expect(own.hrIsPageBreak).toBe(false);
    expect(own.page.margin).toBe("20mm 18mm");
  });
});

describe("layoutFixesMargin", () => {
  it("sees a margin the layout sets itself", () => {
    expect(layoutFixesMargin('set page(paper: "a4", margin: (top: 25mm, x: 20mm))')).toBe(true);
    expect(layoutFixesMargin("#set page(\n  margin: 2cm,\n)")).toBe(true);
    expect(layoutFixesMargin("show: page.with(margin: 1in)")).toBe(true);
  });

  it("leaves a layout alone that sets the page without its margin", () => {
    expect(layoutFixesMargin('set page(paper: "a4", footer: [x])')).toBe(false);
    expect(layoutFixesMargin("#let t(body, data) = body")).toBe(false);
  });

  it("does not count a margin that is only mentioned in a comment", () => {
    expect(layoutFixesMargin("// set page(margin: 2cm) is what we used to do\nbody")).toBe(false);
  });

  it("reads the example templates as they are", () => {
    // Brief and Lebenslauf fix their margins; Standard leaves them to the descriptor.
    expect(
      layoutFixesMargin('set page(paper: "a4", margin: (top: 18mm, bottom: 20mm, x: 20mm))')
    ).toBe(true);
  });
});

describe("frontmatterRows", () => {
  it("lists the note's properties in its order, a list on one line", () => {
    expect(frontmatterRows({ autor: "Steffen", tags: ["brief", "anfrage"], seiten: 3 })).toEqual([
      ["autor", "Steffen"],
      ["tags", "brief, anfrage"],
      ["seiten", "3"]
    ]);
  });

  it("leaves out the plugin's own keys and anything with nothing to show", () => {
    expect(
      frontmatterRows({
        schreibstubePrintTemplate: "Brief",
        schreibstubePrint: { subject: "x" },
        position: { start: 0 },
        leer: "",
        titel: "Da"
      })
    ).toEqual([["titel", "Da"]]);
  });

  it("shows a link as the name it points at", () => {
    expect(frontmatterRows({ projekt: "[[Projekte/Umbau|Umbau]]", kunde: "[[Meier]]" })).toEqual([
      ["projekt", "Umbau"],
      ["kunde", "Meier"]
    ]);
  });

  it("reads a date as the day it names, and skips a value it cannot print", () => {
    expect(frontmatterRows({ datum: new Date("2026-09-25T00:00:00Z"), roh: { a: 1 } })).toEqual([
      ["datum", "2026-09-25"]
    ]);
  });

  it("has nothing to show for a note without properties", () => {
    expect(frontmatterRows(undefined)).toEqual([]);
    expect(frontmatterRows(null)).toEqual([]);
  });
});

describe("noteMonospace", () => {
  it("reads the note's word, and nothing else", () => {
    const say = (value: unknown) => noteMonospace({ schreibstubePrint: { monospace: value } });
    expect(say(false)).toBe(false);
    expect(say("off")).toBe(false);
    expect(say(" No ")).toBe(false);
    expect(say(true)).toBe(true);
    expect(say("yes")).toBe(true);
    expect(say("vielleicht")).toBeNull();
    expect(noteMonospace({ schreibstubePrint: "monospace" })).toBeNull();
    expect(noteMonospace(null)).toBeNull();
  });
});

describe("layoutReadsMonospace", () => {
  it("offers the choice only to a layout that reads it, not one that mentions it", () => {
    expect(layoutReadsMonospace('#let s(body, data) = if data.monospace == "true" { body }')).toBe(
      true
    );
    expect(
      layoutReadsMonospace("// data.monospace is not read here\n#let s(body, data) = body")
    ).toBe(false);
  });
});

describe("slide formats", () => {
  const deck = (size = "a4") => template({ schreibstubeSlides: true, schreibstubePage: { size } });

  it("starts at the note's format, else the template's paper, else 16:9", () => {
    expect(initialOptions(deck()).format).toBe("16:9");
    expect(initialOptions(deck("presentation-4-3")).format).toBe("4:3");
    const note = { schreibstubePrint: { format: "4:3" } };
    expect(initialOptions(deck("presentation-16-9"), note).format).toBe("4:3");
  });

  it("reads only the two formats it knows from a note", () => {
    expect(noteSlideFormat({ schreibstubePrint: { format: " 16:9 " } })).toBe("16:9");
    expect(noteSlideFormat({ schreibstubePrint: { format: "21:9" } })).toBeNull();
    expect(noteSlideFormat({ schreibstubePrint: "4:3" })).toBeNull();
    expect(noteSlideFormat(null)).toBeNull();
  });

  it("sets a deck's paper from the format and leaves every other template's alone", () => {
    const applied = applyOptions({ ...initialOptions(deck()), format: "4:3" });
    expect(applied.page.size).toBe("presentation-4-3");
    const paper = applyOptions({ ...initialOptions(template()), format: "4:3" });
    expect(paper.page.size).toBe("a4");
  });

  it("keeps the format when the template changes", () => {
    const start = { ...initialOptions(deck()), format: "4:3" as const };
    expect(withTemplate(start, template()).format).toBe("4:3");
  });
});

describe("slide alignment", () => {
  it("starts centred, or where the note asks", () => {
    expect(initialOptions(template()).align).toBe("center");
    expect(initialOptions(template(), { schreibstubePrint: { align: "Left" } }).align).toBe("left");
  });

  it("reads only the two alignments it knows from a note", () => {
    expect(noteSlideAlign({ schreibstubePrint: { align: "center" } })).toBe("center");
    expect(noteSlideAlign({ schreibstubePrint: { align: "right" } })).toBeNull();
    expect(noteSlideAlign({})).toBeNull();
  });

  it("keeps the alignment when the template changes", () => {
    const start = { ...initialOptions(template()), align: "left" as const };
    expect(withTemplate(start, template()).align).toBe("left");
  });
});
