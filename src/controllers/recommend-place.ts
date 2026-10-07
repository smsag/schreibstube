import { type App, MarkdownView, TFile } from "obsidian";
import {
  sectionKey,
  type FocusFallback,
  type FocusPoint
} from "../services/semantic/passage-focus";
import type { RecommendPlace } from "../ui/recommended-panel";

/** A place in a note's text as it is now, for the ranking to start from. */
export interface PassageFocus {
  markdown: string;
  at: FocusPoint;
  fallback: FocusFallback;
}

/**
 * Where in a note Recommended ranks from, read off the workspace (wiring
 * only: which passages that means is `passage-focus`'s to say).
 *
 * The sidebar follows the cursor of the note being edited in front of the
 * person; in Reading view, or for a note that is not in front, there is no
 * place to follow and the note ranks from its opening, as it always did. The
 * footer ranks from the end, where it is read. The text is the editor's, so
 * the passages are found in what is on screen rather than in the saved file.
 */
export class RecommendPlaces {
  constructor(private readonly app: App) {}

  /** What a list kept per place keys its answer under: the section, the end, or the note. */
  key(path: string, place: RecommendPlace): string {
    if (place === "end") return "end";
    const at = this.cursor(path);
    return at ? `section:${sectionKey(at.markdown, at.line)}` : "opening";
  }

  /** The place to rank from, or nothing for the note's opening. */
  async focus(path: string, place: RecommendPlace | undefined): Promise<PassageFocus | undefined> {
    if (place === undefined) return undefined;
    if (place === "cursor") {
      const at = this.cursor(path);
      return at ? { markdown: at.markdown, at: at.line, fallback: "opening" } : undefined;
    }
    // A note that cannot be read ranks from its last stored passages by position.
    const markdown = this.showing(path)?.getViewData() ?? (await this.read(path)) ?? "";
    return { markdown, at: "end", fallback: "end" };
  }

  /**
   * The note's text and cursor line, when it is being edited in front of the
   * person. The last note pane counts as in front while the sidebar has the
   * focus: pressing in the panel itself must not move the place it ranks from.
   */
  private cursor(path: string): { markdown: string; line: number } | null {
    const { workspace } = this.app;
    const candidates = [
      workspace.getActiveViewOfType(MarkdownView),
      workspace.getMostRecentLeaf()?.view
    ];
    for (const view of candidates) {
      if (!(view instanceof MarkdownView) || view.file?.path !== path) continue;
      if (view.getMode() !== "source") return null;
      return { markdown: view.editor.getValue(), line: view.editor.getCursor().line };
    }
    return null;
  }

  /** A view showing the note, the one in front first. */
  private showing(path: string): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file?.path === path) return active;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) return view;
    }
    return null;
  }

  private async read(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    try {
      return await this.app.vault.cachedRead(file);
    } catch {
      return null;
    }
  }
}
