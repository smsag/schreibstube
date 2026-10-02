/**
 * The shapes the settings tab is built from, so every section reads alike.
 *
 * The tab grew one feature at a time, each with its own heading, its own
 * paragraph and its own bullet list of commands, and read as a long scroll of
 * equal-looking rows. Now it has three blocks — small helpers, the AI model,
 * the large features — each feature a section that opens with one box saying
 * what it does and which commands it brings, a pill on the ones that need the
 * AI, details that are rarely changed folded away, and a line at the top that
 * jumps to any section.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import { pressKeys } from "../ui/pressable";
import type { SettingsContext } from "./context";

/** A section the index at the top links to. */
export interface SectionEntry {
  name: string;
  el: HTMLElement;
  /** A block's heading rather than a feature's, which the index sets apart. */
  block: boolean;
}

export interface SectionSpec {
  name: string;
  /** What the feature does, in a sentence or two. */
  desc?: string;
  /** The names of the commands it brings, as the palette shows them. */
  commands?: readonly string[];
  /** Whether the feature asks the AI, which a pill beside its name says. */
  ai?: boolean;
  /** Whether the index at the top links to it: the large features do, the small helpers not. */
  indexed?: boolean;
}

/** One of the three blocks: small helpers, the AI model, the large features. */
export function block(ctx: SettingsContext, name: string): void {
  const heading = new Setting(ctx.containerEl).setName(name).setHeading();
  heading.settingEl.addClass("schreibstube-settings-block");
  ctx.index.push({ name, el: heading.settingEl, block: true });
}

/**
 * A feature's heading and the box under it: what it does, and the commands it
 * brings on one line rather than a list of their own, which took a box for
 * itself and pushed the settings a screen further down.
 */
export function section(ctx: SettingsContext, spec: SectionSpec): void {
  const heading = new Setting(ctx.containerEl).setName(spec.name).setHeading();
  heading.settingEl.addClass("schreibstube-settings-section");
  if (spec.ai) aiPill(heading.controlEl, ctx.plugin.aiReady());
  if (spec.indexed) ctx.index.push({ name: spec.name, el: heading.settingEl, block: false });

  const commands = spec.commands ?? [];
  if (!spec.desc && commands.length === 0) return;
  const intro = new Setting(ctx.containerEl);
  intro.settingEl.addClass("schreibstube-settings-intro");
  if (spec.desc) intro.descEl.createDiv({ text: spec.desc });
  if (commands.length > 0) {
    const words = t().settings;
    const line = intro.descEl.createDiv({
      cls: "schreibstube-command-line",
      attr: { title: words.commandsIntro }
    });
    line.createSpan({ cls: "schreibstube-command-line-label", text: `${words.commandsHeading}: ` });
    line.createSpan({ text: commands.join(" · ") });
  }
}

/**
 * The small "AI" pill on a feature or a setting that asks the AI. Greyed while
 * no key is chosen, which is when the feature itself is left out everywhere
 * else.
 */
export function aiPill(parent: HTMLElement, ready: boolean): HTMLElement {
  const words = t().settings;
  const pill = parent.createSpan({
    cls: "schreibstube-ai-pill",
    text: words.aiPill,
    attr: { title: ready ? words.aiPillTitle : words.needsAiKey }
  });
  pill.toggleClass("is-off", !ready);
  return pill;
}

/** A setting that asks the AI, with the pill beside its name. */
export function markAi(setting: Setting, ready: boolean): Setting {
  aiPill(setting.nameEl, ready);
  return setting;
}

/**
 * Details inside a feature that are rarely changed — the publish keys, a
 * mailbox's limits — folded under one line, closed until opened. The rows go
 * into the context this returns.
 */
export function fold(ctx: SettingsContext, name: string, desc: string): SettingsContext {
  const details = ctx.containerEl.createEl("details", { cls: "schreibstube-settings-fold" });
  const summary = details.createEl("summary", { cls: "schreibstube-settings-fold-summary" });
  summary.createSpan({ cls: "schreibstube-settings-fold-name", text: name });
  summary.createSpan({ cls: "schreibstube-settings-fold-desc", text: desc });
  return { ...ctx, containerEl: details.createDiv({ cls: "schreibstube-settings-fold-body" }) };
}

/**
 * The navigation at the top that jumps to a section: the tab is long, and the
 * section somebody came for is usually not the first. The blocks are one row
 * and the features another, each a target of its own: run together as one
 * sentence of names, bold and plain mixed, the line read as text and was hard
 * to aim at.
 */
export function renderIndex(el: HTMLElement, entries: readonly SectionEntry[]): void {
  el.empty();
  el.setAttribute("role", "navigation");
  el.setAttribute("aria-label", t().settings.indexLabel);
  const blocks = el.createDiv({ cls: "schreibstube-settings-index-blocks" });
  const features = el.createDiv({ cls: "schreibstube-settings-index-features" });
  for (const entry of entries) {
    const link = (entry.block ? blocks : features).createEl("a", {
      cls: entry.block ? "schreibstube-settings-index-block" : "schreibstube-settings-index-chip",
      text: entry.name,
      attr: { role: "button", tabindex: "0" }
    });
    const jump = (): void => entry.el.scrollIntoView({ block: "start", behavior: "smooth" });
    link.addEventListener("click", jump);
    pressKeys(link, jump);
  }
}
