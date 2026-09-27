import { describe, it, expect } from "vitest";
import { plainNoteText } from "./note-text";

describe("plainNoteText", () => {
  it("drops the frontmatter and keeps the text below it", () => {
    const note = "---\ntitle: Brief\ncreated: 2024-03-01\n---\nSehr geehrte Damen und Herren";
    expect(plainNoteText(note)).toBe("Sehr geehrte Damen und Herren");
  });

  it("leaves a note without frontmatter alone, even one that starts with a rule", () => {
    expect(plainNoteText("Text\n---\nmore")).toBe("Text\n---\nmore");
  });

  it("reads Windows line endings like any others", () => {
    expect(plainNoteText("---\r\na: 1\r\n---\r\nText")).toBe("Text");
  });

  it("drops fenced code, backticks and tildes alike, and an unclosed fence to the end", () => {
    const note = "Vorher\n```js\nconst x = 1;\n```\nMitte\n~~~\nlog\n~~~\nDanach\n```\nnie zu";
    expect(plainNoteText(note)).toBe("Vorher\nMitte\nDanach");
  });

  it("does not let a shorter fence close a longer one", () => {
    expect(plainNoteText("a\n````\n```\ninside\n````\nb")).toBe("a\nb");
  });

  it("reduces links to the words they show", () => {
    expect(plainNoteText("See [[Folder/Mietvertrag#§ 3|den Vertrag]] and [[Abrechnung.md]]")).toBe(
      "See den Vertrag and Abrechnung"
    );
    expect(plainNoteText("[the site](https://example.com/a?b=c) says")).toBe("the site says");
  });

  it("drops embeds and keeps an image's alt text", () => {
    expect(plainNoteText("a ![[photo.jpg]] b ![Balkon](img/b.png) c")).toBe("a b Balkon c");
  });

  it("drops URLs, encoded data and comments", () => {
    const note =
      "Siehe https://example.com/x und data:image/png;base64,AAAA %%privat%% <!-- alt --> Ende";
    expect(plainNoteText(note)).toBe("Siehe und Ende");
  });

  it("drops a run too long to be a word", () => {
    expect(plainNoteText(`key ${"x".repeat(120)} done`)).toBe("key done");
  });

  it("keeps headings, which the chunker cuts at", () => {
    expect(plainNoteText("# Titel\nText\n## Zwei\nMehr")).toBe("# Titel\nText\n## Zwei\nMehr");
  });

  it("reads at most maxChars and survives what is not a string", () => {
    expect(plainNoteText("abcdef", 3)).toBe("abc");
    expect(plainNoteText(undefined)).toBe("");
    expect(plainNoteText(42)).toBe("");
  });
});

describe("plainNoteText — what is not data", () => {
  it("keeps prose written without spaces", () => {
    const sentence = "这是一个很长的中文句子".repeat(10);
    expect(plainNoteText(sentence)).toBe(sentence);
  });

  it("does not take inline code on a line for a fence", () => {
    expect(plainNoteText("```inline``` code\nnext line")).toBe("```inline``` code\nnext line");
  });

  it("does not close a fence on a line that carries more than the fence", () => {
    expect(plainNoteText("```\ncode\n``` not a close\nstill code\n```\nafter")).toBe("after");
  });

  it("does not take a capitalised word for a scheme", () => {
    expect(plainNoteText("Data: collected in 2024")).toBe("Data: collected in 2024");
  });
});

describe("plainNoteText — code that looks like markup", () => {
  it("does not open a comment inside inline code", () => {
    expect(plainNoteText('Use `printf("%%d")` to print.\n\nJahresabrechnung Miete')).toContain(
      "Jahresabrechnung Miete"
    );
  });

  it("closes a fence indented deeper, as in a list item", () => {
    const note = "1. Schritt\n   ```bash\n   rm -rf\n    ```\n2. Weiter Jahresabrechnung";
    expect(plainNoteText(note)).toBe("1. Schritt\n2. Weiter Jahresabrechnung");
  });
});
