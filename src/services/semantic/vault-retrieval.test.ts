import { describe, it, expect } from "vitest";
import { isIndexingOptedOut, vaultNoteChunks, MAX_CHUNKS_PER_NOTE } from "./vault-retrieval";

// ── isIndexingOptedOut (Pythia ADR-183) ─────────────────────────────────────────────
describe("isIndexingOptedOut", () => {
  it("opts out on an explicit false", () => {
    expect(isIndexingOptedOut({ pythia: false })).toBe(true);
    expect(isIndexingOptedOut({ pythia: "false" })).toBe(true);
  });

  it("indexes everything else, including a missing or malformed key", () => {
    // A frontmatter typo must never silently drop a note out of retrieval:
    // the user would see no pills and have nothing to explain it.
    for (const fm of [
      undefined,
      null,
      {},
      { pythia: true },
      { pythia: "no" },
      { pythia: 0 },
      "not an object"
    ]) {
      expect(isIndexingOptedOut(fm)).toBe(false);
    }
  });

  it("ignores other frontmatter keys", () => {
    expect(isIndexingOptedOut({ tags: ["a"], aliases: [], pythia: false })).toBe(true);
    expect(isIndexingOptedOut({ tags: ["a"] })).toBe(false);
  });
});

// ── vaultNoteChunks ─────────────────────────────────────────────────────────

describe("vaultNoteChunks", () => {
  it("embeds the prose, not the frontmatter, code or links around it", () => {
    const note =
      "---\ncreated: 2024-03-01\n---\n# Brief\nSiehe [[Akte|die Akte]] und https://x.de\n```\ncode\n```";
    expect(vaultNoteChunks(note, 500)).toEqual(["# Brief\nSiehe die Akte und"]);
  });

  it("merges short sections into one passage", () => {
    const note = "# A\neins\n# B\nzwei\n# C\ndrei";
    expect(vaultNoteChunks(note, 500)).toEqual(["# A\neins\n\n# B\nzwei\n\n# C\ndrei"]);
  });

  it("keeps sections apart when together they would not fit", () => {
    const long = "wort ".repeat(30).trim();
    const chunks = vaultNoteChunks(`# A\n${long}\n# B\n${long}`, 200);
    expect(chunks).toHaveLength(2);
  });

  it("cuts a long section at spaces, each passage repeating the end of the last", () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    const chunks = vaultNoteChunks(words, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
      // Whole words only: every piece is a word the text holds.
      for (const piece of chunk.split(" ")) expect(words.split(" ")).toContain(piece);
    }
    const lastOfFirst = chunks[0]!.split(" ").pop()!;
    expect(chunks[1]!.split(" ")).toContain(lastOfFirst);
    // Nothing is lost between two passages.
    expect(chunks.at(-1)!.endsWith("w199")).toBe(true);
  });

  it("still cuts a run with no spaces in it", () => {
    const chunks = vaultNoteChunks("a".repeat(70) + " " + "b".repeat(70), 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60);
  });

  it("stops at the most passages one note may have", () => {
    const huge = Array.from({ length: 20_000 }, (_, i) => `w${i}`).join(" ");
    expect(vaultNoteChunks(huge, 100)).toHaveLength(MAX_CHUNKS_PER_NOTE);
  });

  it("is deterministic and empty for an empty note", () => {
    const note = "# X\n" + "satz ".repeat(300);
    expect(vaultNoteChunks(note, 120)).toEqual(vaultNoteChunks(note, 120));
    expect(vaultNoteChunks("---\na: 1\n---\n", 120)).toEqual([]);
  });
});
