import { type App, type EventRef, MarkdownView, type TFile, type WorkspaceLeaf } from "obsidian";
import { TYPEWRITER_CLASS } from "../processors/typewriter";

/**
 * Hides the view's own header, and inside the note all that is not the text:
 * the inline title, properties, backlinks, the heading path, the gutter and
 * the scroll bar, in styles.css.
 */
export const DRAFT_BARE_CLASS = "schreibstube-draft-bare";

/**
 * On the body of the note's window: hides the tab bar of a pop-out and the
 * navigation bar of a phone, in styles.css.
 */
export const DRAFT_BARE_WINDOW_CLASS = "schreibstube-draft-bare-window";

export interface DraftFocusOptions {
  /** The cursor's line stays in the middle of the screen (processors/typewriter). */
  typewriter: boolean;
}

/**
 * The new note with nothing on screen but itself, and on request in
 * typewriter mode.
 *
 * A pop-out still has a tab bar and a header above the note, and a phone a
 * header and a navigation bar below it; none of them is needed to start
 * writing, and each is something else to look at. On a phone the toolbar
 * above the keyboard stays: it holds undo and the formatting a writer reaches
 * for.
 *
 * Only this once, as with the footer and the line width: it lasts while the
 * view the note first opens in shows that note and is the window's active
 * one. Showing another note there, going to another tab in the same window,
 * or closing the window gives everything back. Going to another window does
 * not: the note's window is still bare when it is come back to.
 */
export class DraftFocus {
  private readonly stops = new Set<() => void>();

  constructor(private readonly app: App) {}

  follow(leaf: WorkspaceLeaf, file: TFile, options: DraftFocusOptions): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const el = view.containerEl;
    const body = el.ownerDocument.body;

    const viewClasses = options.typewriter
      ? [DRAFT_BARE_CLASS, TYPEWRITER_CLASS]
      : [DRAFT_BARE_CLASS];
    const refs: EventRef[] = [];
    const stop = (): void => {
      for (const ref of refs) this.app.workspace.offref(ref);
      el.classList.remove(...viewClasses);
      body.classList.remove(DRAFT_BARE_WINDOW_CLASS);
      this.stops.delete(stop);
    };
    // A rename keeps the file, so identity is what says the view moved on.
    const check = (): void => {
      if (view.file !== file || !el.isConnected) stop();
    };
    const activeChanged = (active: WorkspaceLeaf | null): void => {
      const activeEl = active?.view.containerEl;
      if (active !== leaf && activeEl?.ownerDocument === el.ownerDocument) stop();
      else check();
    };

    refs.push(this.app.workspace.on("file-open", check));
    // Closing the window is a layout change; the view is gone by then.
    refs.push(this.app.workspace.on("layout-change", check));
    refs.push(this.app.workspace.on("active-leaf-change", activeChanged));
    this.stops.add(stop);
    el.classList.add(...viewClasses);
    body.classList.add(DRAFT_BARE_WINDOW_CLASS);

    if (options.typewriter) {
      // The first line too, before anything is typed: the mode is seen at once.
      const cursor = view.editor.getCursor();
      view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
    }
  }

  stop(): void {
    for (const stop of [...this.stops]) stop();
  }
}
