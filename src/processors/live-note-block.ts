import { type App, MarkdownRenderChild, MarkdownView, TFile } from "obsidian";

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
  private pendingRender: number | null = null;
  /**
   * Which read is the latest. A read of the file is slower than one of an
   * editor's buffer, so an earlier read could land after a later one and draw
   * the note as it was; and one landing after the block was unloaded drew
   * into an element nobody shows.
   */
  private renders = 0;

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
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (info.file?.path === this.sourcePath) this.scheduleRender();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file.path === this.sourcePath) this.scheduleRender();
      })
    );
    this.register(() => {
      if (this.pendingRender !== null) window.clearTimeout(this.pendingRender);
      this.pendingRender = null;
      this.renders += 1;
    });

    void this.render();
  }

  private scheduleRender(): void {
    if (this.pendingRender !== null) return;
    this.pendingRender = window.setTimeout(() => {
      this.pendingRender = null;
      void this.render();
    }, RERENDER_DELAY_MS);
  }

  private async render(): Promise<void> {
    const render = ++this.renders;
    const content = await this.readContent();
    if (render === this.renders) this.draw(content);
  }

  /** The first open markdown view that `accepts`. */
  protected findView(accepts: (view: MarkdownView) => boolean): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && accepts(view)) return view;
    }
    return null;
  }

  /**
   * The editor holding this note, if one is open. One in Live Preview or
   * Source mode first: a pane in Reading view shows the file, while an
   * editor's buffer may be newer than it, and that buffer is what a write
   * must go into so its next save does not drop the change.
   */
  protected noteEditor(): MarkdownView | null {
    const showsNote = (view: MarkdownView) => view.file?.path === this.sourcePath;
    return (
      this.findView((view) => showsNote(view) && view.getMode() === "source") ??
      this.findView(showsNote)
    );
  }

  /**
   * The editor's buffer of an open view first, so a change that is not yet
   * saved counts; the vault's copy when the note is rendered somewhere with
   * no editor behind it.
   */
  private async readContent(): Promise<string> {
    const view = this.noteEditor();
    if (view) return view.editor.getValue();

    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (file instanceof TFile) return this.app.vault.cachedRead(file);
    return "";
  }
}
