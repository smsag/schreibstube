import type { MarkdownPostProcessor } from "obsidian";
import { editorOfReadingView } from "../services/workspace-internals";

export interface ReadingViewportUpdate {
  viewportTopLine: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

const cleanupByReadingView = new WeakMap<HTMLElement, () => void>();

export interface ReadingPostProcessor {
  processor: MarkdownPostProcessor;
  /** Take every listener off every reading view still on screen. */
  dispose: () => void;
  /**
   * Let go of the views that have left the document.
   *
   * For the plugin to run on the workspace's `layout-change`: a note closed
   * takes its reading view out with the whole leaf, which no observer on the
   * view's own parent ever sees, and its handler and observer would otherwise
   * stay attached until unload.
   */
  sweep: () => void;
}

/**
 * Watch each reading view's scroll position.
 *
 * Obsidian unregisters the post-processor when the plugin unloads, but not
 * the listeners it attached: a view still open kept its scroll handler and
 * observer, and kept reporting to a controller that was gone. `dispose` is
 * for the plugin to register, so the views on screen let go with it.
 */
export function createReadingPostProcessor(
  onViewportUpdate: (update: ReadingViewportUpdate) => void
): ReadingPostProcessor {
  const attached = new Set<HTMLElement>();

  const dispose = (): void => {
    for (const view of [...attached]) cleanupByReadingView.get(view)?.();
  };

  const sweep = (): void => {
    for (const view of [...attached]) {
      if (!view.isConnected) cleanupByReadingView.get(view)?.();
    }
  };

  const processor: MarkdownPostProcessor = (el) => {
    // Every render is a moment the workspace has moved; the views closed
    // since the last one are let go here as well as on the layout event, so
    // nothing depends on which of the two arrives first.
    sweep();

    const view = el.closest(".markdown-reading-view") as HTMLElement | null;
    if (!view) {
      return;
    }

    if (cleanupByReadingView.has(view)) {
      return;
    }

    const handler = () => {
      const editor = editorOfReadingView(view);
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
    handler();

    // The view leaving the DOM is watched on its parent's direct children
    // only — not a document-wide subtree, which would fire on every mutation
    // anywhere in the workspace. That misses an ancestor being removed, which
    // is what `sweep` is for. A detached view with no live listeners is also
    // eligible for GC via the WeakMap.
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
      attached.delete(view);
    };

    cleanupByReadingView.set(view, cleanup);
    attached.add(view);
  };

  return { processor, dispose, sweep };
}
