import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prepare } from "./render/markdown.mjs";

/**
 * The plugin uploads a note without its frontmatter and its comments, by this
 * renderer's rules, which it repeats in its own language. Each upload in the
 * shared table has to be read here exactly as the note it came from: if the
 * renderer's rules change, this is where the plugin's copy is found wanting.
 */
const { cases } = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../contracts/publish-source-cases.json", import.meta.url)),
    "utf8"
  )
);

describe("the shared upload contract, on the bridge", () => {
  for (const { name, note, upload } of cases) {
    it(`renders the upload as the note: ${name}`, () => {
      expect(prepare(upload)).toBe(prepare(note));
    });
  }

  it("renders whatever the plugin makes of a text as it renders the text", async () => {
    // The suite runs both halves, so the plugin's copy of the rules can be
    // held to this renderer's directly, over many small texts made of the
    // characters that decide where a comment and a code span are.
    const { sourceForUpload } = await import("../../src/services/publish-source.ts");
    let seed = 11;
    const random = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = ["%", "%%", "`", "``", "```", "a", "\n", "---\n", "~~~", " ", "\r\n"];
    for (let round = 0; round < 5000; round += 1) {
      let text = "";
      const length = 1 + random(16);
      for (let i = 0; i < length; i += 1) text += pieces[random(pieces.length)];
      expect(prepare(sourceForUpload(text)), JSON.stringify(text)).toBe(prepare(text));
    }
  });
});
