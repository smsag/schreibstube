import { type App, type EventRef, MarkdownView, type TFile, type WorkspaceLeaf } from "obsidian";
import { fillsScreen } from "../services/new-note";

/** Sets the line width to two thirds of the window, in styles.css. */
export const DRAFT_WIDTH_CLASS = "schreibstube-draft-width";

/**
 * The new note's lines, two thirds of its window wide while that window
 * fills the screen.
 *
 * Obsidian's readable line length is a fixed width, 700 px by default, which
 * on a screen-filling window leaves a thin column in a wide empty page; with
 * the setting off, a line runs the width of the screen. The note the new-note
 * command opens is where a person starts writing, so it gets a line in
 * proportion to the window instead, whether the setting is on or off.
 *
 * Only this once, as with the footer held back from it: the width belongs to
 * the view the note first opens in and lasts while that view shows that note.
 * Leaving or entering full screen is followed; showing another note, closing
 * the window or opening the note again anywhere else gives the usual width.
 */
export class DraftWidth {
  private readonly stops = new Set<() => void>();

  constructor(private readonly app: App) {}

  follow(leaf: WorkspaceLeaf, file: TFile): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const el = view.containerEl;
    const win = el.ownerDocument.defaultView;
    if (!win) return;

    const refs: EventRef[] = [];
    const stop = (): void => {
      win.removeEventListener("resize", update);
      for (const ref of refs) this.app.workspace.offref(ref);
      el.classList.remove(DRAFT_WIDTH_CLASS);
      this.stops.delete(stop);
    };
    // A rename keeps the file, so identity is what says the view moved on.
    const update = (): void => {
      if (view.file !== file || !el.isConnected) {
        stop();
        return;
      }
      el.classList.toggle(DRAFT_WIDTH_CLASS, fillsScreen(win, win.screen));
    };

    win.addEventListener("resize", update);
    refs.push(this.app.workspace.on("file-open", update));
    // Closing the window is a layout change; the view is gone by then.
    refs.push(this.app.workspace.on("layout-change", update));
    this.stops.add(stop);
    update();
  }

  stop(): void {
    for (const stop of [...this.stops]) stop();
  }
}
