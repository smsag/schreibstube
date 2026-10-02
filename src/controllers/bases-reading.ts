/**
 * Notes opened from a base open in Reading view, when that base asks for it.
 *
 * Every press is noted, in every window, before Obsidian's own handlers see
 * it: a press in the results of a base that opens its notes for reading
 * remembers when it happened, any other press forgets. When a note opens,
 * `services/bases-reading` decides whether that press opened it; if so the
 * note is switched to Reading view without a step in the tab's history, so
 * Back still returns to the base. Which element is a base's results, and
 * which base it belongs to, is Obsidian's markup, read in
 * `workspace-internals`; whether the base asks is its file, read in
 * `base-reading-flags`.
 */
import { MarkdownView, type App, type TFile } from "obsidian";
import { opensForReading } from "../services/bases-reading";
import type { Logger } from "../services/logger";
import { embedLinkpath } from "../services/picture-embed-actions";
import { basePressed, fileShownAround } from "../services/workspace-internals";

/** What the controller asks of the bases' files: whether one opens its notes for reading. */
export interface BaseReadingAnswers {
  reads(file: TFile): boolean;
}

type Register = (doc: Document, type: string, handler: (event: Event) => void) => void;

export class BasesReadingView {
  /** When the last press in a base's results was; null after any other press. */
  private pressedAt: number | null = null;

  constructor(
    private readonly app: App,
    private readonly flags: BaseReadingAnswers,
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
    const base = this.baseUnder(target);
    this.pressedAt = base && this.flags.reads(base) ? this.now() : null;
  }

  /**
   * The base file a press landed in: the one its tab shows, or the one an
   * embed links to, found as Obsidian finds it from the note it is in. A
   * code block has no file, and opens its notes as any link does.
   */
  private baseUnder(target: EventTarget | null): TFile | null {
    const press = basePressed(target);
    if (!press || press.kind === "block") return null;
    const shown = fileShownAround(this.app, target as Node);
    if (press.kind === "tab") return shown?.extension === "base" ? shown : null;
    const link = embedLinkpath(press.link);
    if (link === null) return null;
    const file = this.app.metadataCache.getFirstLinkpathDest(link, shown?.path ?? "");
    return file?.extension === "base" ? file : null;
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
      // Asked at the press: only a press in a base that opens its notes for
      // reading is remembered at all.
      enabled: pressedAt !== null,
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
