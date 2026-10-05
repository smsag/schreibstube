import { describe, expect, it } from "vitest";
import { EXECUTING_FENCE_LANGUAGES, findExecutableCode } from "./executable-code";
import {
  escapeForeignText,
  foreignLine,
  neutralizeExecutableCode,
  neutralizeIntroducedCode
} from "./foreign-text";
import { fenceMarker } from "./markdown-fence";

describe("escapeForeignText", () => {
  it("leaves ordinary prose exactly as it was", () => {
    const prose = "Hallo Anna, 3 < 4 und 50 % Rabatt. Schreib an <k@example.com>.";
    expect(escapeForeignText(prose)).toBe(prose);
  });

  it("escapes wikilinks and both kinds of embed", () => {
    expect(escapeForeignText("[[Notiz]] ![[Bild.png]] ![](x.png)")).toBe(
      "\\[\\[Notiz]] !\\[\\[Bild.png]] !\\[](x.png)"
    );
  });

  it("turns every HTML opener into an entity, comments and declarations included", () => {
    expect(escapeForeignText('<img src="x"> </p> <!-- x --> <!DOCTYPE html> <?php')).toBe(
      '&lt;img src="x"> &lt;/p> &lt;!-- x --> &lt;!DOCTYPE html> &lt;?php'
    );
  });

  it("leaves no backtick, so neither an inline span nor a fence can form", () => {
    const escaped = escapeForeignText("`$= dv.pages().length`\n```dataviewjs\nx\n```");
    expect(escaped).not.toContain("`");
    expect(findExecutableCode(escaped)).toEqual([]);
  });

  it("breaks a tilde fence without touching strikethrough", () => {
    const escaped = escapeForeignText("~~~dataviewjs\nx\n~~~\n~~weg~~");
    expect(escaped.split("\n").some((line) => fenceMarker(line) !== null)).toBe(false);
    expect(escaped).toContain("~~weg~~");
  });

  it("disarms a Templater tag and an Obsidian comment", () => {
    const escaped = escapeForeignText("<% tp.file.move('x') %> %%versteckt%%");
    expect(escaped).not.toContain("<%");
    expect(escaped).not.toContain("%%");
    expect(escaped).toBe("&lt;% tp.file.move('x') %> %&#37;versteckt%&#37;");
  });

  it("cannot be undone by a backslash the sender put in front", () => {
    const escaped = escapeForeignText("\\`$= 1\\` \\<% x %> \\%%");
    expect(findExecutableCode(escaped)).toEqual([]);
    expect(escaped).not.toMatch(/(?<!\\)`/);
    expect(escaped).not.toContain("%%");
  });

  it("makes every line ending a newline", () => {
    expect(escapeForeignText("a\rb\r\nc")).toBe("a\nb\nc");
  });
});

describe("foreignLine", () => {
  it("collapses the text to one escaped line", () => {
    expect(foreignLine("  Rechnung\n# Titel\r![[x]]  ")).toBe("Rechnung # Titel !\\[\\[x]]");
  });

  it("cuts a long name by characters, with an ellipsis", () => {
    expect(foreignLine("ä".repeat(10), 5)).toBe("ääää…");
    expect(foreignLine("kurz", 5)).toBe("kurz");
  });
});

describe("neutralizeIntroducedCode", () => {
  it("relabels a fence the source did not hold, keeping its body", () => {
    for (const language of EXECUTING_FENCE_LANGUAGES) {
      const result = neutralizeIntroducedCode(
        "Zahlen",
        `Fazit\n\`\`\`${language}\nrun()\n\`\`\`\n`
      );
      expect(findExecutableCode(result.text), language).toEqual([]);
      expect(result.text).toContain(`\`\`\`text ${language}\nrun()\n\`\`\``);
      expect(result.kinds).toEqual([language]);
    }
  });

  it("disarms an inline span and a Templater tag, which then read the same", () => {
    const result = neutralizeIntroducedCode(
      "",
      "Summe `$= dv.pages().length` am <% tp.date.now() %>"
    );
    expect(result.text).toBe("Summe &#96;$= dv.pages().length&#96; am &lt;% tp.date.now() %>");
    expect(result.kinds).toEqual(["dataviewjs", "templater"]);
  });

  it("disarms a tag inside a span as well as the span", () => {
    const result = neutralizeExecutableCode("`$= '<% x %>'`");
    expect(findExecutableCode(result.text)).toEqual([]);
    expect(result.text).not.toContain("<%");
  });

  it("keeps a construct the source already held, word for word", () => {
    const query = "```dataviewjs\ndv.list([1])\n```\n";
    const result = neutralizeIntroducedCode(
      `Über diese Abfrage:\n${query}`,
      `Sie listet:\n${query}`
    );
    expect(result.text).toBe(`Sie listet:\n${query}`);
    expect(result.kinds).toEqual([]);
  });

  it("does not keep a changed copy of the source's construct", () => {
    const result = neutralizeIntroducedCode("`$= 1`", "`$= app.vault.delete()`");
    expect(result.kinds).toEqual(["dataviewjs"]);
  });

  it("relabels an indented tilde fence", () => {
    const result = neutralizeExecutableCode("  ~~~DataviewJS\nx\n  ~~~\n");
    expect(result.text).toBe("  ~~~text DataviewJS\nx\n  ~~~\n");
  });

  it("returns plain Markdown untouched", () => {
    const text = "## Fazit\n\n- **Umsatz** +4 %\n- `code` bleibt\n\n```js\nshown()\n```\n";
    expect(neutralizeExecutableCode(text)).toEqual({ text, kinds: [] });
  });
});
