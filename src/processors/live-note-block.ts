import {
  type App,
  type EventRef,
  type Events,
  MarkdownRenderChild,
  MarkdownView,
  TFile
} from "obsidian";

/** Long enough to fold a burst of keystrokes into one render, short enough
 *  that a tick reads as instant. */
const RERENDER_DELAY_MS = 60;

/**
 * A code block that shows something about the note it stands in — the task
 * ribbon, the index — and keeps it current as the note changes.
 *
 * Obsidian re-runs a code block processor only when the block's own source
 * changes, and what these blocks show changes elsewhere in the note:
 * keystrokes in an editor, or a write when Reading view toggles a checkbox
 * straight into the file.
 */
export abstract class LiveNoteBlock extends MarkdownRenderChild {
  private readonly subscriptions: Array<[Events, EventRef]> = [];
  private pendingRender: number | null = null;

  constructor(
    protected readonly app: App,
    containerEl: HTMLElement,
    protected readonly sourcePath: string
  ) {
    super(containerEl);
  }

  /** Draws the block from the note's current text. */
  protected abstract draw(content: string): void;

  override onload(): void {
    this.subscribe(
      this.app.workspace,
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (info.file?.path === this.sourcePath) this.scheduleRender();
      })
    );
    this.subscribe(
      this.app.metadataCache,
      this.app.metadataCache.on("changed", (file) => {
        if (file.path === this.sourcePath) this.scheduleRender();
      })
    );

    void this.render();
  }

  override onunload(): void {
    if (this.pendingRender !== null) {
      window.clearTimeout(this.pendingRender);
      this.pendingRender = null;
    }
    for (const [emitter, ref] of this.subscriptions) emitter.offref(ref);
    this.subscriptions.length = 0;
  }

  private subscribe(emitter: Events, ref: EventRef): void {
    this.subscriptions.push([emitter, ref]);
  }

  private scheduleRender(): void {
    if (this.pendingRender !== null) return;
    this.pendingRender = window.setTimeout(() => {
      this.pendingRender = null;
      void this.render();
    }, RERENDER_DELAY_MS);
  }

  private async render(): Promise<void> {
    this.draw(await this.readContent());
  }

  /** The open view of this note, if one is: its buffer is newer than the file. */
  protected noteView(): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === this.sourcePath) return view;
    }
    return null;
  }

  /**
   * The editor's buffer of an open view first, so a change that is not yet
   * saved counts; the vault's copy when the note is rendered somewhere with
   * no editor behind it.
   */
  private async readContent(): Promise<string> {
    const view = this.noteView();
    if (view) return view.editor.getValue();

    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (file instanceof TFile) return this.app.vault.cachedRead(file);
    return "";
  }
}
