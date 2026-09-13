/**
 * Document sync: a note bound to a remote source mirrors it, and the schedule that checks for changes.
 */
import { SecretComponent, Setting } from "obsidian";
import { t } from "../i18n";
import { cronPresets, nextRun, parseCron } from "../services/cron";
import { MAX_SYNC_INTERVAL_MINUTES, MIN_SYNC_INTERVAL_MINUTES } from "../services/plugin-settings";
import type { SettingsContext } from "./context";

export function renderSync(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().settings.syncHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().settings.syncIntro);

  new Setting(ctx.containerEl)
    .setName(t().settings.syncEnabled)
    .setDesc(t().settings.syncEnabledDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.syncEnabled).onChange(async (value) => {
        await ctx.update({ syncEnabled: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.syncOnOpen)
    .setDesc(t().settings.syncOnOpenDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.syncCheckOnOpen).onChange(async (value) => {
        await ctx.update({ syncCheckOnOpen: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.syncInterval)
    .setDesc(t().settings.syncIntervalDesc)
    .addSlider((slider) => {
      slider
        .setDynamicTooltip()
        .setLimits(MIN_SYNC_INTERVAL_MINUTES, MAX_SYNC_INTERVAL_MINUTES, 5)
        .setValue(ctx.plugin.settings.syncMinIntervalMinutes)
        .onChange(async (value) => {
          await ctx.update({ syncMinIntervalMinutes: value });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.syncToken)
    .setDesc(t().settings.syncTokenDesc)
    .addComponent((el) =>
      new SecretComponent(ctx.app, el)
        .setValue(ctx.plugin.settings.githubSecretName)
        .onChange(async (value) => {
          await ctx.update({ githubSecretName: value });
        })
    );

  new Setting(ctx.containerEl)
    .setName(t().settings.syncPoll)
    .setDesc(t().settings.syncPollDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.syncPollEnabled).onChange(async (value) => {
        await ctx.update({ syncPollEnabled: value });
        ctx.refresh();
      });
    });

  if (ctx.plugin.settings.syncPollEnabled) {
    renderPollSchedule(ctx);
  }
}

function renderPollSchedule(ctx: SettingsContext): void {
  let feedback: HTMLElement | null = null;

  const describe = (expression: string): void => {
    if (!feedback) return;
    feedback.empty();

    const parsed = parseCron(expression);
    if (!parsed.ok) {
      feedback.addClass("schreibstube-setting-error");
      feedback.removeClass("schreibstube-setting-hint");
      feedback.setText(parsed.reason);
      return;
    }

    feedback.removeClass("schreibstube-setting-error");
    feedback.addClass("schreibstube-setting-hint");
    const next = nextRun(parsed.schedule, new Date());
    feedback.setText(next ? t().cron.nextRun(next.toLocaleString()) : t().cron.never);
  };

  const examples = cronPresets()
    .map((preset) => `${preset.expression} (${preset.label})`)
    .join(", ");

  new Setting(ctx.containerEl)
    .setName(t().settings.syncSchedule)
    .setDesc(t().settings.syncScheduleDesc(examples))
    .addText((text) => {
      text.setPlaceholder("0 * * * *");
      text.setValue(ctx.plugin.settings.syncPollCron);
      text.onChange(async (value) => {
        describe(value);
        const parsed = parseCron(value);
        if (!parsed.ok) return;
        await ctx.update({ syncPollCron: value });
      });
    });

  feedback = ctx.containerEl.createDiv({ cls: "schreibstube-setting-hint" });
  describe(ctx.plugin.settings.syncPollCron);
}
