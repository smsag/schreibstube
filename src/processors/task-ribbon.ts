import {
  type App,
  type EventRef,
  type Events,
  MarkdownRenderChild,
  MarkdownView,
  type Plugin,
  TFile
} from "obsidian";
import { TASK_SUMMARY_LANGUAGE, formatRibbonText, summarizeTasks } from "../services/task-summary";

const RERENDER_DELAY_MS = 60;

/**
 * Registers the ```schreibstube-tasks``` code block. Wherever the block sits,
 * it renders a one-line ribbon with the open and total task counts of the
 * whole note and re-renders whenever the note changes.
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

  onload(): void {
    this.containerEl.addClass("schreibstube-task-ribbon");

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

  onunload(): void {
    if (this.pendingRender !== null) {
      window.clearTimeout(this.pendingRender);
      this.pendingRender = null;
    }
    for (const [emitter, ref] of this.subscriptions) {
      emitter.offref(ref);
    }
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
      line.setText(formatRibbonText(summary));
      return;
    }
    line.createEl("strong", { text: String(summary.open) });
    line.appendText(" open of ");
    line.createEl("strong", { text: String(summary.total) });
  }

  /**
   * Prefers the live editor buffer of an open view so unsaved edits count;
   * falls back to the vault copy when the note is only rendered elsewhere.
   */
  private async readContent(): Promise<string> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === this.sourcePath) {
        return view.editor.getValue();
      }
    }

    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (file instanceof TFile) {
      return this.app.vault.cachedRead(file);
    }
    return "";
  }
}
