import { describe, expect, it } from "vitest";
import { segmentMarkdown, type ProseBlock } from "./markdown-segments";
import {
  buildProofreadSystemPrompt,
  encodeChunk,
  parseChunkResponse,
  tokensForChunk
} from "./proofread-protocol";

function blocksOf(markdown: string): ProseBlock[] {
  return segmentMarkdown(markdown).blocks;
}

describe("buildProofreadSystemPrompt", () => {
  it("keeps the user's prompt first", () => {
    expect(buildProofreadSystemPrompt("Mein Prompt.")).toMatch(/^Mein Prompt\./);
  });

  it("always appends the protocol rules", () => {
    expect(buildProofreadSystemPrompt("Mein Prompt.")).toContain("§P0§");
  });

  it("falls back to the default prompt when the user's is blank", () => {
    expect(buildProofreadSystemPrompt("   ")).toContain("Korrektor");
  });

  it("includes glossary substitutions", () => {
    const prompt = buildProofreadSystemPrompt("P.", [
      { avoid: "Immobilie", use: "Objekt", note: "Hausbegriff" }
    ]);
    expect(prompt).toContain('"Immobilie" → "Objekt"');
    expect(prompt).toContain("Hausbegriff");
  });

  it("expresses a forbidden term with no replacement", () => {
    const prompt = buildProofreadSystemPrompt("P.", [{ avoid: "Broker", use: null, note: "" }]);
    expect(prompt).toContain('"Broker" vermeiden');
  });

  it("omits the glossary section when there are no constraints", () => {
    expect(buildProofreadSystemPrompt("P.")).not.toContain("Hausglossar");
  });

  it("caps the constraint list so a large glossary cannot crowd out the text", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      avoid: `Term${i}`,
      use: null,
      note: ""
    }));
    const prompt = buildProofreadSystemPrompt("P.", many);
    expect(prompt).toContain("Term39");
    expect(prompt).not.toContain("Term40");
  });
});

describe("encodeChunk and parseChunkResponse", () => {
  it("round-trips an unchanged response", () => {
    const blocks = blocksOf("Erster Absatz.\n\nZweiter Absatz.");
    const rewrites = parseChunkResponse(encodeChunk(blocks), blocks);
    expect(rewrites.get("b0")).toBe("Erster Absatz.");
    expect(rewrites.get("b1")).toBe("Zweiter Absatz.");
  });

  it("keeps multi-line blocks intact", () => {
    const blocks = blocksOf("Zeile eins\nZeile zwei.\n\nAnderer Absatz.");
    const rewrites = parseChunkResponse(encodeChunk(blocks), blocks);
    expect(rewrites.get("b0")).toBe("Zeile eins\nZeile zwei.");
  });

  it("reads a corrected response", () => {
    const blocks = blocksOf("Ein Fhler.");
    const rewrites = parseChunkResponse("<<<b0>>>\nEin Fehler.", blocks);
    expect(rewrites.get("b0")).toBe("Ein Fehler.");
  });

  it("ignores a marker that was never sent", () => {
    const blocks = blocksOf("Ein Satz.");
    const rewrites = parseChunkResponse("<<<b0>>>\nEin Satz.\n\n<<<b9>>>\nErfunden.", blocks);
    expect(rewrites.size).toBe(1);
    expect(rewrites.has("b9")).toBe(false);
  });

  it("omits a block the response never mentioned", () => {
    const blocks = blocksOf("Erster.\n\nZweiter.");
    const rewrites = parseChunkResponse("<<<b1>>>\nZweiter!", blocks);
    expect(rewrites.has("b0")).toBe(false);
    expect(rewrites.get("b1")).toBe("Zweiter!");
  });

  it("keeps the first of a duplicated marker", () => {
    const blocks = blocksOf("Ein Satz.");
    const rewrites = parseChunkResponse("<<<b0>>>\nErste.\n\n<<<b0>>>\nZweite.", blocks);
    expect(rewrites.get("b0")).toBe("Erste.");
  });

  it("tolerates a response returning blocks out of order", () => {
    const blocks = blocksOf("Erster.\n\nZweiter.");
    const rewrites = parseChunkResponse("<<<b1>>>\nB.\n\n<<<b0>>>\nA.", blocks);
    expect(rewrites.get("b0")).toBe("A.");
    expect(rewrites.get("b1")).toBe("B.");
  });

  it("returns nothing when the response has no markers", () => {
    expect(parseChunkResponse("Hier ist Ihre Korrektur!", blocksOf("Ein Satz."))).toEqual(
      new Map()
    );
  });

  it("drops a preamble before the first marker", () => {
    const blocks = blocksOf("Ein Fhler.");
    const rewrites = parseChunkResponse("Gerne!\n\n<<<b0>>>\nEin Fehler.", blocks);
    expect(rewrites.get("b0")).toBe("Ein Fehler.");
  });

  it("preserves placeholders through a round trip", () => {
    const { blocks } = segmentMarkdown("Siehe `x_y` hier.");
    const rewrites = parseChunkResponse(encodeChunk(blocks), blocks);
    expect(rewrites.get("b0")).toBe(blocks[0].masked);
  });

  it("keeps a heading marker that leads a block", () => {
    const blocks = blocksOf("# Titel");
    const rewrites = parseChunkResponse(encodeChunk(blocks), blocks);
    expect(rewrites.get("b0")).toBe("# Titel");
  });
});

describe("tokensForChunk", () => {
  it("scales with chunk size", () => {
    const small = tokensForChunk(blocksOf("Kurz."), 4096);
    const large = tokensForChunk(blocksOf("Wort ".repeat(500)), 4096);
    expect(large).toBeGreaterThan(small);
  });

  it("never exceeds the configured cap", () => {
    expect(tokensForChunk(blocksOf("Wort ".repeat(5000)), 1024)).toBe(1024);
  });

  it("keeps a floor for tiny chunks", () => {
    expect(tokensForChunk(blocksOf("Hi."), 4096)).toBe(256);
  });
});
