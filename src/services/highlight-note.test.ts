import { describe, expect, it } from "vitest";
import {
  composeHighlightNote,
  escapeExcerpt,
  fillCoreVariables,
  HIGHLIGHTS_PLACEHOLDER,
  PDF_PLACEHOLDER,
  templateNotePath
} from "./highlight-note";

const values = { title: "Creative Selection", now: new Date(2026, 9, 19, 8, 5), locale: "en" };
const parts = { excerpt: "First […] second", pdfEmbed: "![[Creative Selection.pdf]]" };

describe("the template's core variables", () => {
  it("fills title, date and time in the core plugin's default formats", () => {
    expect(fillCoreVariables("{{title}} · {{date}} · {{time}}", values)).toBe(
      "Creative Selection · 2026-10-19 · 08:05"
    );
  });

  it("takes a format written into the variable", () => {
    expect(fillCoreVariables("{{date:DD.MM.YYYY}} {{ time : HH }}", values)).toBe("19.10.2026 08");
    expect(fillCoreVariables("{{date:}}", values)).toBe("2026-10-19");
  });

  it("leaves variables it does not know, and its own placeholders, alone", () => {
    const text = `{{weekday}} ${HIGHLIGHTS_PLACEHOLDER} <% tp.date.now() %>`;
    expect(fillCoreVariables(text, values)).toBe(text);
  });
});

describe("the excerpt as prose", () => {
  it("escapes what would make it a link, an embed, HTML or code", () => {
    expect(escapeExcerpt("see ![[Secret]] and <b>bold</b> or `code` \\n")).toBe(
      "see !\\[\\[Secret]] and \\<b>bold\\</b> or \\`code\\` \\\\n"
    );
  });

  it("keeps a first word from becoming a heading, a quote or a list", () => {
    expect(escapeExcerpt("# not a heading")).toBe("\\# not a heading");
    expect(escapeExcerpt("> not a quote")).toBe("\\> not a quote");
    expect(escapeExcerpt("- not a list")).toBe("\\- not a list");
    expect(escapeExcerpt("1. not a list")).toBe("\\1. not a list");
    expect(escapeExcerpt("a - b # c")).toBe("a - b # c");
  });

  it("leaves ordinary punctuation as written", () => {
    expect(escapeExcerpt("snake_case, *stars* and [brackets] […]")).toBe(
      "snake_case, *stars* and [brackets] […]"
    );
  });
});

describe("the note", () => {
  it("puts the excerpt and the embed where the template says", () => {
    const template = `---\ntype: Reading Note\n---\n### Auszug\n\n${HIGHLIGHTS_PLACEHOLDER}\n\n## Ressourcen\n\n${PDF_PLACEHOLDER}\n`;
    expect(composeHighlightNote(template, parts)).toBe(
      "---\ntype: Reading Note\n---\n### Auszug\n\nFirst […] second\n\n## Ressourcen\n\n![[Creative Selection.pdf]]\n"
    );
  });

  it("adds the excerpt at the end of a template without a place for it, and no embed", () => {
    expect(composeHighlightNote("---\ntype: x\n---\n## Notes\n\n", parts)).toBe(
      "---\ntype: x\n---\n## Notes\n\nFirst […] second\n"
    );
  });

  it("makes a note of the excerpt and the embed without a template", () => {
    const expected = "First […] second\n\n![[Creative Selection.pdf]]\n";
    expect(composeHighlightNote(null, parts)).toBe(expected);
    expect(composeHighlightNote("  \n", parts)).toBe(expected);
  });

  it("does not fill a placeholder that came out of the PDF", () => {
    const sly = { ...parts, excerpt: `quoted ${PDF_PLACEHOLDER} text` };
    expect(composeHighlightNote(`${HIGHLIGHTS_PLACEHOLDER}`, sly)).toBe(
      `quoted ${PDF_PLACEHOLDER} text`
    );
  });

  it("fills a placeholder used twice both times", () => {
    expect(
      composeHighlightNote(
        `${PDF_PLACEHOLDER}\n${HIGHLIGHTS_PLACEHOLDER}\n${PDF_PLACEHOLDER}`,
        parts
      )
    ).toBe("![[Creative Selection.pdf]]\nFirst […] second\n![[Creative Selection.pdf]]");
  });
});

describe("the template setting", () => {
  it("names a note, with .md added when it was left off", () => {
    expect(templateNotePath("Templates/Reading Note")).toBe("Templates/Reading Note.md");
    expect(templateNotePath(" Templates/Reading Note.md ")).toBe("Templates/Reading Note.md");
    expect(templateNotePath("Vorlagen/Lesenotiz.MD")).toBe("Vorlagen/Lesenotiz.MD");
    expect(templateNotePath("  ")).toBe("");
  });
});
