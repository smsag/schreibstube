/**
 * The correction pass and the glossary it is constrained by.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import {
  DEFAULT_PROOFREAD_PROMPT,
  MAX_CHUNK_CHARS,
  MAX_CONCURRENCY,
  MAX_PROOFREAD_TOKENS,
  MIN_CHUNK_CHARS,
  MIN_CONCURRENCY,
  MIN_PROOFREAD_TOKENS
} from "../services/plugin-settings";
import { GLOSSARY_CHANGED_EVENT } from "../utils/constants";
import type { SettingsContext } from "./context";

export function renderProofreading(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().settings.proofreadHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().settings.proofreadIntro);

  new Setting(ctx.containerEl)
    .setName(t().settings.proofreadPrompt)
    .setDesc(t().settings.proofreadPromptDesc)
    .addTextArea((text) => {
      text.inputEl.rows = 5;
      text.setPlaceholder(DEFAULT_PROOFREAD_PROMPT);
      text.setValue(ctx.plugin.settings.proofreadPrompt);
      text.onChange(async (value) => {
        await ctx.update({ proofreadPrompt: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.proofreadTokens)
    .setDesc(t().settings.proofreadTokensDesc)
    .addSlider((slider) => {
      slider
        .setDynamicTooltip()
        .setLimits(MIN_PROOFREAD_TOKENS, MAX_PROOFREAD_TOKENS, 256)
        .setValue(ctx.plugin.settings.proofreadMaxTokens)
        .onChange(async (value) => {
          await ctx.update({ proofreadMaxTokens: value });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.proofreadChunk)
    .setDesc(t().settings.proofreadChunkDesc)
    .addSlider((slider) => {
      slider
        .setDynamicTooltip()
        .setLimits(MIN_CHUNK_CHARS, MAX_CHUNK_CHARS, 250)
        .setValue(ctx.plugin.settings.proofreadChunkChars)
        .onChange(async (value) => {
          await ctx.update({ proofreadChunkChars: value });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.proofreadConcurrency)
    .setDesc(t().settings.proofreadConcurrencyDesc)
    .addSlider((slider) => {
      slider
        .setDynamicTooltip()
        .setLimits(MIN_CONCURRENCY, MAX_CONCURRENCY, 1)
        .setValue(ctx.plugin.settings.proofreadConcurrency)
        .onChange(async (value) => {
          await ctx.update({ proofreadConcurrency: value });
        });
    });

  new Setting(ctx.containerEl).setName(t().settings.glossaryHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().settings.glossaryIntro);

  new Setting(ctx.containerEl)
    .setName(t().settings.glossaryDefault)
    .setDesc(t().settings.glossaryDefaultDesc)
    .addTextArea((text) => {
      text.inputEl.rows = 3;
      text.setPlaceholder("Glossare/Haus.md");
      text.setValue(ctx.plugin.settings.glossaryDefault.join("\n"));
      text.onChange(async (value) => {
        await ctx.update({
          glossaryDefault: value
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
        });
        window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.glossaryRules)
    .setDesc(t().settings.glossaryRulesDesc)
    .addTextArea((text) => {
      text.inputEl.rows = 4;
      text.setPlaceholder("Kunden | Glossare/Kunden.md");
      text.setValue(ctx.plugin.settings.glossaryFolderRules);
      text.onChange(async (value) => {
        await ctx.update({ glossaryFolderRules: value });
        window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.glossaryUnderline)
    .setDesc(t().settings.glossaryUnderlineDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.glossaryLiveUnderline).onChange(async (value) => {
        await ctx.update({ glossaryLiveUnderline: value });
        window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
      });
    });
}
