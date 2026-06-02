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

    const observer = new MutationObserver(() => {
      if (!document.body.contains(view)) {
        const cleanup = cleanupByReadingView.get(view);
        cleanup?.();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const cleanup = () => {
      view.removeEventListener("scroll", handler);
      observer.disconnect();
      cleanupByReadingView.delete(view);
    };

    cleanupByReadingView.set(view, cleanup);
  };
}
