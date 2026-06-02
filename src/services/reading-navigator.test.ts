import { describe, expect, it, vi } from "vitest";
import type { MarkdownView } from "obsidian";
import type { HeadingIndex } from "../types";
import {
  resolveViewportLineForReadingView,
  scrollReadingHeadingIntoView
} from "./reading-navigator";

const headingIndex: HeadingIndex = [
  { level: 1, text: "A", lineNumber: 0 },
  { level: 2, text: "A.1", lineNumber: 10 },
  { level: 1, text: "B", lineNumber: 25 }
];

function createPreviewRoot(offsets: number[]): HTMLElement {
  const headings = offsets.map((offset) => {
    const el = {
      offsetTop: offset,
      scrollIntoView: vi.fn()
    };

    return el as unknown as HTMLElement;
  });

  return {
    querySelectorAll: (selector: string) => {
      if (selector === "h1, h2, h3, h4, h5, h6") {
        return headings as unknown as NodeListOf<Element>;
      }

      return [] as unknown as NodeListOf<Element>;
    }
  } as unknown as HTMLElement;
}

function createView(mode: "source" | "preview", previewRoot: HTMLElement | null): MarkdownView {
  return {
    getMode: () => mode,
    containerEl: {
      querySelector: (selector: string) => {
        if (selector === ".markdown-preview-view") {
          return previewRoot;
        }

        return null;
      }
    }
  } as unknown as MarkdownView;
}

describe("resolveViewportLineForReadingView", () => {
  it("returns fallback when not in preview mode", () => {
    const view = createView("source", createPreviewRoot([10, 200, 400]));
    expect(resolveViewportLineForReadingView(view, headingIndex, 7, 300)).toBe(7);
  });

  it("maps scroll top to closest heading line in preview", () => {
    const view = createView("preview", createPreviewRoot([20, 180, 600]));
    expect(resolveViewportLineForReadingView(view, headingIndex, 0, 0)).toBe(0);
    expect(resolveViewportLineForReadingView(view, headingIndex, 0, 200)).toBe(10);
    expect(resolveViewportLineForReadingView(view, headingIndex, 0, 900)).toBe(25);
  });
});

describe("scrollReadingHeadingIntoView", () => {
  it("returns false when not in preview mode", () => {
    const view = createView("source", createPreviewRoot([20, 180, 600]));
    expect(scrollReadingHeadingIntoView(view, headingIndex, 10)).toBe(false);
  });

  it("scrolls the rendered heading matching the source line", () => {
    const previewRoot = createPreviewRoot([20, 180, 600]);
    const view = createView("preview", previewRoot);

    const headings = previewRoot.querySelectorAll("h1, h2, h3, h4, h5, h6") as unknown as Array<{
      scrollIntoView: ReturnType<typeof vi.fn>;
    }>;

    const ok = scrollReadingHeadingIntoView(view, headingIndex, 10);

    expect(ok).toBe(true);
    expect(headings[1].scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
