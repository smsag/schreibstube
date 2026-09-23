import { describe, expect, it } from "vitest";
import { followsNoteInWindow } from "./follow-window";

describe("followsNoteInWindow", () => {
  const main = { name: "main" };
  const popout = { name: "popout" };

  it("follows a note in the pane's own window", () => {
    expect(followsNoteInWindow(main, main)).toBe(true);
  });

  it("leaves a note in another window alone", () => {
    expect(followsNoteInWindow(popout, main)).toBe(false);
  });

  it("follows when the note's window is unknown, as it always did", () => {
    expect(followsNoteInWindow(null, main)).toBe(true);
  });
});
