/**
 * The day planner: the bridge that holds the plan, the calendar it writes
 * blocks into, and what the planner assumes about a working morning.
 */
import { SecretComponent, Setting } from "obsidian";
import { t } from "../i18n";
import { normalizeCalendars } from "../services/plugin-settings";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

export function renderPlanner(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().settings.plannerHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().settings.plannerIntro);

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerEnabled)
    .setDesc(t().settings.plannerEnabledDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.plannerEnabled).onChange(async (value) => {
        await ctx.update({ plannerEnabled: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerBridgeUrl)
    .setDesc(t().settings.plannerBridgeUrlDesc)
    .addText((text) => {
      text.setPlaceholder("https://bridge.example.de");
      text.setValue(ctx.plugin.settings.plannerBridgeUrl).onChange(async (value) => {
        await ctx.update({ plannerBridgeUrl: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerToken)
    .setDesc(t().settings.plannerTokenDesc)
    .addComponent((el) =>
      new SecretComponent(ctx.app, el)
        .setValue(ctx.plugin.settings.plannerTokenSecretName)
        .onChange(async (value) => {
          await ctx.update({ plannerTokenSecretName: value });
        })
    );

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerCalendars)
    .setDesc(t().settings.plannerCalendarsDesc)
    .addText((text) => {
      text.setPlaceholder(t().settings.plannerCalendarsPlaceholder);
      text.setValue(ctx.plugin.settings.plannerCalendars.join(", ")).onChange(async (value) => {
        await ctx.update({ plannerCalendars: normalizeCalendars(value) });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerTagPrefix)
    .setDesc(t().settings.plannerTagPrefixDesc)
    .addText((text) => {
      text.setValue(ctx.plugin.settings.plannerTagPrefix).onChange(async (value) => {
        await ctx.update({ plannerTagPrefix: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerStart)
    .setDesc(t().settings.plannerStartDesc)
    .addText((text) => {
      text.inputEl.type = "time";
      text.setValue(clockOf(ctx.plugin.settings.plannerStartMinute)).onChange(async (value) => {
        const minute = minuteOf(value);
        if (minute !== null) await ctx.update({ plannerStartMinute: minute });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerLength)
    .setDesc(t().settings.plannerLengthDesc)
    .addText((text) => {
      text.inputEl.type = "number";
      text.setValue(String(ctx.plugin.settings.plannerBlockMinutes)).onChange(async (value) => {
        if (value.trim() !== "") await ctx.update({ plannerBlockMinutes: Number(value) });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerCapacity)
    .setDesc(t().settings.plannerCapacityDesc)
    .addText((text) => {
      text.inputEl.type = "number";
      text.setValue(String(ctx.plugin.settings.plannerCapacity)).onChange(async (value) => {
        if (value.trim() !== "") await ctx.update({ plannerCapacity: Number(value) });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerWeekends)
    .setDesc(t().settings.plannerWeekendsDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.plannerWeekends).onChange(async (value) => {
        await ctx.update({ plannerWeekends: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.plannerBlockPrefix)
    .setDesc(t().settings.plannerBlockPrefixDesc)
    .addText((text) => {
      text.setValue(ctx.plugin.settings.plannerBlockPrefix).onChange(async (value) => {
        await ctx.update({ plannerBlockPrefix: value });
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
    .setName(t().settings.plannerBlockHelp)
    .setDesc(t().settings.plannerBlockHelpDesc);

  renderCommands(ctx, [t().commands.openPlanner]);
}

/** Minutes from midnight as a clock a time field understands. */
function clockOf(minute: number): string {
  const hours = `${Math.floor(minute / 60)}`.padStart(2, "0");
  const minutes = `${minute % 60}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function minuteOf(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute < 24 * 60 ? minute : null;
}
