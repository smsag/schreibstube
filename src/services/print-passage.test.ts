import { describe, expect, it } from "vitest";
import { MAX_PASSAGE_TITLE_CHARS, passageFileName } from "./print-passage";

describe("passageFileName", () => {
  it("names the PDF after the note and the passage's first heading", () => {
    expect(passageFileName("Bewerbung Nascor", "## Lebenslauf\n\nText", "Auswahl")).toBe(
      "Bewerbung Nascor – Lebenslauf"
    );
  });

  it("takes the first heading of any level, and none from inside code", () => {
    const passage = "```sh\n# install\n```\n\nText\n\n#### Berufserfahrung";
    expect(passageFileName("Note", passage, "Auswahl")).toBe("Note – Berufserfahrung");
  });

  it("falls back to the word for a selection without a heading, or with the note's own name", () => {
    expect(passageFileName("Note", "Nur ein Absatz.", "Auswahl")).toBe("Note – Auswahl");
    expect(passageFileName("Note", "# Note\n\nText", "Auswahl")).toBe("Note – Auswahl");
  });

  it("keeps a heading's words and leaves out what a file name cannot carry", () => {
    expect(passageFileName("N", "## **Lebenslauf**: 2026/27 [[Ziel|Ort]] #tag", "x")).toBe(
      "N – Lebenslauf 2026 27 Ort tag"
    );
    expect(passageFileName("N", "## [Profil](https://x.de) `code`", "x")).toBe("N – Profil code");
  });

  it("caps a long heading", () => {
    const name = passageFileName("N", `## ${"Wort ".repeat(40)}`, "x");
    expect(name.length).toBeLessThanOrEqual("N – ".length + MAX_PASSAGE_TITLE_CHARS);
    expect(name.endsWith(" ")).toBe(false);
  });
});
