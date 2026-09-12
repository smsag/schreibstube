import { describe, expect, it } from "vitest";
import { applyHunks, diffHunks, splitLines } from "./line-diff";

describe("splitLines", () => {
  it("keeps terminators so the text reconstructs", () => {
    const text = "eins\nzwei\ndrei";
    expect(splitLines(text).join("")).toBe(text);
  });

  it("keeps a trailing newline", () => {
    expect(splitLines("eins\n")).toEqual(["eins\n"]);
  });

  it("keeps blank lines", () => {
    expect(splitLines("a\n\nb")).toEqual(["a\n", "\n", "b"]);
  });

  it("returns nothing for empty text", () => {
    expect(splitLines("")).toEqual([]);
  });
});

describe("diffHunks", () => {
  it("returns nothing for identical text", () => {
    expect(diffHunks("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("locates a changed line by offset", () => {
    const before = "eins\nzwei\ndrei\n";
    const [hunk] = diffHunks(before, "eins\nZWEI\ndrei\n");
    expect(before.slice(hunk.from, hunk.to)).toBe(hunk.before);
    expect(hunk.before).toBe("zwei\n");
    expect(hunk.after).toBe("ZWEI\n");
  });

  it("groups adjacent changed lines into one hunk", () => {
    const hunks = diffHunks("a\nb\nc\nd\n", "a\nX\nY\nd\n");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].before).toBe("b\nc\n");
    expect(hunks[0].after).toBe("X\nY\n");
  });

  it("splits changes separated by unchanged lines", () => {
    const hunks = diffHunks("a\nb\nc\nd\ne\n", "A\nb\nc\nd\nE\n");
    expect(hunks).toHaveLength(2);
  });

  it("records a pure insertion as an empty range", () => {
    const [hunk] = diffHunks("a\nc\n", "a\nb\nc\n");
    expect(hunk.before).toBe("");
    expect(hunk.from).toBe(hunk.to);
    expect(hunk.after).toBe("b\n");
  });

  it("records a pure deletion with an empty replacement", () => {
    const [hunk] = diffHunks("a\nb\nc\n", "a\nc\n");
    expect(hunk.before).toBe("b\n");
    expect(hunk.after).toBe("");
  });

  it("handles an append at the end of the document", () => {
    const [hunk] = diffHunks("a\n", "a\nb\n");
    expect(hunk.after).toBe("b\n");
    expect(hunk.from).toBe(2);
  });

  it("handles a document that was empty", () => {
    const [hunk] = diffHunks("", "neu\n");
    expect(hunk.from).toBe(0);
    expect(hunk.before).toBe("");
    expect(hunk.after).toBe("neu\n");
  });

  it("handles a document emptied at the source", () => {
    const [hunk] = diffHunks("alt\n", "");
    expect(hunk.after).toBe("");
  });

  it("keeps every offset valid against the original", () => {
    const before = "# Titel\n\nAbsatz eins.\n\nAbsatz zwei.\n";
    const after = "# Neuer Titel\n\nAbsatz eins.\n\nAbsatz zwei erweitert.\n\nAbsatz drei.\n";
    for (const hunk of diffHunks(before, after)) {
      expect(before.slice(hunk.from, hunk.to)).toBe(hunk.before);
    }
  });

  it("reproduces the remote document when every hunk is applied", () => {
    const before = "# Titel\n\nAbsatz eins.\n\nAbsatz zwei.\n";
    const after = "# Neuer Titel\n\nAbsatz eins.\n\nAbsatz zwei erweitert.\n\nAbsatz drei.\n";
    expect(applyHunks(before, diffHunks(before, after))).toBe(after);
  });

  it("reproduces a heavily rewritten document", () => {
    const before = Array.from({ length: 60 }, (_, i) => `Zeile ${i}`).join("\n");
    const after = Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0 ? `Neu ${i}` : `Zeile ${i}`
    ).join("\n");
    expect(applyHunks(before, diffHunks(before, after))).toBe(after);
  });

  it("degrades to one hunk on a very large document", () => {
    const before = Array.from({ length: 5000 }, (_, i) => `z${i}`).join("\n");
    const after = `${before}\nextra`;
    const hunks = diffHunks(before, after);
    expect(hunks).toHaveLength(1);
    expect(applyHunks(before, hunks)).toBe(after);
  });
});
