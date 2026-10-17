import type { MarkdownView } from "obsidian";

/**
 * Where the overlay goes: over the editor in Live Preview, and nowhere else.
 *
 * The stack is for finding one's way while writing in a long note. Reading
 * view has the outline and the note index for that, and source mode shows
 * the markup it would only repeat. A note keeps its editor in reading view,
 * hidden, so the class is what says which one the reader sees.
 */
export function findOverlayHost(view: MarkdownView): HTMLElement | null {
  if (view.getMode() !== "source") return null;
  const contentEl = view.contentEl as
    | (HTMLElement & {
        querySelector?: (selector: string) => Element | null;
      })
    | null;
  if (!contentEl || typeof contentEl.querySelector !== "function") return null;
  return contentEl.querySelector(
    ".markdown-source-view.mod-cm6.is-live-preview"
  ) as HTMLElement | null;
}

/**
 * Whether an editor that reported its scroll is the note's own. Every editor
 * runs the extension, those nested in the note included — a Live Preview
 * table cell is one — and their lines count from their own small document.
 */
export function isNoteEditor(view: MarkdownView, editorDom: HTMLElement): boolean {
  return view.contentEl.contains(editorDom) && !editorDom.parentElement?.closest(".cm-editor");
}
