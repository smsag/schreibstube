import { describe, expect, it, vi } from "vitest";
import { compileGlossaries } from "./glossary-matcher";
import { parseGlossary } from "./glossary-parser";
import { segmentMarkdown, type ProseBlock } from "./markdown-segments";
import {
  chunkBlocks,
  createCancelToken,
  isFlagOnly,
  runProofread,
  scanGlossary
} from "./proofread-runner";
import { applyPlan, planApply, refreshStaleness, resolveAnchor } from "./suggestion";

const GLOSSARY = parseGlossary(
  "G.md",
  [
    "---",
    "schreibstubeGlossary: true",
    "schreibstubeLanguage: de",
    "---",
    "| Concept | Term | Status | Match | Note |",
    "|---|---|---|---|---|",
    "| objekt | Objekt | preferred | word | |",
    "| objekt | Immobilie | deprecated | word | Hausbegriff |",
    "| makler | Broker | deprecated | word | |"
  ].join("\n")
).glossary;

const MATCHER = compileGlossaries([GLOSSARY]);

describe("scanGlossary", () => {
  it("finds terms across the whole note in document order", () => {
    const text = "# Titel\n\nDer Broker kommt.\n\nDie Immobilie ist frei.";
    const suggestions = scanGlossary(text, MATCHER);
    expect(suggestions.map((s) => s.original)).toEqual(["Broker", "Immobilie"]);
  });

  it("reports offsets valid against the whole document", () => {
    const text = "# Titel\n\nDer Broker kommt.\n\nDie Immobilie ist frei.";
    for (const suggestion of scanGlossary(text, MATCHER)) {
      expect(text.slice(suggestion.from, suggestion.to)).toBe(suggestion.original);
    }
  });

  it("applying the scan rewrites the document", () => {
    const text = "Die Immobilie ist frei.";
    const suggestions = scanGlossary(text, MATCHER);
    expect(applyPlan(text, planApply(text, suggestions))).toBe("Die Objekt ist frei.");
  });

  it("ignores code blocks and frontmatter", () => {
    const text = "---\ntag: Immobilie\n---\n\n```\nconst Immobilie = 1;\n```\n\nDie Immobilie.";
    expect(scanGlossary(text, MATCHER)).toHaveLength(1);
  });

  it("marks an inflected match as needing review", () => {
    const [suggestion] = scanGlossary("Alle Immobilien sind frei.", MATCHER);
    expect(suggestion?.needsReview).toBe(true);
  });

  it("marks a flag-only hit as having nothing to apply", () => {
    const [suggestion] = scanGlossary("Der Broker kommt.", MATCHER);
    expect(suggestion && isFlagOnly(suggestion)).toBe(true);
  });

  it("carries the glossary note onto the card", () => {
    const [suggestion] = scanGlossary("Die Immobilie.", MATCHER);
    expect(suggestion?.note).toBe("Hausbegriff");
  });

  it("returns nothing for an empty matcher", () => {
    expect(scanGlossary("Die Immobilie.", compileGlossaries([]))).toEqual([]);
  });
});

describe("chunkBlocks", () => {
  const blocks = segmentMarkdown("Eins.\n\nZwei.\n\nDrei.").blocks;

  it("packs blocks up to the budget", () => {
    expect(chunkBlocks(blocks, 12).map((c) => c.length)).toEqual([2, 1]);
  });

  it("keeps everything in one chunk under a large budget", () => {
    expect(chunkBlocks(blocks, 1000)).toHaveLength(1);
  });

  it("gives an oversized block its own chunk rather than splitting it", () => {
    const big = segmentMarkdown(`${"Wort ".repeat(100)}\n\nKurz.`).blocks;
    const chunks = chunkBlocks(big, 50);
    expect(chunks[0]).toHaveLength(1);
    expect(chunks).toHaveLength(2);
  });

  it("returns nothing for no blocks", () => {
    expect(chunkBlocks([], 100)).toEqual([]);
  });
});

function echoSender(rewrite: (block: ProseBlock) => string) {
  return async (blocks: ProseBlock[]) => new Map(blocks.map((block) => [block.id, rewrite(block)]));
}

describe("runProofread", () => {
  const options = { chunkChars: 1000, concurrency: 2 };

  it("produces suggestions from a rewrite", async () => {
    const text = "Das ist ein Fhler im Satz.";
    const result = await runProofread(
      text,
      echoSender((b) => b.masked.replace("Fhler", "Fehler")),
      options,
      createCancelToken()
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.original).toBe("Fhler");
    expect(result.suggestions[0]?.replacement).toBe("Fehler");
  });

  it("leaves an insertion at a block's start placeable in the document it came from", async () => {
    // The anchor a card keeps is read in the document's coordinates. Taken in
    // the block's, an edit at offset zero of a block recorded nothing at all,
    // and the card was unplaceable — stale before anyone saw it — against the
    // very text it had just been produced from.
    const text = "# Titel\n\nHaus ist schön.\n";
    const result = await runProofread(
      text,
      echoSender((b) => b.masked.replace(/^Haus/, "Das Haus")),
      options,
      createCancelToken()
    );

    const insertion = result.suggestions.find((entry) => entry.original === "");
    expect(insertion).toBeDefined();
    expect(resolveAnchor(text, insertion!)).not.toBeNull();
    expect(refreshStaleness(text, result.suggestions).every((s) => s.status === "pending")).toBe(
      true
    );
  });

  it("reports offsets valid against the whole document", async () => {
    const text = "# Titel\n\nErster Absatz mit Fhler.\n\nZweiter Absatz mit Fhler.";
    const result = await runProofread(
      text,
      echoSender((b) => b.masked.replace("Fhler", "Fehler")),
      options,
      createCancelToken()
    );
    expect(result.suggestions).toHaveLength(2);
    for (const suggestion of result.suggestions) {
      expect(text.slice(suggestion.from, suggestion.to)).toBe(suggestion.original);
    }
  });

  it("applying every suggestion yields the corrected document", async () => {
    const text = "Erster Fhler.\n\nZweiter Fhler.";
    const result = await runProofread(
      text,
      echoSender((b) => b.masked.replace("Fhler", "Fehler")),
      options,
      createCancelToken()
    );
    const plan = planApply(text, result.suggestions);
    expect(applyPlan(text, plan)).toBe("Erster Fehler.\n\nZweiter Fehler.");
  });

  it("restores masked spans so protected text is never rewritten", async () => {
    const text = "Siehe `code_hier` und Fhler.";
    const result = await runProofread(
      text,
      echoSender((b) => b.masked.replace("Fhler", "Fehler")),
      options,
      createCancelToken()
    );
    const plan = planApply(text, result.suggestions);
    expect(applyPlan(text, plan)).toBe("Siehe `code_hier` und Fehler.");
  });

  it("rejects a block whose rewrite dropped a protected span", async () => {
    const text = "Siehe `code_hier` und Fhler.";
    const result = await runProofread(
      text,
      echoSender(() => "Siehe und Fehler."),
      options,
      createCancelToken()
    );
    expect(result.suggestions).toEqual([]);
    expect(result.rejectedBlocks).toBe(1);
  });

  it("returns nothing when the rewrite is identical", async () => {
    const result = await runProofread(
      "Alles korrekt.",
      echoSender((b) => b.masked),
      options,
      createCancelToken()
    );
    expect(result.suggestions).toEqual([]);
  });

  it("keeps successful chunks when one request fails", async () => {
    const text = "Erster Fhler.\n\nZweiter Fhler.";
    let call = 0;
    const result = await runProofread(
      text,
      async (blocks) => {
        call += 1;
        if (call === 1) throw new Error("boom");
        return new Map(blocks.map((b) => [b.id, b.masked.replace("Fhler", "Fehler")]));
      },
      { chunkChars: 15, concurrency: 1 },
      createCancelToken()
    );
    expect(result.failedChunks).toBe(1);
    expect(result.suggestions).toHaveLength(1);
  });

  it("stops sending chunks once cancelled", async () => {
    const text = Array.from({ length: 10 }, (_, i) => `Absatz ${i} Fhler.`).join("\n\n");
    const token = createCancelToken();
    const send = vi.fn(async (blocks: ProseBlock[]) => {
      token.cancelled = true;
      return new Map(blocks.map((b) => [b.id, b.masked]));
    });
    const result = await runProofread(text, send, { chunkChars: 10, concurrency: 1 }, token);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
  });

  it("reports progress per chunk", async () => {
    const text = "Erster Fhler.\n\nZweiter Fhler.\n\nDritter Fhler.";
    const progress: number[] = [];
    await runProofread(
      text,
      echoSender((b) => b.masked.replace("Fhler", "Fehler")),
      { chunkChars: 15, concurrency: 1 },
      createCancelToken(),
      (p) => progress.push(p.completedChunks)
    );
    expect(progress).toEqual([1, 2, 3]);
  });

  it("ignores a block the response omitted", async () => {
    const result = await runProofread(
      "Erster Fhler.\n\nZweiter Fhler.",
      async () => new Map(),
      options,
      createCancelToken()
    );
    expect(result.suggestions).toEqual([]);
    expect(result.rejectedBlocks).toBe(0);
  });

  it("classifies a capitalization-only change", async () => {
    const result = await runProofread(
      "das objekt ist frei.",
      echoSender((b) => b.masked.replace("objekt", "Objekt")),
      options,
      createCancelToken()
    );
    expect(result.suggestions[0]?.category).toBe("capitalization");
  });

  it("classifies a typo fix as spelling", async () => {
    const result = await runProofread(
      "Das ist unvollstandig hier.",
      echoSender((b) => b.masked.replace("unvollstandig", "unvollständig")),
      options,
      createCancelToken()
    );
    expect(result.suggestions[0]?.category).toBe("spelling");
  });
});
