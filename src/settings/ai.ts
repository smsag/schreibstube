/**
 * The shared model configuration, and the two commands that use it on their own: renaming a file from its content, and summarizing a selection.
 */
import { SecretComponent, Setting } from "obsidian";
import { t } from "../i18n";
import type { LlmProvider } from "../types";
import { LLM_PROVIDER_IDS, PROVIDER_MODELS, providerLabel } from "../services/llm-providers";
import {
  MAX_IMAGE_PX,
  MAX_SUMMARY_TOKENS,
  MIN_IMAGE_PX,
  MIN_SUMMARY_TOKENS
} from "../services/plugin-settings";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

export function renderAi(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().settings.aiHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().settings.aiIntro);

  new Setting(ctx.containerEl).setName(t().settings.provider).addDropdown((dropdown) => {
    LLM_PROVIDER_IDS.forEach((id) => dropdown.addOption(id, providerLabel(id)));
    dropdown.setValue(ctx.plugin.settings.llmProvider).onChange(async (value) => {
      const provider = value as LlmProvider;
      await ctx.update({
        llmProvider: provider,
        llmModel: PROVIDER_MODELS[provider][0].value,
        llmModelCustom: ""
      });
      ctx.refresh();
    });
  });

  const models = PROVIDER_MODELS[ctx.plugin.settings.llmProvider];
  new Setting(ctx.containerEl).setName(t().settings.model).addDropdown((dropdown) => {
    models.forEach((m) => dropdown.addOption(m.value, m.label));
    dropdown.setValue(ctx.plugin.settings.llmModel).onChange(async (value) => {
      await ctx.update({ llmModel: value, llmModelCustom: "" });
      ctx.refresh();
    });
  });

  new Setting(ctx.containerEl)
    .setName(t().settings.customModel)
    .setDesc(t().settings.customModelDesc)
    .addText((text) => {
      text.setPlaceholder(t().settings.customModelPlaceholder);
      text.setValue(ctx.plugin.settings.llmModelCustom);
      text.onChange(async (value) => {
        await ctx.update({ llmModelCustom: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.apiKey)
    .setDesc(t().settings.apiKeyDesc)
    .addComponent((el) =>
      new SecretComponent(ctx.app, el)
        .setValue(ctx.plugin.settings.llmSecretName)
        .onChange(async (value) => {
          await ctx.update({ llmSecretName: value });
        })
    );

  new Setting(ctx.containerEl).setName(t().settings.renameHeading).setHeading();

  new Setting(ctx.containerEl)
    .setName(t().settings.renameImageSize)
    .setDesc(t().settings.renameImageSizeDesc)
    .addSlider((slider) => {
      slider
        .setDynamicTooltip()
        .setLimits(MIN_IMAGE_PX, MAX_IMAGE_PX, 128)
        .setValue(ctx.plugin.settings.renameMaxImagePx)
        .onChange(async (value) => {
          await ctx.update({ renameMaxImagePx: value });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.renameMinChars)
    .setDesc(t().settings.renameMinCharsDesc)
    .addText((text) => {
      text.setValue(String(ctx.plugin.settings.renameMinContentChars));
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.style.width = "80px";
      text.inputEl.addEventListener("blur", async () => {
        const n = parseInt(text.inputEl.value, 10);
        if (Number.isInteger(n) && n > 0) {
          await ctx.update({ renameMinContentChars: n });
        }
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.renameMaxChars)
    .setDesc(t().settings.renameMaxCharsDesc)
    .addText((text) => {
      text.setValue(String(ctx.plugin.settings.renameMaxContentChars));
      text.inputEl.type = "number";
      text.inputEl.min = "100";
      text.inputEl.style.width = "80px";
      text.inputEl.addEventListener("blur", async () => {
        const n = parseInt(text.inputEl.value, 10);
        if (Number.isInteger(n) && n > 0) {
          await ctx.update({ renameMaxContentChars: n });
        }
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.renameMaxFilename)
    .setDesc(t().settings.renameMaxFilenameDesc)
    .addText((text) => {
      text.setValue(String(ctx.plugin.settings.renameMaxFilenameLength));
      text.inputEl.type = "number";
      text.inputEl.min = "10";
      text.inputEl.max = "255";
      text.inputEl.style.width = "80px";
      text.inputEl.addEventListener("blur", async () => {
        const n = parseInt(text.inputEl.value, 10);
        if (Number.isInteger(n) && n > 0) {
          await ctx.update({ renameMaxFilenameLength: n });
        }
      });
    });

  new Setting(ctx.containerEl).setName(t().settings.summarizeHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().settings.summarizeIntro);

  new Setting(ctx.containerEl)
    .setName(t().settings.summarizePrompt)
    .setDesc(t().settings.summarizePromptDesc)
    .addTextArea((text) => {
      text.inputEl.rows = 6;
      text.inputEl.style.width = "100%";
      text.setValue(ctx.plugin.settings.summarizePrompt);
      text.inputEl.addEventListener("blur", async () => {
        await ctx.update({ summarizePrompt: text.inputEl.value });
        text.setValue(ctx.plugin.settings.summarizePrompt);
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.summarizeTokens)
    .setDesc(t().settings.summarizeTokensDesc(MIN_SUMMARY_TOKENS, MAX_SUMMARY_TOKENS))
    .addText((text) => {
      text.setValue(String(ctx.plugin.settings.summarizeMaxTokens));
      text.inputEl.type = "number";
      text.inputEl.min = String(MIN_SUMMARY_TOKENS);
      text.inputEl.max = String(MAX_SUMMARY_TOKENS);
      text.inputEl.style.width = "80px";
      text.inputEl.addEventListener("blur", async () => {
        const n = parseInt(text.inputEl.value, 10);
        if (Number.isInteger(n)) {
          await ctx.update({ summarizeMaxTokens: n });
          text.setValue(String(ctx.plugin.settings.summarizeMaxTokens));
        }
      });
    });

  renderCommands(ctx, [t().commands.renameFile, t().commands.renameImage, t().commands.summarize]);
}
