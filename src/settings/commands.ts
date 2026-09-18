/**
 * The commands a feature brings, listed where the feature is explained.
 *
 * The palette is alphabetical and knows nothing about which of two dozen
 * entries belong together; the settings tab is the one place that already
 * groups this plugin by what it does. So each section says what it can be told
 * to do, and a person who has just switched something on can see, without
 * leaving the page, what to type to use it.
 *
 * Names only, and no way to run one from here. This is an index, and a settings
 * page that also acts is a settings page nobody trusts to be only settings.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import type { SettingsContext } from "./context";

export function renderCommands(ctx: SettingsContext, names: readonly string[]): void {
  if (names.length === 0) return;

  const setting = new Setting(ctx.containerEl)
    .setName(t().settings.commandsHeading)
    .setDesc(t().settings.commandsIntro);

  const list = setting.descEl.createEl("ul", { cls: "schreibstube-command-list" });
  for (const name of names) list.createEl("li", { text: name });
}
