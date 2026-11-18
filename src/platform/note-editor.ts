import type { MarkdownView } from "obsidian";

/**
 * Whether an editor that reported an edit is the note's own. Every editor
 * runs the extensions, those nested in the note included — a Live Preview
 * table cell is one — and their positions count from their own small document.
 */
export function isNoteEditor(view: MarkdownView, editorDom: HTMLElement): boolean {
  return view.contentEl.contains(editorDom) && !editorDom.parentElement?.closest(".cm-editor");
}
