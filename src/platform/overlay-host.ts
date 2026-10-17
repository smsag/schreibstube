import type { MarkdownView } from "obsidian";

/**
 * Where the overlay goes: over the editor, or over the page in reading view.
 *
 * A note keeps both in its view and hides the one not in use, so the
 * overlay drawn into the editor in reading view was drawn, and never seen.
 */
export function findOverlayHost(view: MarkdownView): HTMLElement | null {
  const contentEl = view.contentEl as
    | (HTMLElement & {
        querySelector?: (selector: string) => Element | null;
      })
    | null;

  if (!contentEl) {
    return null;
  }

  const selector =
    view.getMode() === "preview" ? ".markdown-reading-view" : ".markdown-source-view.mod-cm6";
  const modeHost =
    typeof contentEl.querySelector === "function"
      ? (contentEl.querySelector(selector) as HTMLElement | null)
      : null;
  if (modeHost) {
    return modeHost;
  }

  return contentEl;
}
