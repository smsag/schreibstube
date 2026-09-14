/**
 * Sending a task to Apple's Reminders: the switch, the list, and the Shortcut that does the work.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

export function renderReminders(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().settings.remindersHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().settings.remindersIntro);

  new Setting(ctx.containerEl)
    .setName(t().settings.remindersEnabled)
    .setDesc(t().settings.remindersEnabledDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.remindersEnabled).onChange(async (value) => {
        await ctx.update({ remindersEnabled: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.remindersList)
    .setDesc(t().settings.remindersListDesc)
    .addText((text) => {
      text.setValue(ctx.plugin.settings.remindersList).onChange(async (value) => {
        await ctx.update({ remindersList: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.remindersShortcut)
    .setDesc(t().settings.remindersShortcutDesc)
    .addText((text) => {
      text.setValue(ctx.plugin.settings.remindersShortcut).onChange(async (value) => {
        await ctx.update({ remindersShortcut: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.remindersSetup)
    .setDesc(t().settings.remindersSetupDesc);

  renderCommands(ctx, [t().commands.sendToReminders]);
}
