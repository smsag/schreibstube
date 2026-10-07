import { describe, expect, it } from "vitest";
import { applyEdit, revertEdit, smallestEdit } from "./text-revert";

describe("smallestEdit", () => {
  it("replaces only what differs", () => {
    expect(smallestEdit("abcdef", "abXYef")).toEqual({ from: 2, to: 4, text: "XY" });
    expect(smallestEdit("same", "same")).toEqual({ from: 4, to: 4, text: "" });
    expect(smallestEdit("aaa", "aa")).toEqual({ from: 2, to: 3, text: "" });
  });

  it("never splits a character outside the BMP", () => {
    const edit = smallestEdit("a😀b", "a😃b");
    expect(edit).toEqual({ from: 1, to: 3, text: "😃" });
    const tail = smallestEdit("😀", "x😀");
    expect(applyEdit("😀", tail)).toBe("x😀");
  });
});

describe("revertEdit", () => {
  const before = ["# Plan", "- [x] a", "- [ ] b", "", "Text"].join("\n");
  const after = ["# Plan", "- [ ] b", "- [x] a", "", "Text"].join("\n");
  const undo = (current: string): string | null => {
    const edit = revertEdit(current, before, after);
    return edit ? applyEdit(current, edit) : null;
  };

  it("restores the text when nothing changed since", () => {
    expect(undo(after)).toBe(before);
  });

  it("keeps typing elsewhere in the note", () => {
    expect(undo(after.replace("Text", "More text"))).toBe(before.replace("Text", "More text"));
    expect(undo(`Intro\n${after}`)).toBe(`Intro\n${before}`);
  });

  it("gives up when the changed lines were edited, or appear twice", () => {
    expect(undo(after.replace("- [ ] b", "- [ ] B"))).toBeNull();
    expect(undo(`${after}\n${after}`)).toBeNull();
  });

  it("holds a change at the edge of the note to that edge", () => {
    const start = revertEdit("x\nb\nc", "a\nb\nc", "z\nb\nc");
    expect(start).toBeNull();
    expect(applyEdit("z\nb\nc\nd", revertEdit("z\nb\nc\nd", "a\nb\nc", "z\nb\nc")!)).toBe(
      "a\nb\nc\nd"
    );
    expect(applyEdit("0\na\nb\nz", revertEdit("0\na\nb\nz", "a\nb\nc", "a\nb\nz")!)).toBe(
      "0\na\nb\nc"
    );
    expect(revertEdit("a\nb\nz\n9", "a\nb\nc", "a\nb\nz")).toBeNull();
  });

  it("puts back lines that were deleted", () => {
    const original = "a\nb\nc\nd";
    const shorter = "a\nd";
    expect(applyEdit("a\nd\ne", revertEdit("a\nd\ne", original, shorter)!)).toBe("a\nb\nc\nd\ne");
  });
});
