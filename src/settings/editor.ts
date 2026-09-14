/**
 * Heading stack and focus mode: the two settings that change how a note looks while it is being written.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import { MAX_DIM_OPACITY, MIN_DIM_OPACITY } from "../services/focus-settings";
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

  renderCommands(ctx, [
    t().commands.focusSentence,
    t().commands.focusParagraph,
    t().commands.focusDisable,
    t().commands.insertTaskSummary,
    t().commands.linksLeft,
    t().commands.linksRight,
    t().commands.linksNormal
  ]);
}
