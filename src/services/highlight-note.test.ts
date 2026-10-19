import { describe, expect, it } from "vitest";
import {
  composeHighlightNote,
  escapeExcerpt,
  HIGHLIGHTS_PLACEHOLDER,
  normalizeTemplatePath,
  PDF_PLACEHOLDER,
  safeEmbed,
  templateNotePath,
  type HighlightNoteParts
} from "./highlight-note";

const parts: HighlightNoteParts = {
  excerpt: "First […] second",
  pdfEmbed: "![[Creative Selection.pdf]]",
  title: "Creative Selection",
  formatNow: (format) => `<${format}>`,
  dateFormat: "DD.MM.YYYY",
  timeFormat: "HH:mm"
};

describe("the template's core variables", () => {
  it("fills title, and date and time in the core plugin's formats", () => {
    expect(
      composeHighlightNote(`{{title}} · {{date}} · {{time}}\n${HIGHLIGHTS_PLACEHOLDER}`, parts)
    ).toBe("Creative Selection · <DD.MM.YYYY> · <HH:mm>\nFirst […] second");
  });

  it("takes a format written into the variable, and the plugin's for an empty one", () => {
    expect(
      composeHighlightNote(
        `{{date:YYYY}} {{ time : HH }} {{date:}}\n${HIGHLIGHTS_PLACEHOLDER}`,
        parts
      )
    ).toBe("<YYYY> <HH> <DD.MM.YYYY>\nFirst […] second");
  });

  it("leaves variables it does not know, and Templater code, alone", () => {
    const text = `{{weekday}} <% tp.date.now() %>\n${HIGHLIGHTS_PLACEHOLDER}`;
    expect(composeHighlightNote(text, parts)).toBe(
      "{{weekday}} <% tp.date.now() %>\nFirst […] second"
    );
  });

  it("escapes a title that would act in the note", () => {
    const sly = { ...parts, title: '<% app.vault.adapter.remove("Diary.md") %>' };
    const note = composeHighlightNote(`title: {{title}}\n${HIGHLIGHTS_PLACEHOLDER}`, sly);
    expect(note).not.toContain("<%");
    expect(note).toContain('&lt;% app.vault.adapter.remove("Diary.md") %>');
  });

  it("fills in one pass, so nothing that went in is read again", () => {
    const sly = {
      ...parts,
      title: "{{date}}",
      excerpt: `quoted ${PDF_PLACEHOLDER} and {{time}}`
    };
    expect(composeHighlightNote(`{{title}}\n${HIGHLIGHTS_PLACEHOLDER}`, sly)).toBe(
      `{{date}}\nquoted ${PDF_PLACEHOLDER} and {{time}}`
    );
  });
});

describe("the excerpt as prose", () => {
  it("disarms what would link, embed, load, hide or run", () => {
    const escaped = escapeExcerpt(
      "see ![[Secret]], ![](https://tracker/x.png), <b>bold</b>, `code`, %% hidden and <% tp.x %>"
    );
    expect(escaped).not.toMatch(/!\[\[|!\[\]|<b>|`|%%|<%/);
  });

  it("keeps a first word from becoming a heading, a quote or a list", () => {
    expect(escapeExcerpt("# not a heading")).toBe("\\# not a heading");
    expect(escapeExcerpt("> not a quote")).toBe("\\> not a quote");
    expect(escapeExcerpt("- not a list")).toBe("\\- not a list");
    expect(escapeExcerpt("a - b # c")).toBe("a - b # c");
  });

  it("escapes a list number's dot, not its digits", () => {
    expect(escapeExcerpt("1999. war das Jahr")).toBe("1999\\. war das Jahr");
    expect(escapeExcerpt("2) zweitens")).toBe("2\\) zweitens");
    expect(escapeExcerpt("1999 war das Jahr")).toBe("1999 war das Jahr");
  });

  it("leaves ordinary punctuation as written", () => {
    expect(escapeExcerpt("snake_case, *stars* and [brackets] […] 50 %")).toBe(
      "snake_case, *stars* and [brackets] […] 50 %"
    );
  });
});

describe("the embed of the PDF", () => {
  it("is the link Obsidian made, as a rule", () => {
    expect(safeEmbed("![[Bericht.pdf]]", "Bericht.pdf")).toBe("![[Bericht.pdf]]");
  });

  it("is only the name, escaped, when the name would act in the note", () => {
    expect(safeEmbed("![[<% tp.x %>.pdf]]", "<% tp.x %>.pdf")).toBe("&lt;% tp.x %>.pdf");
    expect(safeEmbed("![[a %% b.pdf]]", "a %% b.pdf")).toBe("a %&#37; b.pdf");
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

  it("fills a placeholder used twice both times", () => {
    expect(
      composeHighlightNote(
        `${PDF_PLACEHOLDER}\n${HIGHLIGHTS_PLACEHOLDER}\n${HIGHLIGHTS_PLACEHOLDER}`,
        parts
      )
    ).toBe("![[Creative Selection.pdf]]\nFirst […] second\nFirst […] second");
  });
});

describe("the template setting", () => {
  it("names a note, with .md added when it was left off", () => {
    expect(templateNotePath("Templates/Reading Note")).toBe("Templates/Reading Note.md");
    expect(templateNotePath(" Templates/Reading Note.md ")).toBe("Templates/Reading Note.md");
    expect(templateNotePath("Vorlagen/Lesenotiz.MD")).toBe("Vorlagen/Lesenotiz.MD");
    expect(templateNotePath("  ")).toBe("");
  });

  it("reads a backslash as a folder separator, and refuses what is not a vault path", () => {
    expect(normalizeTemplatePath("Templates\\Lesenotiz")).toBe("Templates/Lesenotiz");
    expect(normalizeTemplatePath("/Templates/Lesenotiz/")).toBe("Templates/Lesenotiz");
    expect(normalizeTemplatePath("")).toBe("");
    expect(normalizeTemplatePath(".templates/Lesenotiz")).toBeNull();
    expect(normalizeTemplatePath("Templates//Lesenotiz")).toBeNull();
    expect(normalizeTemplatePath(42)).toBeNull();
  });
});
