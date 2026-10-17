import { describe, expect, it } from "vitest";
import type { MarkdownView } from "obsidian";
import { findOverlayHost } from "./overlay-host";

const livePreviewHost = { id: "live-preview" } as unknown as HTMLElement;

function viewIn(mode: "source" | "preview", livePreview: boolean): MarkdownView {
  return {
    getMode: () => mode,
    contentEl: {
      querySelector: (selector: string) =>
        livePreview && selector === ".markdown-source-view.mod-cm6.is-live-preview"
          ? livePreviewHost
          : null
    }
  } as unknown as MarkdownView;
}

describe("findOverlayHost", () => {
  it("draws over the editor in Live Preview", () => {
    expect(findOverlayHost(viewIn("source", true))).toBe(livePreviewHost);
  });

  it("draws nothing in source mode", () => {
    expect(findOverlayHost(viewIn("source", false))).toBeNull();
  });

  it("draws nothing in reading view, not even into the editor hidden behind it", () => {
    expect(findOverlayHost(viewIn("preview", true))).toBeNull();
  });

  it("returns null when the view has no content element", () => {
    const view = { getMode: () => "source", contentEl: null } as unknown as MarkdownView;
    expect(findOverlayHost(view)).toBeNull();
  });
});
