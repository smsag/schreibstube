import {
  type App,
  type EventRef,
  type Events,
  MarkdownRenderChild,
  MarkdownView,
  type Plugin,
  TFile
} from "obsidian";
import { t } from "../i18n";
import { TASK_SUMMARY_LANGUAGE, summarizeTasks } from "../services/task-summary";

/** Long enough to fold a burst of keystrokes into one count, short enough
 *  that a tick reads as instant. */
const RERENDER_DELAY_MS = 60;

/**
 * The ```schreibstube-tasks``` block: one line with the open and total task
 * count of the whole note, wherever the block sits, kept current as the note
 * changes.
 */
export function registerTaskRibbon(plugin: Plugin): void {
  plugin.registerMarkdownCodeBlockProcessor(TASK_SUMMARY_LANGUAGE, (_source, el, ctx) => {
    ctx.addChild(new TaskRibbon(plugin.app, el, ctx.sourcePath));
  });
}

class TaskRibbon extends MarkdownRenderChild {
  private readonly subscriptions: Array<[Events, EventRef]> = [];
  private pendingRender: number | null = null;

  constructor(
    private readonly app: App,
    containerEl: HTMLElement,
    private readonly sourcePath: string
  ) {
    super(containerEl);
  }

  override onload(): void {
    this.containerEl.addClass("schreibstube-task-ribbon");

    // Obsidian re-runs a code block processor only when the block's own source
    // changes, and the ribbon's source is empty. Every tick happens elsewhere
    // in the note: keystrokes in an editor, or a write when Reading view
    // toggles a checkbox straight into the file.
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
    const content = await this.readContent();
    const summary = summarizeTasks(content);

    this.containerEl.empty();
    const line = this.containerEl.createDiv({ cls: "schreibstube-task-ribbon-line" });
    if (summary.total === 0) {
      line.setText(t().tasks.none);
      return;
    }

    // The numbers are what the eye is after; the words around them are the
    // same every time. Splitting on digits keeps the sentence translatable as
    // one string and still sets the counts in bold.
    for (const part of t().tasks.ribbon(summary.open, summary.total).split(/(\d+)/)) {
      if (part === "") continue;
      if (/^\d+$/.test(part)) line.createEl("strong", { text: part });
      else line.appendText(part);
    }
  }

  /**
   * The editor's buffer of an open view first, so a tick that is not yet
   * saved counts; the vault's copy when the note is rendered somewhere with
   * no editor behind it.
   */
  private async readContent(): Promise<string> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === this.sourcePath) {
        return view.editor.getValue();
      }
    }

    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (file instanceof TFile) return this.app.vault.cachedRead(file);
    return "";
  }
}
