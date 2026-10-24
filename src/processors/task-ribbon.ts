import type { App, Plugin } from "obsidian";
import { t } from "../i18n";
import { TASK_SUMMARY_LANGUAGE, summarizeTasks } from "../services/task-summary";
import { appendWithStrongFigures } from "../ui/strong-figures";
import { LiveNoteBlock } from "./live-note-block";

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

class TaskRibbon extends LiveNoteBlock {
  /** The line as last drawn: a keystroke in a paragraph leaves it as it was. */
  private drawn: string | null = null;

  constructor(app: App, containerEl: HTMLElement, sourcePath: string) {
    super(app, containerEl, sourcePath);
    containerEl.addClass("schreibstube-task-ribbon");
  }

  protected draw(content: string): void {
    const summary = summarizeTasks(content);
    const text =
      summary.total === 0
        ? t().tasks.none
        : t().tasks.ribbon(summary.open, summary.total, summary.progress, summary.cancelled);
    if (text === this.drawn) return;
    this.drawn = text;

    this.containerEl.empty();
    const line = this.containerEl.createDiv({ cls: "schreibstube-task-ribbon-line" });
    if (summary.total === 0) line.setText(text);
    else appendWithStrongFigures(line, text);
  }
}
