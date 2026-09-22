/**
 * Keeping tasks in sync with Apple's Reminders: the switch, the list, what
 * counts as a reminder, and the one Shortcut plus two automations that carry
 * it on the Apple side.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import type { ReminderTrigger } from "../services/reminder-tasks";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

/**
 * Where the Shortcut is installed from: its iCloud link once it is shared,
 * and until then the page that describes how to build it.
 */
export const REMINDERS_SHORTCUT_URL =
  "https://github.com/smsag/schreibstube/blob/main/REMINDERS.md";

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
    .setName(t().settings.remindersTrigger)
    .setDesc(t().settings.remindersTriggerDesc)
    .addDropdown((dropdown) => {
      dropdown
        .addOption("date", t().settings.remindersTriggerDate)
        .addOption("tag", t().settings.remindersTriggerTag)
        .setValue(ctx.plugin.settings.remindersTrigger)
        .onChange(async (value) => {
          await ctx.update({ remindersTrigger: value as ReminderTrigger });
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
    .setName(t().settings.remindersFolder)
    .setDesc(t().settings.remindersFolderDesc)
    .addText((text) => {
      text.setValue(ctx.plugin.settings.remindersFolder).onChange(async (value) => {
        await ctx.update({ remindersFolder: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.remindersShortcut)
    .setDesc(t().settings.remindersShortcutDesc)
    .addButton((button) =>
      button.setButtonText(t().settings.remindersShortcutButton).onClick(() => {
        window.open(REMINDERS_SHORTCUT_URL);
      })
    );

  new Setting(ctx.containerEl)
    .setName(t().settings.remindersAutomations)
    .setDesc(t().settings.remindersAutomationsDesc);

  renderCommands(ctx, [t().commands.sendToReminders, t().commands.reminders]);
}
