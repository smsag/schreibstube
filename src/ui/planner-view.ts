import { ItemView, type WorkspaceLeaf } from "obsidian";
import { activeLocale, t } from "../i18n";
import type { Planner } from "../controllers/planner";
import { blockTag, dayKey, shiftDay } from "../services/plan-model";
import { timeRange } from "../services/plan-summary";
import {
  DEFAULT_PREFERENCES,
  EVERY_DAY,
  pressure,
  proposalTitle,
  proposeBlocks,
  type Preferences,
  type Proposal,
  WEEKDAYS
} from "../services/planner-proposals";
import { projectTags, tasksForTag } from "../services/task-inventory";
import { eventsOn, type CalendarEvent } from "../services/plan-protocol";
import type { SchreibstubeSettings } from "../types";
import { applyIcon, installIconFont } from "./icon-font";
import { BlockComposer, DeadlineModal } from "./planner-modals";

export const PLANNER_VIEW_TYPE = "schreibstube-planner";
export const PLANNER_ICON = "calendar-clock";

/** How far ahead the calendar is read for proposals: two working weeks. */
const PROPOSAL_DAYS = 14;

/**
 * The planner: one day at a time, the projects that are running out of it,
 * and what to do about them.
 *
 * The day comes from the calendar through the bridge, so what you see here is
 * what your phone's calendar shows; a block Schreibstube planned carries its
 * project tag in the event, so it is recognisable wherever it is drawn. The
 * arithmetic — which blocks to propose, how pressing a project is — belongs
 * to services/planner-proposals; this asks for it and draws the answer.
 */
export class PlannerView extends ItemView {
  private day = dayKey(new Date());
  /** The day on screen. */
  private events: CalendarEvent[] = [];
  /** What is already taken over the days proposals can land on. */
  private upcoming: CalendarEvent[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly planner: Planner,
    private readonly getSettings: () => SchreibstubeSettings
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PLANNER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t().planner.title;
  }

  override getIcon(): string {
    return PLANNER_ICON;
  }

  override async onOpen(): Promise<void> {
    installIconFont(this.containerEl.doc);
    this.unsubscribe = this.planner.subscribe(() => this.draw());
    await this.planner.refresh();
    await Promise.all([this.loadDay(), this.loadUpcoming()]);
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  /**
   * The calendar for the day on screen. The bridge answers with every event
   * touching the window, so only those that fall on this local day are kept.
   */
  private async loadDay(): Promise<void> {
    const day = this.day;
    const events = await this.planner.events(day, day);
    if (day !== this.day) return;
    this.events = eventsOn(events, day);
    this.draw();
  }

  /** The days a proposal could land on, read once rather than per project. */
  private async loadUpcoming(): Promise<void> {
    const today = new Date();
    this.upcoming = await this.planner.events(
      dayKey(today),
      dayKey(shiftDay(today, PROPOSAL_DAYS - 1))
    );
    this.draw();
  }

  private preferences(): Preferences {
    const settings = this.getSettings();
    return {
      ...DEFAULT_PREFERENCES,
      startMinute: settings.plannerStartMinute,
      lengthMinutes: settings.plannerBlockMinutes,
      capacity: settings.plannerCapacity,
      days: settings.plannerWeekends ? EVERY_DAY : WEEKDAYS
    };
  }

  private draw(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("schreibstube-planner");

    if (!this.planner.configured()) {
      root.createEl("p", { cls: "schreibstube-plan-empty", text: t().planner.notConfigured });
      return;
    }

    this.drawHeader(root);
    this.drawDay(root);
    this.drawProjects(root);

    const { error } = this.planner.current();
    if (error) root.createEl("p", { cls: "schreibstube-plan-error", text: error });
  }

  private drawHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "schreibstube-planner-header" });

    this.step(header, "chevron-left", -1);
    const label = header.createDiv({ cls: "schreibstube-planner-date" });
    label.createSpan({
      text: new Date(`${this.day}T00:00:00`).toLocaleDateString(activeLocale(), {
        weekday: "long",
        day: "numeric",
        month: "long"
      })
    });
    label.addEventListener("click", () => {
      this.day = dayKey(new Date());
      void this.loadDay();
    });
    this.step(header, "chevron-right", 1);

    const refresh = header.createDiv({ cls: "schreibstube-planner-step" });
    applyIcon(refresh, "refresh");
    refresh.addEventListener("click", () => {
      void this.planner.refresh().then(() => Promise.all([this.loadDay(), this.loadUpcoming()]));
    });
  }

  private step(header: HTMLElement, icon: string, offset: number): void {
    const button = header.createDiv({ cls: "schreibstube-planner-step" });
    applyIcon(button, icon);
    button.addEventListener("click", () => {
      this.day = dayKey(shiftDay(new Date(`${this.day}T00:00:00`), offset));
      void this.loadDay();
    });
  }

  /** The day itself: every event, with what Schreibstube planned inside it. */
  private drawDay(root: HTMLElement): void {
    const { plan } = this.planner.current();
    const locale = activeLocale();
    const list = root.createDiv({ cls: "schreibstube-planner-day" });

    const blocks = plan.blocks.filter((block) => dayKey(new Date(block.start)) === this.day);
    const planned = new Set(blocks.map((block) => block.uid));
    const entries = [
      ...blocks.map((block) => ({ start: block.start, end: block.end, block, event: null })),
      ...this.events
        .filter((event) => !planned.has(event.uid))
        .map((event) => ({ start: event.start, end: event.end, block: null, event }))
    ].sort((left, right) => startOf(left) - startOf(right));

    if (entries.length === 0) {
      list.createEl("p", { cls: "schreibstube-plan-empty", text: t().planner.emptyDay });
    }

    for (const entry of entries) {
      const row = list.createDiv({ cls: "schreibstube-planner-entry" });
      row.createSpan({
        cls: "schreibstube-plan-time",
        text: entry.event?.allDay ? t().planner.allDay : timeRange(entry.start, entry.end, locale)
      });

      if (!entry.block) {
        const event = entry.event;
        row.addClass("is-foreign");
        row.createSpan({ cls: "schreibstube-plan-title", text: event?.title ?? "" });
        const tag = blockTag(event?.notes ?? "");
        if (tag) row.createSpan({ cls: "schreibstube-plan-tag", text: `#${tag}` });
        continue;
      }

      const block = entry.block;
      row.createSpan({ cls: "schreibstube-plan-title", text: block.title });
      row.createSpan({ cls: "schreibstube-plan-tag", text: `#${block.tag}` });

      const drop = row.createDiv({ cls: "schreibstube-planner-step" });
      applyIcon(drop, "trash");
      drop.setAttribute("aria-label", t().planner.dropBlock);
      drop.addEventListener("click", () => {
        void this.planner.dropBlock(block.uid);
      });

      const tasks = list.createEl("ul", { cls: "schreibstube-plan-tasks" });
      for (const member of block.members) {
        const item = tasks.createEl("li");
        if (member.done) item.addClass("is-done");
        item.createSpan({ cls: "schreibstube-plan-mark", text: member.done ? "×" : "○" });
        const label = item.createSpan({ cls: "schreibstube-plan-task", text: member.text });
        label.addEventListener("click", () => {
          void this.planner.openKey(member.key);
        });
        if (member.remind) {
          item.createSpan({ cls: "schreibstube-plan-remind", text: t().planner.remindMark });
        }
      }
    }
  }

  /** The projects: how much is open, how long is left, and what to do now. */
  private drawProjects(root: HTMLElement): void {
    const settings = this.getSettings();
    const state = this.planner.current();
    const preferences = this.preferences();
    const now = new Date();

    root.createEl("h4", { cls: "schreibstube-planner-heading", text: t().planner.projects });
    const tags = projectTags(state.tasks, settings.plannerTagPrefix);
    if (tags.length === 0) {
      root.createEl("p", {
        cls: "schreibstube-plan-empty",
        text: t().planner.noProjects(settings.plannerTagPrefix)
      });
      return;
    }

    for (const { tag, open } of tags.slice(0, 20)) {
      const card = root.createDiv({ cls: "schreibstube-planner-project" });
      const head = card.createDiv({ cls: "schreibstube-planner-project-head" });
      head.createSpan({ cls: "schreibstube-plan-tag", text: `#${tag}` });

      const state_ = pressure(tag, state.plan, open, preferences.capacity, now);
      head.createSpan({
        cls: "schreibstube-plan-count",
        text:
          state_.daysLeft === null
            ? t().planner.openTasks(open)
            : t().planner.pressure(open, state_.daysLeft, state_.plannedCapacity)
      });

      const deadline = card.createDiv({ cls: "schreibstube-planner-step" });
      applyIcon(deadline, "flag");
      deadline.setAttribute("aria-label", t().planner.deadlineTitle(`#${tag}`));
      deadline.addEventListener("click", () => {
        new DeadlineModal(
          this.app,
          tag,
          state_.deadline,
          state.plan.deadlines[tag]?.capacity ?? preferences.capacity,
          (date, capacity) => {
            void this.planner.setTagDeadline(tag, date, capacity);
          }
        ).open();
      });

      this.drawProposals(card, tag, open, preferences);
    }
  }

  private drawProposals(card: HTMLElement, tag: string, open: number, preferences: Preferences) {
    const state = this.planner.current();
    const settings = this.getSettings();
    const now = new Date();
    const capacity = state.plan.deadlines[tag]?.capacity ?? preferences.capacity;

    const proposals = proposeBlocks({
      tag,
      deadline: state.plan.deadlines[tag]?.date ?? null,
      openTasks: open,
      plan: state.plan,
      busy: this.upcoming,
      preferences: { ...preferences, capacity },
      now
    });

    const row = card.createDiv({ cls: "schreibstube-planner-proposals" });
    if (proposals.length === 0) {
      row.createSpan({
        cls: "schreibstube-planner-hint",
        text:
          state.plan.deadlines[tag] === undefined
            ? t().planner.needsDeadline
            : t().planner.nothingToPropose
      });
      return;
    }

    for (const proposal of proposals.slice(0, 3)) {
      const button = row.createEl("button", {
        cls: "schreibstube-planner-proposal",
        text: proposalLabel(proposal)
      });
      button.addEventListener("click", () => {
        this.compose(tag, proposal, capacity, settings);
      });
    }
  }

  private compose(
    tag: string,
    proposal: Proposal,
    capacity: number,
    settings: SchreibstubeSettings
  ): void {
    const state = this.planner.current();
    const candidates = tasksForTag(state.tasks, tag).filter((task) => !state.planned.has(task));

    new BlockComposer(
      this.app,
      tag,
      candidates,
      settings.plannerCalendars[0] ?? "",
      proposal.start,
      settings.plannerBlockMinutes,
      proposalTitle(tag, settings.plannerBlockPrefix),
      capacity,
      (draft) => {
        void this.planner
          .planBlock({ ...draft, tag })
          .then(() => Promise.all([this.loadDay(), this.loadUpcoming()]));
      }
    ).open();
  }
}

function proposalLabel(proposal: Proposal): string {
  return proposal.start.toLocaleString(activeLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** An all-day entry heads the day; a bare date would otherwise sort by UTC midnight. */
function startOf(entry: { start: string; event: CalendarEvent | null }): number {
  return entry.event?.allDay ? Number.NEGATIVE_INFINITY : Date.parse(entry.start);
}
