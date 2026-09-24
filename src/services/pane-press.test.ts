import { describe, expect, it } from "vitest";
import { PANE_PRESS_WINDOW_MS, scrollsToOpenedNote } from "./pane-press";

describe("scrollsToOpenedNote", () => {
  const now = 10_000;

  it("scrolls when nothing in the pane was pressed", () => {
    expect(scrollsToOpenedNote("a.md", null, now)).toBe(true);
  });

  it("leaves the scroll alone for the note that was pressed in the pane", () => {
    expect(scrollsToOpenedNote("a.md", { path: "a.md", at: now - 50 }, now)).toBe(false);
  });

  it("leaves the scroll alone for a press that could not name its note", () => {
    expect(scrollsToOpenedNote("a.md", { path: null, at: now - 50 }, now)).toBe(false);
  });

  it("scrolls for a note other than the one pressed", () => {
    expect(scrollsToOpenedNote("b.md", { path: "a.md", at: now - 50 }, now)).toBe(true);
  });

  it("forgets a press that has waited too long for its file-open", () => {
    const stale = { path: "a.md", at: now - PANE_PRESS_WINDOW_MS - 1 };
    expect(scrollsToOpenedNote("a.md", stale, now)).toBe(true);
    const fresh = { path: "a.md", at: now - PANE_PRESS_WINDOW_MS };
    expect(scrollsToOpenedNote("a.md", fresh, now)).toBe(false);
  });
});
