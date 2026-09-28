/**
 * Sums and formulas: how numbers are read, the default currency, and whether
 * mixed currencies are converted.
 */
import { Setting } from "obsidian";
import { obsidianLanguageTag, t } from "../i18n";
import {
  CURRENCY_CODES,
  NUMBER_STYLES,
  numberFormatFor,
  type NumberStyle
} from "../services/amounts";
import { formatAmount, formatRateDate } from "../services/formulas";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

export function renderSums(ctx: SettingsContext): void {
  const strings = t().sums;
  new Setting(ctx.containerEl).setName(strings.heading).setHeading();
  ctx.containerEl.createEl("p", { cls: "setting-item-description", text: strings.intro });

  const language = obsidianLanguageTag();
  const example = (style: NumberStyle) =>
    formatAmount(1234.56, null, 2, numberFormatFor(style, language));

  new Setting(ctx.containerEl)
    .setName(strings.numberFormat)
    .setDesc(strings.numberFormatDesc)
    .addDropdown((dropdown) => {
      for (const style of NUMBER_STYLES) {
        dropdown.addOption(
          style,
          style === "auto" ? strings.automatic(example(style)) : example(style)
        );
      }
      dropdown.setValue(ctx.plugin.settings.sumsNumberStyle).onChange(async (value) => {
        await ctx.update({ sumsNumberStyle: value as NumberStyle });
      });
    });

  new Setting(ctx.containerEl)
    .setName(strings.defaultCurrency)
    .setDesc(strings.defaultCurrencyDesc)
    .addDropdown((dropdown) => {
      dropdown.addOption("", strings.noCurrency);
      for (const code of [...CURRENCY_CODES].sort()) dropdown.addOption(code, code);
      dropdown.setValue(ctx.plugin.settings.sumsDefaultCurrency).onChange(async (value) => {
        await ctx.update({ sumsDefaultCurrency: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(strings.convert)
    .setDesc(strings.convertDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.sumsConvert).onChange(async (value) => {
        await ctx.update({ sumsConvert: value });
      });
    });

  const rates = ctx.plugin.settings.sumsRates;
  const format = numberFormatFor(ctx.plugin.settings.sumsNumberStyle, language);
  new Setting(ctx.containerEl)
    .setName(strings.rates)
    .setDesc(rates ? strings.ratesOf(formatRateDate(rates.date, format)) : strings.noRates)
    .addButton((button) =>
      button.setButtonText(strings.updateRates).onClick(async () => {
        button.setDisabled(true);
        await ctx.plugin.updateExchangeRates();
        ctx.refresh();
      })
    );

  renderCommands(ctx, [
    t().commands.sumSelection,
    t().commands.freezeTotals,
    t().commands.updateRates
  ]);
}
