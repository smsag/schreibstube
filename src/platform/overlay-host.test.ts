import { describe, expect, it } from "vitest";
import type { MarkdownView } from "obsidian";
import { findOverlayHost } from "./overlay-host";

describe("findOverlayHost", () => {
  it("prefers the Live Edit source chrome host", () => {
    const sourceHost = { id: "source-host" } as unknown as HTMLElement;
    const contentEl = { id: "content" } as unknown as HTMLElement;
    const view = {
      contentEl: {
        ...contentEl,
        querySelector: (selector: string) =>
          selector === ".markdown-source-view.mod-cm6" ? sourceHost : null
      }
    } as unknown as MarkdownView;

    expect(findOverlayHost(view)).toBe(sourceHost);
  });

  it("falls back to the view content element", () => {
    const contentEl = {
      id: "content",
      querySelector: () => null
    } as unknown as HTMLElement;
    const view = {
      contentEl
    } as unknown as MarkdownView;

    expect(findOverlayHost(view)).toBe(contentEl);
  });

  it("returns null when no supported host exists", () => {
    const view = {
      contentEl: null
    } as unknown as MarkdownView;

    expect(findOverlayHost(view)).toBeNull();
  });
});
