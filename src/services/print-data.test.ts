import { describe, expect, it } from "vitest";
import { formatDate, noteTitle, resolvePrintData, templateNameOf } from "./print-data";
import { parseTemplate } from "./print-template";

const template = (data: Record<string, string>) =>
  parseTemplate("Vorlagen/Druck/Brief", { schreibstubeData: data }).template;

const context = {
  title: "Kündigung",
  noteName: "2026-04-12",
  now: new Date(2026, 3, 12),
  locale: "de" as const
};

describe("resolvePrintData", () => {
  it("offers what the plugin knows without being told", () => {
    expect(resolvePrintData(template({}), null, context)).toEqual({
      title: "Kündigung",
      noteName: "2026-04-12",
      date: "12.04.2026",
      isoDate: "2026-04-12",
      year: "2026"
    });
  });

  it("lets the template state what is always the same", () => {
    const data = resolvePrintData(template({ senderName: "Steffen Seitz" }), null, context);
    expect(data.senderName).toBe("Steffen Seitz");
  });

  it("lets the note win, because the note is the more specific of the two", () => {
    const data = resolvePrintData(
      template({ senderName: "Steffen Seitz", subject: "" }),
      { schreibstubePrint: { subject: "Kündigung Tanzkurs", date: "1. Mai 2026" } },
      context
    );
    expect(data.subject).toBe("Kündigung Tanzkurs");
    expect(data.date).toBe("1. Mai 2026");
    expect(data.senderName).toBe("Steffen Seitz");
  });

  it("flattens a multi-line value the way a recipient is written", () => {
    const data = resolvePrintData(
      template({}),
      { schreibstubePrint: { recipient: ["Frau Ekinci", "Hintere Marktstraße 83"] } },
      context
    );
    expect(data.recipient).toBe("Frau Ekinci\nHintere Marktstraße 83");
  });

  it("ignores a print block that is not a map, or a value that is not printable", () => {
    expect(resolvePrintData(template({}), { schreibstubePrint: "x" }, context).title).toBe(
      "Kündigung"
    );
    const data = resolvePrintData(
      template({}),
      { schreibstubePrint: { ok: "yes", nested: { a: 1 } } },
      context
    );
    expect(data.ok).toBe("yes");
    expect(data.nested).toBeUndefined();
  });
});

describe("templateNameOf", () => {
  it("reads the template a note asks for", () => {
    expect(templateNameOf({ schreibstubePrintTemplate: " Brief " })).toBe("Brief");
  });

  it("is null when the note asks for none", () => {
    expect(templateNameOf({})).toBeNull();
    expect(templateNameOf(null)).toBeNull();
    expect(templateNameOf({ schreibstubePrintTemplate: "  " })).toBeNull();
    // A descriptor's own flag is a boolean and never a name.
    expect(templateNameOf({ schreibstubePrintTemplate: true })).toBeNull();
  });
});

describe("formatDate", () => {
  it("writes a date the way each language writes one", () => {
    const date = new Date(2026, 3, 1);
    expect(formatDate(date, "de")).toBe("01.04.2026");
    expect(formatDate(date, "en")).toBe("April 1, 2026");
  });

  it("does not depend on the machine's locale data", () => {
    // Two devices, one note: the same date has to print the same way on both.
    expect(formatDate(new Date(2026, 11, 24), "de")).toBe("24.12.2026");
  });
});

describe("noteTitle", () => {
  it("prefers the first level-one heading", () => {
    expect(noteTitle("---\na: b\n---\n\n# Der Titel\n\nText", "datei")).toBe("Der Titel");
  });

  it("falls back to the file name when the note has no heading", () => {
    expect(noteTitle("Nur Text", "2026-04-12")).toBe("2026-04-12");
    // A deeper heading is a section, not the document's name.
    expect(noteTitle("## Abschnitt", "datei")).toBe("datei");
  });
});

describe("a note that opens with a code block", () => {
  it("does not take a shell comment for the document's title", () => {
    expect(noteTitle("```bash\n# install deps\nnpm ci\n```\n\n# Echter Titel", "Datei")).toBe(
      "Echter Titel"
    );
  });
});
