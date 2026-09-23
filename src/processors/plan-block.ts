import { MarkdownRenderChild, type Plugin } from "obsidian";
import { activeLocale, t } from "../i18n";
import { PLAN_REFRESH_MS, type Planner } from "../controllers/planner";
import {
  parsePlanOptions,
  PLAN_BLOCK_LANGUAGE,
  summarize,
  timeRange,
  type PlanSummary
} from "../services/plan-summary";

/**
 * The ```schreibstube-plan``` block: the day's plan, on the note you start
 * from.
 *
 * People build their own start pages, and a plan that only exists in a
 * sidebar is a plan you have to go and look for. The block is read-only on
 * purpose — planning happens in the planner leaf, and a start page should
 * survive being opened on a phone at six in the morning without offering
 * anything to press by accident.
 *
 * Every decision about what to show is in services/plan-summary.
 */
export function registerPlanBlock(plugin: Plugin, planner: Planner): void {
  plugin.registerMarkdownCodeBlockProcessor(PLAN_BLOCK_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new PlanPanel(el, source, planner));
  });
}

class PlanPanel extends MarkdownRenderChild {
  private unsubscribe: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly source: string,
    private readonly planner: Planner
  ) {
    super(containerEl);
  }

  override onload(): void {
    this.unsubscribe = this.planner.subscribe(() => this.draw());
    this.draw();
    // A start page is drawn again on every edit to it, and several blocks can
    // sit on one; the plan is asked for only when what is on screen is old.
    if (this.planner.isStale(PLAN_REFRESH_MS)) void this.planner.refresh();
  }

  override onunload(): void {
    this.unsubscribe?.();
  }

  private draw(): void {
    const options = parsePlanOptions(this.source);
    const state = this.planner.current();
    const panel = this.containerEl;
    panel.empty();
    panel.addClass("schreibstube-plan-panel");

    if (!this.planner.configured()) {
      panel.createEl("p", { cls: "schreibstube-plan-empty", text: t().planner.notConfigured });
      return;
    }

    const summary = summarize({
      plan: state.plan,
      tasks: state.tasks,
      lost: state.lost,
      options,
      now: new Date()
    });

    if (options.show !== "deadlines") this.drawBlocks(panel, summary);
    if (options.show !== "blocks") this.drawDeadlines(panel, summary);
    if (state.error) {
      panel.createEl("p", { cls: "schreibstube-plan-error", text: state.error });
    }
  }

  private drawBlocks(panel: HTMLElement, summary: PlanSummary): void {
    if (summary.blocks.length === 0) {
      panel.createEl("p", { cls: "schreibstube-plan-empty", text: t().planner.nothingPlanned });
      return;
    }

    const locale = activeLocale();
    for (const block of summary.blocks) {
      const section = panel.createDiv({ cls: "schreibstube-plan-block" });
      if (block.live) section.addClass("is-live");

      const head = section.createDiv({ cls: "schreibstube-plan-block-head" });
      head.createSpan({
        cls: "schreibstube-plan-time",
        text: timeRange(block.start, block.end, locale)
      });
      head.createSpan({ cls: "schreibstube-plan-title", text: block.title });
      head.createSpan({
        cls: "schreibstube-plan-count",
        text: t().planner.openOf(block.open, block.tasks.length)
      });

      const list = section.createEl("ul", { cls: "schreibstube-plan-tasks" });
      for (const task of block.tasks) {
        const item = list.createEl("li");
        if (task.done) item.addClass("is-done");
        if (task.lost) item.addClass("is-lost");
        item.createSpan({ cls: "schreibstube-plan-mark", text: task.done ? "×" : "○" });
        const label = item.createSpan({ cls: "schreibstube-plan-task", text: task.text });
        label.addEventListener("click", () => {
          void this.planner.openKey(task.key);
        });
        if (task.lost) item.createSpan({ cls: "schreibstube-plan-lost", text: t().planner.lost });
      }
    }
  }

  private drawDeadlines(panel: HTMLElement, summary: PlanSummary): void {
    if (summary.deadlines.length === 0) return;

    const list = panel.createEl("ul", { cls: "schreibstube-plan-deadlines" });
    for (const deadline of summary.deadlines) {
      const item = list.createEl("li");
      if (deadline.daysLeft < 0) item.addClass("is-late");
      item.createSpan({ cls: "schreibstube-plan-tag", text: `#${deadline.tag}` });
      item.createSpan({
        cls: "schreibstube-plan-days",
        text: t().planner.daysLeft(deadline.daysLeft)
      });
      item.createSpan({
        cls: "schreibstube-plan-count",
        text: t().planner.openPlanned(deadline.openTasks, deadline.plannedTasks)
      });
    }
  }
}
