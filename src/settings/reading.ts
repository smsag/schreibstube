/**
 * Reading history: notes that list what an Instapaper section gains.
 */
import { SecretComponent, Setting } from "obsidian";
import { t } from "../i18n";
import type { SettingsContext } from "./context";
import { section } from "./layout";

export function renderReading(ctx: SettingsContext): void {
  section(ctx, {
    name: t().settings.readingHeading,
    desc: t().settings.readingIntro,
    commands: [t().commands.readingUpdate],
    indexed: true
  });

  new Setting(ctx.containerEl)
    .setName(t().settings.readingEnabled)
    .setDesc(t().settings.readingEnabledDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.readingEnabled).onChange(async (value) => {
        await ctx.update({ readingEnabled: value });
        ctx.refresh();
      });
    });

  if (!ctx.plugin.settings.readingEnabled) return;

  new Setting(ctx.containerEl)
    .setName(t().settings.readingToken)
    .setDesc(t().settings.readingTokenDesc)
    .addComponent((el) =>
      new SecretComponent(ctx.app, el)
        .setValue(ctx.plugin.settings.instapaperSecretName)
        .onChange(async (value) => {
          await ctx.update({ instapaperSecretName: value ?? "" });
        })
    );

  new Setting(ctx.containerEl)
    .setName(t().settings.readingSummaries)
    .setDesc(t().settings.readingSummariesDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.readingSummaries).onChange(async (value) => {
        await ctx.update({ readingSummaries: value });
      });
    });
}
