// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { MarkdownView } from "obsidian";
import { findOverlayHost, isNoteEditor } from "./overlay-host";

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

describe("isNoteEditor", () => {
  function note() {
    const contentEl = document.createElement("div");
    const source = contentEl.appendChild(document.createElement("div"));
    source.className = "markdown-source-view mod-cm6 is-live-preview";
    const editor = source.appendChild(document.createElement("div"));
    editor.className = "cm-editor";
    const cell = editor
      .appendChild(document.createElement("td"))
      .appendChild(document.createElement("div"));
    cell.className = "cm-editor";
    return { view: { contentEl } as unknown as MarkdownView, editor, cell };
  }

  it("takes the note's own editor", () => {
    const { view, editor } = note();
    expect(isNoteEditor(view, editor)).toBe(true);
  });

  it("leaves out an editor nested in the note, such as a table cell's", () => {
    const { view, cell } = note();
    expect(isNoteEditor(view, cell)).toBe(false);
  });

  it("leaves out another note's editor", () => {
    const { view } = note();
    expect(isNoteEditor(view, note().editor)).toBe(false);
  });
});
