import { describe, expect, it } from "vitest";
import { typewriterFollows, typewriterScrollDelta } from "./typewriter";

describe("typewriterFollows", () => {
  it("follows typing and the keys", () => {
    expect(typewriterFollows({ docChanged: true, cursorMoved: true, pointer: false })).toBe(true);
    expect(typewriterFollows({ docChanged: false, cursorMoved: true, pointer: false })).toBe(true);
  });

  it("leaves a click or a drag where it was pressed", () => {
    expect(typewriterFollows({ docChanged: false, cursorMoved: true, pointer: true })).toBe(false);
  });

  it("does nothing for an update that moved neither text nor cursor", () => {
    // What a click sends after the pointer's own update: the same cursor again.
    expect(typewriterFollows({ docChanged: false, cursorMoved: false, pointer: false })).toBe(
      false
    );
  });
});

describe("typewriterScrollDelta", () => {
  const scroller = { top: 100, bottom: 900 };

  it("scrolls a line below the middle up, and one above it down", () => {
    expect(typewriterScrollDelta({ top: 790, bottom: 810 }, scroller)).toBe(300);
    expect(typewriterScrollDelta({ top: 190, bottom: 210 }, scroller)).toBe(-300);
  });

  it("leaves a line in the middle, rounding included", () => {
    expect(typewriterScrollDelta({ top: 490, bottom: 510 }, scroller)).toBe(0);
    expect(typewriterScrollDelta({ top: 490.2, bottom: 510.2 }, scroller)).toBe(0);
  });

  it("does nothing for a size it cannot read", () => {
    expect(typewriterScrollDelta({ top: Number.NaN, bottom: 10 }, scroller)).toBe(0);
    expect(typewriterScrollDelta({ top: 0, bottom: 10 }, { top: 50, bottom: 50 })).toBe(0);
  });
});
