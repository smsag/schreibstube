import { describe, expect, it } from "vitest";
import type { MarkdownView } from "obsidian";
import { findOverlayHost } from "./overlay-host";

const sourceHost = { id: "source-host" } as unknown as HTMLElement;
const readingHost = { id: "reading-host" } as unknown as HTMLElement;

function viewIn(mode: "source" | "preview"): MarkdownView {
  return {
    getMode: () => mode,
    contentEl: {
      querySelector: (selector: string) =>
        selector === ".markdown-source-view.mod-cm6"
          ? sourceHost
          : selector === ".markdown-reading-view"
            ? readingHost
            : null
    }
  } as unknown as MarkdownView;
}

describe("findOverlayHost", () => {
  it("draws over the editor while the note is edited", () => {
    expect(findOverlayHost(viewIn("source"))).toBe(sourceHost);
  });

  it("draws over the page in reading view, not into the hidden editor", () => {
    expect(findOverlayHost(viewIn("preview"))).toBe(readingHost);
  });

  it("falls back to the view content element", () => {
    const contentEl = {
      id: "content",
      querySelector: () => null
    } as unknown as HTMLElement;
    const view = {
      getMode: () => "source",
      contentEl
    } as unknown as MarkdownView;

    expect(findOverlayHost(view)).toBe(contentEl);
  });

  it("returns null when no supported host exists", () => {
    const view = {
      getMode: () => "source",
      contentEl: null
    } as unknown as MarkdownView;

    expect(findOverlayHost(view)).toBeNull();
  });
});
