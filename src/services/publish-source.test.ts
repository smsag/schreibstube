import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderedSource, sourceForUpload, stripComments } from "./publish-source";

/**
 * The uploaded copy of a note, against the table the bridge is tested with,
 * and against many small texts made of the characters that decide where a
 * comment and a code span are.
 */
const { cases } = JSON.parse(readFileSync("contracts/publish-source-cases.json", "utf8")) as {
  cases: { name: string; note: string; upload: string }[];
};

describe("the shared upload contract, in the plugin", () => {
  for (const { name, note, upload } of cases) {
    it(name, () => {
      expect(sourceForUpload(note)).toBe(upload);
      expect(renderedSource(upload)).toBe(renderedSource(note));
    });
  }
});

describe("sourceForUpload", () => {
  it("leaves no comment and no frontmatter in what it uploads", () => {
    const upload = sourceForUpload(
      "---\nsecret: ja\n---\nOffen %%privat%% und\n%%\nmehr Privates\n%%\nEnde"
    );
    expect(upload).not.toContain("privat");
    expect(upload).not.toContain("Privates");
    expect(upload).not.toContain("secret");
  });

  it("uploads text the renderer reads exactly as it reads the note", () => {
    // A seeded generator, so a failure names a text that can be replayed.
    let seed = 7;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = ["%", "%%", "`", "``", "```", "a", "\n", "---\n", "~~~", " "];
    for (let round = 0; round < 5000; round += 1) {
      let text = "";
      const length = 1 + random(16);
      for (let i = 0; i < length; i += 1) text += pieces[random(pieces.length)] ?? "";
      expect(renderedSource(sourceForUpload(text)), JSON.stringify(text)).toBe(
        renderedSource(text)
      );
    }
  });
});

describe("stripComments", () => {
  it("keeps a comment marker in a fence of tildes and in an unclosed fence", () => {
    expect(stripComments("~~~\n%%a%%\n~~~\n%%b%%")).toBe("~~~\n%%a%%\n~~~\n");
    expect(stripComments("````\n%%a%%\n```\n%%b%%")).toBe("````\n%%a%%\n```\n%%b%%");
  });
});
