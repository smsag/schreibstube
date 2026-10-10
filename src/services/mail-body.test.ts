import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "./mail-body";

describe("markdownToPlainText, what must never reach a recipient", () => {
  it("drops an inline comment", () => {
    expect(markdownToPlainText("Frist %% intern: nicht verhandelbar %% bis Freitag")).toBe(
      "Frist  bis Freitag"
    );
  });

  it("drops a comment over several lines", () => {
    expect(markdownToPlainText("Anfang\n%%\nprivat\nnoch privat\n%%\nEnde")).toBe("Anfang\n\nEnde");
  });

  it("drops everything after a comment that is never closed, as Obsidian hides it", () => {
    expect(markdownToPlainText("Öffentlich\n%% ab hier privat\nund das auch")).toBe("Öffentlich");
  });

  it("drops an HTML comment", () => {
    expect(markdownToPlainText("Ende <!-- Entwurf 3 -->")).toBe("Ende");
  });
});

describe("markdownToPlainText, emphasis and structure", () => {
  it("writes emphasis without its marks", () => {
    expect(markdownToPlainText("**fett**, *kursiv*, _auch_, ~~alt~~ und ==markiert==")).toBe(
      "fett, kursiv, auch, alt und markiert"
    );
  });

  it("reads a bold heading line from the note that showed the asterisks", () => {
    expect(markdownToPlainText("**1. Wasserschaden Juli 2025 – Kosten (ca. 900 €)**")).toBe(
      "1. Wasserschaden Juli 2025 – Kosten (ca. 900 €)"
    );
  });

  it("leaves underscores inside words and lone stars alone", () => {
    expect(markdownToPlainText("snake_case_name und 2 * 3 * 4")).toBe(
      "snake_case_name und 2 * 3 * 4"
    );
  });

  it("writes a heading as its text", () => {
    expect(markdownToPlainText("## Offene Punkte ##")).toBe("Offene Punkte");
  });

  it("keeps a hash that is part of the heading's text", () => {
    expect(markdownToPlainText("# C#")).toBe("C#");
    expect(markdownToPlainText("# C# #")).toBe("C#");
  });

  it("writes tasks as boxes and every bullet as a dash", () => {
    expect(markdownToPlainText("- [ ] offen\n- [x] erledigt\n* Stern\n+ Plus")).toBe(
      "☐ offen\n☑ erledigt\n- Stern\n- Plus"
    );
  });

  it("gives a started and a cancelled task boxes of their own", () => {
    expect(markdownToPlainText("- [/] begonnen\n- [-] gestrichen\n- [>] vertagt")).toBe(
      "◧ begonnen\n☒ gestrichen\n☐ vertagt"
    );
  });

  it("keeps numbered lists as written", () => {
    expect(markdownToPlainText("1. Erstens\n2. Zweitens")).toBe("1. Erstens\n2. Zweitens");
  });

  it("writes a callout as a quote under its title, or its kind", () => {
    expect(markdownToPlainText("> [!warning] Frist\n> bis **Freitag**")).toBe(
      "> Frist\n> bis Freitag"
    );
    expect(markdownToPlainText("> [!note]\n> Text")).toBe("> Note\n> Text");
  });

  it("drops a block id", () => {
    expect(markdownToPlainText("Ein Absatz ^abc-123")).toBe("Ein Absatz");
  });

  it("draws a rule as a line rather than reading its stars as emphasis", () => {
    expect(markdownToPlainText("oben\n\n***\n\nunten")).toBe("oben\n\n————————\n\nunten");
  });

  it("unescapes a character written literally", () => {
    expect(markdownToPlainText("5 \\* 3 und \\_nicht kursiv\\_")).toBe("5 * 3 und _nicht kursiv_");
  });

  it("collapses the blank lines left behind to one", () => {
    expect(markdownToPlainText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("reads Windows line endings", () => {
    expect(markdownToPlainText("**a**\r\nb")).toBe("a\nb");
  });
});

describe("markdownToPlainText, links", () => {
  it("writes a web link as its text with the address after it", () => {
    expect(markdownToPlainText("[BGH-Urteil](https://example.de/v_zr_57_12)")).toBe(
      "BGH-Urteil (https://example.de/v_zr_57_12)"
    );
  });

  it("writes a link whose text is its address once", () => {
    expect(markdownToPlainText("[https://x.de](https://x.de)")).toBe("https://x.de");
    expect(markdownToPlainText("[a@x.de](mailto:a@x.de)")).toBe("a@x.de");
  });

  it("writes a link to a note as its text only, since no recipient can open it", () => {
    expect(markdownToPlainText("[Protokoll](Protokoll%202025.md)")).toBe("Protokoll");
  });

  it("writes a wikilink as its alias, or as the note and heading it names", () => {
    expect(markdownToPlainText("[[Ordner/Protokoll 2025|das Protokoll]]")).toBe("das Protokoll");
    expect(markdownToPlainText("[[Ordner/Protokoll 2025#Punkt 3]]")).toBe(
      "Protokoll 2025 › Punkt 3"
    );
    expect(markdownToPlainText("[[Notiz#^block]]")).toBe("Notiz");
  });

  it("names an embed that cannot travel in a text mail", () => {
    expect(markdownToPlainText("Siehe ![[Scans/Rechnung.pdf]]")).toBe("Siehe [Rechnung.pdf]");
    expect(markdownToPlainText("![Grundriss](https://x.de/plan.png)")).toBe(
      "Grundriss (https://x.de/plan.png)"
    );
  });

  it("keeps the stars and underscores of a bare address", () => {
    expect(markdownToPlainText("https://x.de/a_b_c/*/d_e_")).toBe("https://x.de/a_b_c/*/d_e_");
  });

  it("writes an autolink as its address", () => {
    expect(markdownToPlainText("<https://x.de/a>")).toBe("https://x.de/a");
  });
});

describe("markdownToPlainText, code", () => {
  it("keeps inline code as written, without its backticks", () => {
    expect(markdownToPlainText("Aufruf `f(**x**)` hier")).toBe("Aufruf f(**x**) hier");
  });

  it("keeps a fenced block as written and drops only its fences", () => {
    expect(markdownToPlainText("```js\nconst a = **b**; // %% bleibt %%\n```")).toBe(
      "const a = **b**; // %% bleibt %%"
    );
  });

  it("keeps a fence-looking line inside a block, dropping only the block's own", () => {
    const note = "```md\nBeispiel:\n~~~\ncode\n~~~\n```\nDanach";
    expect(markdownToPlainText(note)).toBe("Beispiel:\n~~~\ncode\n~~~\nDanach");
    expect(markdownToPlainText("````\n```\ninner\n```\n````")).toBe("```\ninner\n```");
  });
});
