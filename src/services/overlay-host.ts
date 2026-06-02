import type { MarkdownView } from "obsidian";

export function findOverlayHost(view: MarkdownView): HTMLElement | null {
  const contentEl = view.contentEl as (HTMLElement & {
    querySelector?: (selector: string) => Element | null;
  }) | null;

  if (!contentEl) {
    return null;
  }

  const sourceChromeHost =
    typeof contentEl.querySelector === "function"
      ? (contentEl.querySelector(
          ".markdown-source-view.mod-cm6"
        ) as HTMLElement | null)
      : null;
  if (sourceChromeHost) {
    return sourceChromeHost;
  }

  return contentEl;
}
