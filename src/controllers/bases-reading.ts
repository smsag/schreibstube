/**
 * Notes opened from a base open in Reading view, when the person asks for it.
 *
 * Every press is noted, in every window, before Obsidian's own handlers see
 * it: a press in a base's results remembers when it happened, any other
 * press forgets. When a note opens, `services/bases-reading` decides whether
 * that press opened it; if so the note is switched to Reading view without
 * a step in the tab's history, so Back still returns to the base. Which
 * element is a base's results is Obsidian's markup, read in
 * `workspace-internals`.
 */
import { MarkdownView, type App, type TFile } from "obsidian";
import { opensForReading } from "../services/bases-reading";
import type { Logger } from "../services/logger";
import { pressedInBase } from "../services/workspace-internals";

type Register = (doc: Document, type: string, handler: (event: Event) => void) => void;

export class BasesReadingView {
  /** When the last press in a base's results was; null after any other press. */
  private pressedAt: number | null = null;

  constructor(
    private readonly app: App,
    private readonly enabled: () => boolean,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now
  ) {}

  attach(win: Window, register: Register): void {
    const doc = win.document;
    register(doc, "pointerdown", (event) => this.pressed(event.target));
    // A row or card that has the focus opens with Enter, as a link does.
    register(doc, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") this.pressed(event.target);
    });
  }

  private pressed(target: EventTarget | null): void {
    this.pressedAt = this.enabled() && pressedInBase(target) ? this.now() : null;
  }

  /** A file opened in the active tab: the answer to a press in a base, or not. */
  async opened(file: TFile | null): Promise<void> {
    const pressedAt = this.pressedAt;
    if (file === null) return;
    // One press opens one note; whatever opens after it is not its answer.
    this.pressedAt = null;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const shown = view?.file?.path === file.path ? view : null;
    const reading = opensForReading({
      enabled: this.enabled(),
      pressedAt,
      now: this.now(),
      extension: file.extension,
      mode: shown?.getMode() ?? null
    });
    if (!reading || !shown) return;
    try {
      await shown.setState({ ...shown.getState(), mode: "preview" }, { history: false });
    } catch (error) {
      this.logger.warn(`Could not open ${file.path} in Reading view:`, error);
    }
  }
}
