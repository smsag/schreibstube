/**
 * Heading stack, focus mode and properties: the settings that change how a note looks while it is being written.
 */
import { Setting } from "obsidian";
import { activeLocale, t } from "../i18n";
import { MAX_DIM_OPACITY, MIN_DIM_OPACITY } from "../services/focus-settings";
import { formatDate } from "../services/today-value";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

export function renderEditor(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().settings.overlayHeading).setHeading();

  new Setting(ctx.containerEl)
    .setName(t().settings.overlayEnabled)
    .setDesc(t().settings.overlayEnabledDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.overlayEnabled).onChange(async (value) => {
        await ctx.update({ overlayEnabled: value });
        ctx.plugin.requestOverlayRefresh();
      });
    });

  new Setting(ctx.containerEl).setName(t().settings.iconShortcodesHeading).setHeading();

  new Setting(ctx.containerEl)
    .setName(t().settings.iconShortcodesEnabled)
    .setDesc(t().settings.iconShortcodesEnabledDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.iconShortcodes).onChange(async (value) => {
        await ctx.update({ iconShortcodes: value });
      });
    });

  new Setting(ctx.containerEl).setName(t().settings.focusHeading).setHeading();

  new Setting(ctx.containerEl)
    .setName(t().settings.focusOpacity)
    .setDesc(t().settings.focusOpacityDesc)
    .addSlider((slider) => {
      slider
        .setDynamicTooltip()
        .setLimits(MIN_DIM_OPACITY, MAX_DIM_OPACITY, 0.05)
        .setValue(ctx.plugin.settings.focusDimOpacity)
        .onChange(async (value) => {
          await ctx.plugin.updateDimOpacity(value);
        });
    });

  renderProperties(ctx);

  renderCommands(ctx, [
    t().commands.newNote,
    t().commands.focusSentence,
    t().commands.focusParagraph,
    t().commands.insertTaskSummary,
    t().commands.insertSlideshow,
    t().commands.insertToday,
    t().commands.linksSwitch
  ]);
}

function renderProperties(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().properties.heading).setHeading();

  const example = (format: string) => formatDate(new Date(), format, activeLocale());
  const dateFormat = new Setting(ctx.containerEl)
    .setName(t().properties.dateFormat)
    .setDesc(t().properties.dateFormatDesc(example(ctx.plugin.settings.dateFormat)));
  dateFormat.addText((text) => {
    text.setValue(ctx.plugin.settings.dateFormat).onChange(async (value) => {
      await ctx.update({ dateFormat: value });
      dateFormat.setDesc(t().properties.dateFormatDesc(example(ctx.plugin.settings.dateFormat)));
    });
  });
}
