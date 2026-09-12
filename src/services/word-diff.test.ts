import { describe, expect, it } from "vitest";
import { diffToEdits, diffWords, tokenize } from "./word-diff";

describe("tokenize", () => {
  it("keeps whitespace runs so the text reconstructs exactly", () => {
    const text = "Ein  Satz\nmit Umlauten: schön.";
    expect(tokenize(text).join("")).toBe(text);
  });
});

describe("diffWords", () => {
  it("returns a single equal segment for identical text", () => {
    expect(diffWords("same text", "same text")).toEqual([{ op: "equal", text: "same text" }]);
  });

  it("marks a substituted word", () => {
    const segments = diffWords("der rote Wagen", "der blaue Wagen");
    expect(segments.filter((s) => s.op === "delete").map((s) => s.text)).toEqual(["rote"]);
    expect(segments.filter((s) => s.op === "insert").map((s) => s.text)).toEqual(["blaue"]);
  });

  it("reconstructs the original from equal and delete segments", () => {
    const before = "Das ist ein alter Satz.";
    const after = "Das ist ein neuer, besserer Satz.";
    const rebuilt = diffWords(before, after)
      .filter((s) => s.op !== "insert")
      .map((s) => s.text)
      .join("");
    expect(rebuilt).toBe(before);
  });

  it("reconstructs the rewrite from equal and insert segments", () => {
    const before = "Das ist ein alter Satz.";
    const after = "Das ist ein neuer, besserer Satz.";
    const rebuilt = diffWords(before, after)
      .filter((s) => s.op !== "delete")
      .map((s) => s.text)
      .join("");
    expect(rebuilt).toBe(after);
  });

  it("falls back to a whole replacement on very large inputs", () => {
    const before = Array.from({ length: 700 }, (_, i) => `w${i}`).join(" ");
    const after = `${before} extra`;
    expect(diffWords(before, after).map((s) => s.op)).toEqual(["delete", "insert"]);
  });
});

describe("diffToEdits", () => {
  it("returns no edits for identical text", () => {
    expect(diffToEdits("unchanged", "unchanged")).toEqual([]);
  });

  it("locates a substitution by offset", () => {
    const before = "der rote Wagen";
    const [edit] = diffToEdits(before, "der blaue Wagen");
    expect(before.slice(edit.from, edit.to)).toBe(edit.before);
    expect(edit.before).toBe("rote");
    expect(edit.after).toBe("blaue");
  });

  it("splits independent changes into separate edits", () => {
    const edits = diffToEdits(
      "ein Fhler und noch ein Fehlr hier",
      "ein Fehler und noch ein Fehler hier"
    );
    expect(edits).toHaveLength(2);
    expect(edits[0].after).toBe("Fehler");
    expect(edits[1].after).toBe("Fehler");
  });

  it("keeps every edit offset valid against the original", () => {
    const before = "Wir haben gestern das Meeting gemacht und danach Notizen geschrieben.";
    const after = "Wir haben gestern das Meeting abgehalten und danach Notizen verfasst.";
    for (const edit of diffToEdits(before, after)) {
      expect(before.slice(edit.from, edit.to)).toBe(edit.before);
    }
  });

  it("applying every edit reproduces the rewrite", () => {
    const before = "Das Exposee ist unvollstandig und der Makler muss es prufen.";
    const after = "Das Exposé ist unvollständig und der Makler muss es prüfen.";
    let result = before;
    for (const edit of [...diffToEdits(before, after)].reverse()) {
      result = result.slice(0, edit.from) + edit.after + result.slice(edit.to);
    }
    expect(result).toBe(after);
  });

  it("records a pure insertion as an empty range", () => {
    const [edit] = diffToEdits("zwei Worte", "zwei ganze Worte");
    expect(edit.before.trim()).toBe("");
    expect(edit.after).toContain("ganze");
  });

  it("records a pure deletion with an empty replacement", () => {
    const edits = diffToEdits("ein sehr guter Satz", "ein guter Satz");
    expect(edits).toHaveLength(1);
    expect(edits[0].after.trim()).toBe("");
  });

  it("ignores a whitespace-only rewrite", () => {
    expect(diffToEdits("zwei  Leerzeichen", "zwei Leerzeichen")).toEqual([]);
  });
});
