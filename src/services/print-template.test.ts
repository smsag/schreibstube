import { describe, expect, it } from "vitest";
import {
  checkLayout,
  chooseTemplate,
  DEFAULT_ENTRY,
  IMAGE_MAX_PX_DEFAULT,
  IMAGE_MAX_PX_LIMIT,
  isFontFile,
  parseTemplate
} from "./print-template";

const parse = (frontmatter: Record<string, unknown>) =>
  parseTemplate("Vorlagen/Druck/Brief", frontmatter);

describe("parseTemplate", () => {
  it("names the template after its folder", () => {
    expect(parse({}).template.name).toBe("Brief");
    expect(parseTemplate("Brief/", {}).template.name).toBe("Brief");
  });

  it("falls back to a whole template when the descriptor says nothing", () => {
    const { template, problems } = parse({});
    expect(problems).toEqual([]);
    expect(template).toMatchObject({
      page: { size: "a4", margin: null },
      hrIsPageBreak: false,
      entry: DEFAULT_ENTRY,
      data: {}
    });
    expect(template.images.maxPx).toBe(IMAGE_MAX_PX_DEFAULT);
  });

  it("reads the page it was given", () => {
    const { template, problems } = parse({
      schreibstubePage: { size: "us-letter", margin: "25mm 20mm" }
    });
    expect(problems).toEqual([]);
    expect(template.page).toEqual({ size: "us-letter", margin: "25mm 20mm" });
  });

  it("refuses a page that is not a paper name or a set of lengths", () => {
    expect(parse({ schreibstubePage: { size: "A4; #panic()" } }).problems).toEqual([
      'page size "A4; #panic()" is not a paper name'
    ]);
    expect(parse({ schreibstubePage: { margin: "25px" } }).problems).toEqual([
      'page margin "25px" is not one to four lengths'
    ]);
    expect(parse({ schreibstubePage: { margin: "1mm 2mm 3mm 4mm 5mm" } }).problems).toHaveLength(1);
    expect(parse({ schreibstubePage: "a4" }).problems).toEqual([
      "schreibstubePage must be a map with size and margin"
    ]);
  });

  it("reads image bounds and will not be talked past the limit", () => {
    expect(parse({ schreibstubeImages: { maxPx: 800, quality: 0.7 } }).template.images).toEqual({
      maxPx: 800,
      quality: 0.7
    });
    expect(parse({ schreibstubeImages: { maxPx: 99_999 } }).template.images.maxPx).toBe(
      IMAGE_MAX_PX_LIMIT
    );
  });

  it("reads a quality written as a percentage the way it was meant", () => {
    expect(parse({ schreibstubeImages: { quality: 85 } }).template.images.quality).toBe(0.85);
  });

  it("carries the data a template states, flattening what a person may write", () => {
    const { template, problems } = parse({
      schreibstubeData: {
        senderName: "Steffen Seitz",
        senderAddress: ["Schreinerstraße 21", "10247 Berlin"],
        year: 2026,
        draft: false
      }
    });
    expect(problems).toEqual([]);
    expect(template.data).toEqual({
      senderName: "Steffen Seitz",
      senderAddress: "Schreinerstraße 21\n10247 Berlin",
      year: "2026",
      draft: "false"
    });
  });

  it("names a data value it cannot print rather than printing something else", () => {
    expect(parse({ schreibstubeData: { sender: { name: "x" } } }).problems).toEqual([
      "data.sender is not a value a template can print"
    ]);
  });

  it("takes an entry function only if it is one", () => {
    expect(parse({ schreibstubeEntry: "letter" }).template.entry).toBe("letter");
    const bad = parse({ schreibstubeEntry: "letter(); #panic" });
    expect(bad.template.entry).toBe(DEFAULT_ENTRY);
    expect(bad.problems).toHaveLength(1);
  });

  it("treats the page-break option as the flag it is", () => {
    expect(parse({ schreibstubeHrIsPageBreak: true }).template.hrIsPageBreak).toBe(true);
    expect(parse({ schreibstubeHrIsPageBreak: "yes" }).template.hrIsPageBreak).toBe(false);
  });
});

describe("checkLayout", () => {
  it("passes a layout that stays inside its folder", () => {
    expect(checkLayout('#let letter(body, data) = {\n  image("logo.png")\n  body\n}')).toEqual([]);
  });

  it("refuses a package, because printing works offline", () => {
    expect(checkLayout('#import "@preview/cetz:0.2.0": *')).toEqual([
      "line 1: packages cannot be used, printing works offline"
    ]);
    expect(checkLayout('#import "@local/mine:1.0.0": *')).toHaveLength(1);
  });

  it("refuses a path that leaves the folder or starts at the root", () => {
    expect(checkLayout('#image("../../../etc/passwd")')).toEqual([
      "line 1: a path may not leave the template folder"
    ]);
    expect(checkLayout('#read("/etc/hosts")')).toEqual([
      "line 1: a path must be relative to the template folder"
    ]);
  });

  it("reads nothing into a comment, where a mention is not a use", () => {
    expect(checkLayout("// see @preview/cetz for the idea\n#let x = 1")).toEqual([]);
  });

  it("names the line, because that is what a template author has to find", () => {
    expect(checkLayout('#let a = 1\n\n#image("../out.png")')[0]).toContain("line 3");
  });

  it("reads only a string that names a file as a path", () => {
    // Text that happens to hold "../" or starts with "/" is text.
    expect(checkLayout('#text("siehe ../Anhang")\n#let sep = "/"')).toEqual([]);
    expect(checkLayout('#let url = "/impressum"')).toEqual([]);
    expect(checkLayout('#include "../teil.typ"')).toHaveLength(1);
    expect(checkLayout('#let d = json("/daten.json")')).toHaveLength(1);
    expect(checkLayout('#let d = image( "../x.png", width: 1cm)')).toHaveLength(1);
  });
});

describe("isFontFile", () => {
  it("knows the four extensions Typst reads", () => {
    for (const name of ["a.ttf", "b.OTF", "c.ttc", "d.otc"]) expect(isFontFile(name)).toBe(true);
    for (const name of ["a.woff2", "b.png", "fonts"]) expect(isFontFile(name)).toBe(false);
  });
});

describe("chooseTemplate", () => {
  const at = (folder: string) => parseTemplate(folder, {}).template;
  const brief = at("Vorlagen/Druck/Brief");
  const privat = at("Privat/Brief");
  const cv = at("Vorlagen/Druck/Lebenslauf");

  it("asks among all of them when the note names none", () => {
    expect(chooseTemplate([brief, cv], null)).toEqual({ kind: "ask", among: [brief, cv] });
  });

  it("uses the one template a name fits", () => {
    expect(chooseTemplate([brief, cv], "Lebenslauf")).toEqual({ kind: "use", template: cv });
  });

  it("asks among those a name fits when it fits more than one", () => {
    expect(chooseTemplate([brief, privat, cv], "Brief")).toEqual({
      kind: "ask",
      among: [brief, privat]
    });
  });

  it("settles the ambiguity when the note names the folder's path", () => {
    expect(chooseTemplate([brief, privat], "Privat/Brief")).toEqual({
      kind: "use",
      template: privat
    });
    expect(chooseTemplate([brief, privat], "/Privat/Brief/")).toEqual({
      kind: "use",
      template: privat
    });
  });

  it("says which name it could not find", () => {
    expect(chooseTemplate([brief], "Rechnung")).toEqual({ kind: "unknown", name: "Rechnung" });
  });
});

describe("chooseTemplate with a default", () => {
  const at = (folder: string) => parseTemplate(folder, {}).template;
  const brief = at("Vorlagen/Druck/Brief");
  const builtIn = { ...at(":builtin/Standard"), name: "Standard", builtIn: true };
  const copy = at("Vorlagen/Druck/Standard");

  it("prints a note that names none with the built-in template by default", () => {
    expect(chooseTemplate([brief, builtIn], null)).toEqual({ kind: "use", template: builtIn });
  });

  it("prefers a vault copy called by the built-in's name, which is the one a person edited", () => {
    expect(chooseTemplate([brief, copy, builtIn], null)).toEqual({ kind: "use", template: copy });
    expect(chooseTemplate([copy, builtIn], "Standard")).toEqual({ kind: "use", template: copy });
  });

  it("uses a vault template the settings name by its folder", () => {
    expect(chooseTemplate([brief, builtIn], null, "Vorlagen/Druck/Brief")).toEqual({
      kind: "use",
      template: brief
    });
  });

  it("asks every time when the settings say so", () => {
    expect(chooseTemplate([brief, builtIn], null, ":ask")).toEqual({
      kind: "ask",
      among: [brief, builtIn]
    });
  });

  it("asks, and names the default, when the one the settings name has gone", () => {
    expect(chooseTemplate([brief, builtIn], null, "Weg/Vorlage/")).toEqual({
      kind: "ask",
      among: [brief, builtIn],
      missingDefault: "Weg/Vorlage"
    });
  });

  it("never takes the built-in's pseudo-folder for a path a note or setting names", () => {
    expect(chooseTemplate([brief, builtIn], ":builtin/Standard")).toEqual({
      kind: "unknown",
      name: ":builtin/Standard"
    });
    expect(chooseTemplate([brief, builtIn], null, ":builtin/Standard").kind).toBe("ask");
  });

  it("finds the built-in one by name when a note asks for Standard", () => {
    expect(chooseTemplate([brief, builtIn], "Standard")).toEqual({
      kind: "use",
      template: builtIn
    });
  });
});
