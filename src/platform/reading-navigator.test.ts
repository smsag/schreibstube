import { describe, expect, it, vi } from "vitest";
import type { MarkdownView } from "obsidian";
import { scrollViewToLine, viewTopLine } from "./reading-navigator";

function createView(mode: "source" | "preview", scroll: number | null = 0) {
  const applyScroll = vi.fn();
  const setCursor = vi.fn();
  const view = {
    getMode: () => mode,
    currentMode: { getScroll: () => scroll, applyScroll },
    editor: { setCursor }
  } as unknown as MarkdownView;
  return { view, applyScroll, setCursor };
}

describe("viewTopLine", () => {
  it("reads the line far down a long note, not a position among the headings drawn", () => {
    expect(viewTopLine(createView("preview", 2_481.4).view)).toBe(2_481);
  });

  it("never answers with a line above the first", () => {
    expect(viewTopLine(createView("source", -3).view)).toBe(0);
  });

  it("has no answer while reading view has not laid the note out", () => {
    expect(viewTopLine(createView("preview", null).view)).toBeNull();
    expect(viewTopLine(createView("preview", Number.NaN).view)).toBeNull();
  });
});

describe("scrollViewToLine", () => {
  it("scrolls reading view to the heading's source line", () => {
    const { view, applyScroll, setCursor } = createView("preview");
    scrollViewToLine(view, 1_200);
    expect(applyScroll).toHaveBeenCalledWith(1_200);
    expect(setCursor).not.toHaveBeenCalled();
  });

  it("brings the heading to the top of the editor and leaves the cursor alone", () => {
    const { view, applyScroll, setCursor } = createView("source");
    scrollViewToLine(view, 40);
    expect(applyScroll).toHaveBeenCalledWith(40);
    expect(setCursor).not.toHaveBeenCalled();
  });
});
