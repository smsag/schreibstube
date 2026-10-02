/**
 * Interface language and debug logging.
 */
import { Notice, Setting } from "obsidian";
import { setLanguage, t } from "../i18n";
import type { LanguagePreference } from "../i18n";
import type { SettingsContext } from "./context";
import { section } from "./layout";

export function renderDiagnostics(ctx: SettingsContext): void {
  const { containerEl } = ctx;

  section(ctx, { id: "language", name: t().language.heading });

  new Setting(containerEl)
    .setName(t().language.name)
    .setDesc(t().language.desc)
    .addDropdown((dropdown) => {
      dropdown.addOption("auto", t().language.auto);
      dropdown.addOption("de", t().language.de);
      dropdown.addOption("en", t().language.en);
      dropdown.setValue(ctx.plugin.settings.language).onChange(async (value) => {
        await ctx.update({ language: value as LanguagePreference });
        setLanguage(value as LanguagePreference);
        // Command names were read once, at registration; the rest of the
        // interface follows immediately.
        new Notice(t().common.notice(t().language.changed));
        ctx.refresh();
      });
    });

  section(ctx, { id: "diagnostics", name: t().diagnostics.heading });

  new Setting(containerEl)
    .setName(t().diagnostics.debugLogging)
    .setDesc(t().diagnostics.debugLoggingDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.debugLogging).onChange(async (value) => {
        await ctx.update({ debugLogging: value });
      });
    });
}
