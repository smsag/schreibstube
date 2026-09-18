import { describe, expect, it } from "vitest";
import { diagramCaption, escapeText, markdownToTypst } from "./markdown-typst";

const convert = (source: string, options = {}): string =>
  markdownToTypst(source, options).body.trim();

/** Diagrams and images resolved, as a caller with a successful capture would. */
const resolved = {
  diagramImage: (block: { index: number }) => [`assets/diagram-${block.index}-0.png`],
  image: ({ source }: { source: string }) => `assets/${source}`
};

describe("blocks", () => {
  it("sets headings at the level they were written", () => {
    expect(convert("# Eins\n\n### Drei")).toBe("= Eins\n\n=== Drei");
  });

  it("drops frontmatter and comments, which are about the note and not in it", () => {
    expect(convert("---\ntitle: x\n---\n\nText %%nicht gedruckt%% hier")).toBe("Text  hier");
  });

  it("joins the lines of a paragraph and separates paragraphs", () => {
    expect(convert("eine\nZeile\n\nzweiter Absatz")).toBe("eine\nZeile\n\nzweiter Absatz");
  });

  it("makes a horizontal rule a line, or a page break when the template says so", () => {
    expect(convert("a\n\n---\n\nb")).toContain("#line(length: 100%)");
    expect(convert("a\n\n---\n\nb", { hrIsPageBreak: true })).toContain("#pagebreak(weak: true)");
  });

  it("keeps a fenced block verbatim, with its language", () => {
    const out = convert("```ts\nconst a = `x`;\n```");
    expect(out).toBe('#schreibstube-code("const a = `x`;", "ts")');
  });

  it("quotes a blockquote and turns a callout into one", () => {
    expect(convert("> gesagt")).toBe("#quote(block: true)[\ngesagt\n]");
    const callout = convert("> [!warning] Achtung\n> Der Text");
    expect(callout).toContain('#schreibstube-callout("warning", [Achtung])[');
    expect(callout).toContain("Der Text");
  });

  it("names a callout after its kind when the author gave no title", () => {
    expect(convert("> [!tip]\n> x")).toContain('#schreibstube-callout("tip", [Tip])[');
  });
});

describe("lists", () => {
  it("carries bullets, numbers and nesting", () => {
    expect(convert("- a\n- b\n  - c")).toBe("- a\n- b\n  - c");
    expect(convert("1. a\n2. b")).toBe("+ a\n+ b");
  });

  it("keeps a sub-list with the item it belongs to", () => {
    const out = convert("- Werkzeuge\n  - Linear\n  - Jira\n- Sprachen");
    expect(out).toBe("- Werkzeuge\n  - Linear\n  - Jira\n- Sprachen");
  });

  it("reads the sample's mixed markers as one list", () => {
    // The CV writes one item with `*` and the rest with `-`; they are one list.
    const out = convert("* erste\n- zweite\n- dritte");
    expect(out.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(3);
  });
});

describe("tables", () => {
  it("carries the columns, the header and the alignment the delimiter row states", () => {
    const out = convert(
      "| Pos | Leistung | Preis |\n|:---:|:---------|------:|\n| 1 | Hosting | 5,99 € |"
    );
    expect(out).toContain("columns: 3");
    expect(out).toContain("align: (center, left, right)");
    expect(out).toContain("table.header([Pos], [Leistung], [Preis])");
    expect(out).toContain("[1], [Hosting], [5,99 €],");
  });

  it("draws no header when the header row is empty, as a summary table has", () => {
    const out = convert("| | |\n|---|---|\n| Summe netto | 71,88 € |");
    expect(out).not.toContain("table.header");
    expect(out).toContain("[Summe netto], [71,88 €],");
  });

  it("pads a short row rather than shifting the columns left", () => {
    const out = convert("| a | b | c |\n|---|---|---|\n| 1 |\n");
    expect(out).toContain("[1], [], [],");
  });
});

describe("inline", () => {
  it("carries emphasis, strong, strikethrough and highlight", () => {
    expect(convert("**fett** und *kursiv*")).toBe("#strong[fett] und #emph[kursiv]");
    expect(convert("~~weg~~ und ==wichtig==")).toBe("#strike[weg] und #highlight[wichtig]");
  });

  it("leaves an underscore inside a word alone", () => {
    expect(convert("snake_case_name")).toBe("snake\\_case\\_name");
  });

  it("keeps a code span verbatim", () => {
    expect(convert("Setze `--flag *x*` ein")).toBe('Setze #raw("--flag *x*") ein');
  });

  it("links out of the document but not into the vault", () => {
    expect(convert("[Seite](https://example.de)")).toBe('#link("https://example.de")[Seite]');
    expect(convert("[[Andere Notiz|so genannt]]")).toBe("so genannt");
    expect(convert("[[Ordner/Notiz#Abschnitt]]")).toBe("Abschnitt");
  });

  it("makes a line break out of <br> without ending the paragraph", () => {
    expect(convert("Steffen Seitz<br>\nSchreinerstraße 21<br>\n10247 Berlin")).toBe(
      "Steffen Seitz \\\nSchreinerstraße 21 \\\n10247 Berlin"
    );
  });

  it("drops other HTML and says that it did", () => {
    const conversion = markdownToTypst("Ein <span class='x'>Wort</span> hier");
    expect(conversion.body.trim()).toBe("Ein Wort hier");
    expect(conversion.warnings).toContain("HTML is dropped when printing");
  });

  it("places a footnote where it is referenced", () => {
    const out = convert("Text[^1] weiter\n\n[^1]: Die Anmerkung");
    expect(out).toBe("Text#footnote[Die Anmerkung] weiter");
  });

  it("honours a backslash escape the way Markdown does", () => {
    expect(convert("Gehalt\\.de")).toBe("Gehalt.de");
  });
});

describe("escapeText", () => {
  it("escapes every character Typst reads as markup", () => {
    expect(escapeText("#let $x$ *a* _b_ [c] <d> @e ~f `g`")).toBe(
      "\\#let \\$x\\$ \\*a\\* \\_b\\_ \\[c\\] \\<d\\> \\@e \\~f \\`g\\`"
    );
  });

  it("escapes what would open a block at the start of a line", () => {
    expect(escapeText("= kein Titel")).toBe("\\= kein Titel");
    expect(escapeText("- keine Liste")).toBe("\\- keine Liste");
    expect(escapeText("1. keine Nummer")).toBe("\\1. keine Nummer");
    expect(escapeText("/ kein Begriff")).toBe("\\/ kein Begriff");
  });

  it("leaves the same characters alone inside a line", () => {
    expect(escapeText("bis 100 = genug")).toBe("bis 100 = genug");
  });
});

describe("diagrams", () => {
  const source = "## Der Ablauf\n\n```mermaid\nflowchart TD\n  A --> B\n```";

  it("reports every diagram fence with its language and the heading above it", () => {
    const conversion = markdownToTypst(source, resolved);
    expect(conversion.diagrams).toEqual([
      { index: 0, language: "mermaid", source: "flowchart TD\n  A --> B", caption: "Der Ablauf" }
    ]);
  });

  it("places the captured picture when the caller supplied one", () => {
    expect(markdownToTypst(source, resolved).body).toContain(
      '#schreibstube-diagram(("assets/diagram-0-0.png",), "Der Ablauf")'
    );
  });

  it("places every panel of a fence that drew more than one", () => {
    const conversion = markdownToTypst(source, {
      diagramImage: () => ["assets/a.png", "assets/b.png", "assets/c.png"]
    });
    expect(conversion.body).toContain(
      '#schreibstube-diagram(("assets/a.png", "assets/b.png", "assets/c.png"), "Der Ablauf")'
    );
  });

  it("prints the source when the capture produced no panel at all", () => {
    const conversion = markdownToTypst(source, { diagramImage: () => [] });
    expect(conversion.body).toContain('#schreibstube-code("flowchart TD\\n  A --> B", "mermaid")');
    expect(conversion.warnings).toContain("mermaid: could not be drawn, printed as source");
  });

  it("prints the source and warns when the capture failed, rather than losing it", () => {
    const conversion = markdownToTypst(source, { diagramImage: () => null });
    expect(conversion.body).toContain('#schreibstube-code("flowchart TD\\n  A --> B", "mermaid")');
    expect(conversion.warnings).toContain("mermaid: could not be drawn, printed as source");
  });

  it("numbers diagrams across the whole note, including inside a callout", () => {
    const conversion = markdownToTypst(
      "```mermaid\na\n```\n\n> [!note] X\n> ```vizardry\nb\n> ```\n\n```mermaid\nc\n```",
      resolved
    );
    expect(conversion.diagrams.map((d) => d.index)).toEqual([0, 1, 2]);
  });
});

describe("images", () => {
  it("places an image the caller resolved and keeps its description", () => {
    expect(convert("![Ein Foto](foto.jpg)", resolved)).toBe(
      '#schreibstube-image("assets/foto.jpg", "Ein Foto")'
    );
  });

  it("places an embedded picture the same way", () => {
    expect(convert("![[foto.png]]", resolved)).toBe('#schreibstube-image("assets/foto.png", "")');
  });

  it("keeps the description and warns when the picture is missing", () => {
    const conversion = markdownToTypst("![Ein Foto](weg.jpg)", { image: () => null });
    expect(conversion.body.trim()).toBe("Ein Foto");
    expect(conversion.warnings).toContain("image not found: weg.jpg");
  });

  it("says so rather than printing the name of an embedded note", () => {
    const conversion = markdownToTypst("![[Andere Notiz]]", resolved);
    expect(conversion.warnings).toContain("embedded note is not printed: Andere Notiz");
  });
});

describe("the sample documents", () => {
  it("converts the letter's structure: tables, links and line breaks", () => {
    const conversion = markdownToTypst(
      [
        "Sehr geehrte Damen und Herren,",
        "",
        "| Position | Leistung | Gesamt |",
        "|:-------:|:---------|-------:|",
        "| 1 | Hosting für [karma-kosmetik.de](https://karma-kosmetik.de) | 71,88 € |",
        "",
        "Kontoinhaber: Steffen Seitz<br>",
        "IBAN: DE64 5001 0517 5447 1474 36"
      ].join("\n")
    );

    expect(conversion.warnings).toEqual([]);
    expect(conversion.body).toContain("align: (center, left, right)");
    expect(conversion.body).toContain('#link("https://karma-kosmetik.de")[karma-kosmetik.de]');
    expect(conversion.body).toContain("Kontoinhaber: Steffen Seitz \\\nIBAN:");
  });

  it("converts the CV's heading ladder and its lists", () => {
    const conversion = markdownToTypst(
      [
        "### Berufserfahrung",
        "",
        "#### **Senior Technical PM**",
        "",
        "##### *Propstack GmbH* | *Oktober 2025 – heute*",
        "",
        "* Ein Punkt mit 3.000 Anfragen.",
        "- Noch einer."
      ].join("\n")
    );

    expect(conversion.warnings).toEqual([]);
    expect(conversion.body).toContain("=== Berufserfahrung");
    expect(conversion.body).toContain("==== #strong[Senior Technical PM]");
    expect(conversion.body).toContain("===== #emph[Propstack GmbH] | #emph[Oktober 2025 – heute]");
    expect(conversion.body).toContain("- Ein Punkt mit 3.000 Anfragen.");
  });
});

describe("diagramCaption", () => {
  it("prefers what the note calls it", () => {
    expect(diagramCaption("Der Ablauf", "Wardley Map")).toBe("Der Ablauf");
  });

  it("falls back to what the drawing calls itself", () => {
    expect(diagramCaption("", "Wardley Map")).toBe("Wardley Map");
    expect(diagramCaption("   ", "Wardley Map")).toBe("Wardley Map");
  });

  it("leaves a picture unlabelled rather than inventing a label", () => {
    expect(diagramCaption("", "")).toBe("");
    expect(diagramCaption("  ", "  ")).toBe("");
  });

  it("trims, because a heading carries its own spacing", () => {
    expect(diagramCaption("  Der Ablauf  ", "")).toBe("Der Ablauf");
  });
});

describe("a diagram the drawing named itself", () => {
  const withHeading = "## Der Ablauf\n\n```vizardry\ncanvas: wardley\n```";
  const bare = "```vizardry\ncanvas: wardley\n```";
  const drawn = {
    diagramImage: () => ["assets/diagram-0-0.png"],
    diagramTitle: () => "Wardley Map"
  };

  it("keeps the heading when the note gave one", () => {
    expect(markdownToTypst(withHeading, drawn).body).toContain('"Der Ablauf"');
  });

  it("uses the drawing's own name when the note gave none", () => {
    expect(markdownToTypst(bare, drawn).body).toContain('"Wardley Map"');
  });

  it("carries a fence through whatever the fence says inside it", () => {
    // A canvas that renders minimized is still a canvas, and its source is
    // passed through untouched: what the fence means is the plugin's business.
    const collapsed = "```vizardry\ncanvas: wardley\ncollapsed: true\n```";
    const conversion = markdownToTypst(collapsed, drawn);
    expect(conversion.diagrams).toHaveLength(1);
    expect(conversion.diagrams[0]?.source).toContain("collapsed: true");
    expect(conversion.body).toContain("#schreibstube-diagram");
  });
});

describe("what Typst would have refused or swallowed", () => {
  it("closes both brackets of a bold italic word", () => {
    expect(convert("***fett kursiv***")).toBe("#strong[#emph[fett kursiv]]");
    expect(convert("___fett kursiv___")).toBe("#strong[#emph[fett kursiv]]");
  });

  it("keeps an autolink as a link rather than dropping it as HTML", () => {
    const result = markdownToTypst("Siehe <https://example.de> hier.");
    expect(result.body).toContain('#link("https://example.de")');
    expect(result.warnings).toEqual([]);
  });

  it("escapes what Typst reads as a comment", () => {
    expect(escapeText("Siehe https://example.de jetzt")).not.toContain("://");
    // The block comment is already broken up by the escape on the asterisk.
    expect(escapeText("a /* b */ c")).not.toContain("/*");
  });

  it("does not open emphasis on an underscore inside a word", () => {
    expect(convert("my_var and _this_ end")).toBe("my\\_var and #emph[this] end");
  });

  it("leaves a comment marker inside a fenced block alone", () => {
    const body = markdownToTypst("```sql\nSELECT 1 %% a\nSELECT 2 %% b\n```").body;
    expect(body).toContain("SELECT 1 %% a");
    expect(body).toContain("SELECT 2 %% b");
  });

  it("still strips a comment written in prose", () => {
    expect(markdownToTypst("Vorher %%geheim%% nachher.").body).toContain("Vorher  nachher.");
  });

  it("nests a list indented with a tab", () => {
    expect(convert("- eins\n\t- zwei\n- drei")).toContain("  - zwei");
  });
});
