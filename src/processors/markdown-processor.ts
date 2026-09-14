import type { MarkdownPostProcessor, MarkdownView } from "obsidian";

export interface ReadingViewportUpdate {
  viewportTopLine: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

const cleanupByReadingView = new WeakMap<HTMLElement, () => void>();

export function createReadingPostProcessor(
  onViewportUpdate: (update: ReadingViewportUpdate) => void
): MarkdownPostProcessor {
  return (el) => {
    const view = el.closest(".markdown-reading-view") as HTMLElement | null;
    if (!view) {
      return;
    }

    if (cleanupByReadingView.has(view)) {
      return;
    }

    const handler = () => {
      const markdownView = (view as unknown as { view?: MarkdownView }).view;
      const editor = markdownView?.editor;
      if (!editor) {
        return;
      }

      const scrollable = Math.max(1, view.scrollHeight - view.clientHeight);
      const ratio = Math.min(1, Math.max(0, view.scrollTop / scrollable));
      const lineCount = Math.max(1, editor.lineCount());
      const viewportTopLine = Math.floor((lineCount - 1) * ratio);
      onViewportUpdate({
        viewportTopLine,
        scrollTop: view.scrollTop,
        scrollHeight: view.scrollHeight,
        clientHeight: view.clientHeight
      });
    };

    view.addEventListener("scroll", handler, { passive: true });

    // Initial sync
    handler();

    // Detect the reading view leaving the DOM by observing only its parent's
    // direct children — not a document-wide subtree, which would fire this
    // callback on every mutation anywhere in the workspace. A detached view
    // with no live listeners is also eligible for GC via the WeakMap.
    const parent = view.parentElement;
    const observer = parent
      ? new MutationObserver(() => {
          if (!parent.contains(view)) {
            cleanupByReadingView.get(view)?.();
          }
        })
      : null;

    observer?.observe(parent as HTMLElement, { childList: true });

    const cleanup = () => {
      view.removeEventListener("scroll", handler);
      observer?.disconnect();
      cleanupByReadingView.delete(view);
    };

    cleanupByReadingView.set(view, cleanup);
  };
}
