/**
 * The shared model, and the features that use it on their own: picture
 * descriptions, renaming a file from its content, and summarizing a selection.
 * The model is its own block, before every feature that needs it.
 */
import { SecretComponent, Setting } from "obsidian";
import { t } from "../i18n";
import type { LlmProvider } from "../types";
import { LLM_PROVIDER_IDS, PROVIDER_MODELS, providerLabel } from "../services/llm-providers";
import {
  MAX_FILENAME_LENGTH,
  MAX_IMAGE_PX,
  MAX_RENAME_CONTENT_CHARS,
  MAX_SUMMARY_TOKENS,
  MIN_FILENAME_LENGTH,
  MIN_IMAGE_PX,
  MIN_RENAME_CONTENT_CHARS,
  MIN_SUMMARY_TOKENS
} from "../services/plugin-settings";
import type { SettingsContext } from "./context";
import { fold, prose, section } from "./layout";

export function renderAiModel(ctx: SettingsContext): void {
  prose(ctx, t().settings.aiIntro);

  new Setting(ctx.containerEl)
    .setName(t().settings.provider)
    .setDesc(t().settings.providerDesc)
    .addDropdown((dropdown) => {
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
  new Setting(ctx.containerEl)
    .setName(t().settings.model)
    .setDesc(t().settings.modelDesc)
    .addDropdown((dropdown) => {
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
          // The note below and the switches that need a key follow it at once.
          ctx.refresh();
        })
    );

  // Without a key every AI command and menu entry is left out, so this is
  // the one place left that says they exist and how they come back.
  if (!ctx.plugin.aiReady()) {
    prose(ctx, t().settings.aiNoKey);
  }
}

/** Renaming a note or a picture from what is in it. */
export function renderRename(ctx: SettingsContext): void {
  section(ctx, {
    name: t().settings.renameHeading,
    desc: t().settings.renameIntro,
    commands: [t().commands.rename],
    ai: true,
    indexed: true
  });
  // How much is sent and how long a name may be: chosen once, if ever.
  const limits = fold(ctx, t().settings.foldLimits, t().settings.foldLimitsDesc);
  ctx = limits;

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
      text.inputEl.min = String(MIN_RENAME_CONTENT_CHARS);
      text.inputEl.max = String(MAX_RENAME_CONTENT_CHARS);
      text.inputEl.style.width = "80px";
      text.inputEl.addEventListener("blur", async () => {
        // Sent as typed and bounded where the bound lives, then shown back:
        // a field that quietly kept an impossible number was the only place
        // that said what the setting was.
        await ctx.update({ renameMinContentChars: Number(text.inputEl.value) });
        text.setValue(String(ctx.plugin.settings.renameMinContentChars));
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.renameMaxChars)
    .setDesc(t().settings.renameMaxCharsDesc)
    .addText((text) => {
      text.setValue(String(ctx.plugin.settings.renameMaxContentChars));
      text.inputEl.type = "number";
      text.inputEl.min = String(MIN_RENAME_CONTENT_CHARS);
      text.inputEl.max = String(MAX_RENAME_CONTENT_CHARS);
      text.inputEl.style.width = "80px";
      text.inputEl.addEventListener("blur", async () => {
        await ctx.update({ renameMaxContentChars: Number(text.inputEl.value) });
        text.setValue(String(ctx.plugin.settings.renameMaxContentChars));
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.renameMaxFilename)
    .setDesc(t().settings.renameMaxFilenameDesc)
    .addText((text) => {
      text.setValue(String(ctx.plugin.settings.renameMaxFilenameLength));
      text.inputEl.type = "number";
      text.inputEl.min = String(MIN_FILENAME_LENGTH);
      text.inputEl.max = String(MAX_FILENAME_LENGTH);
      text.inputEl.style.width = "80px";
      text.inputEl.addEventListener("blur", async () => {
        await ctx.update({ renameMaxFilenameLength: Number(text.inputEl.value) });
        text.setValue(String(ctx.plugin.settings.renameMaxFilenameLength));
      });
    });
}

/** Summarizing a selection into the note. */
export function renderSummarize(ctx: SettingsContext): void {
  section(ctx, {
    name: t().settings.summarizeHeading,
    desc: t().settings.summarizeIntro,
    commands: [t().commands.summarize],
    ai: true,
    indexed: true
  });

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
}

/** Picture descriptions: the switch, where the notes go, their language and tags. */
export function renderDescriptions(ctx: SettingsContext): void {
  const labels = t().settings;
  section(ctx, {
    name: labels.describeHeading,
    desc: labels.describeIntro,
    ai: true,
    indexed: true
  });

  const ai = ctx.plugin.aiReady();
  new Setting(ctx.containerEl)
    .setName(labels.describeEnabled)
    .setDesc(ai ? labels.describeEnabledDesc : labels.needsAiKey)
    .addToggle((toggle) =>
      toggle
        .setDisabled(!ai)
        .setValue(ctx.plugin.settings.imageDescriptionsEnabled)
        .onChange(async (value) => {
          await ctx.update({ imageDescriptionsEnabled: value });
          // Switched off, the section is its switch; the rest follows it.
          ctx.refresh();
        })
    );

  if (!ai || !ctx.plugin.settings.imageDescriptionsEnabled) return;

  new Setting(ctx.containerEl)
    .setName(labels.describeFolder)
    .setDesc(labels.describeFolderDesc)
    .addText((text) => {
      text.setValue(ctx.plugin.settings.imageDescriptionFolder);
      text.inputEl.addEventListener("blur", async () => {
        await ctx.update({ imageDescriptionFolder: text.inputEl.value });
        text.setValue(ctx.plugin.settings.imageDescriptionFolder);
      });
    });

  new Setting(ctx.containerEl)
    .setName(labels.describeLanguage)
    .setDesc(labels.describeLanguageDesc)
    .addDropdown((dropdown) => {
      dropdown
        .addOption("auto", labels.describeLanguageAuto)
        .addOption("de", "Deutsch")
        .addOption("en", "English")
        .setValue(ctx.plugin.settings.imageDescriptionLanguage)
        .onChange(async (value) => {
          await ctx.update({ imageDescriptionLanguage: value as "auto" | "de" | "en" });
        });
    });

  new Setting(ctx.containerEl)
    .setName(labels.describeTags)
    .setDesc(labels.describeTagsDesc)
    .addToggle((toggle) =>
      toggle
        .setValue(ctx.plugin.settings.imageDescriptionKeywordsAsTags)
        .onChange(async (value) => {
          await ctx.update({ imageDescriptionKeywordsAsTags: value });
        })
    );
}
