import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type SchreibstubePlugin from "./main";
import type { LlmProvider } from "./types";
import {
  DEFAULT_PROOFREAD_PROMPT,
  MAX_CHUNK_CHARS,
  MAX_CONCURRENCY,
  MAX_IMAGE_PX,
  MAX_PROOFREAD_TOKENS,
  MAX_SUMMARY_TOKENS,
  MIN_CHUNK_CHARS,
  MIN_CONCURRENCY,
  MIN_IMAGE_PX,
  MIN_PROOFREAD_TOKENS,
  MIN_SUMMARY_TOKENS,
  normalizeSettings
} from "./services/plugin-settings";
import { GLOSSARY_CHANGED_EVENT } from "./utils/constants";
import { LLM_PROVIDER_IDS, PROVIDER_MODELS, providerLabel } from "./services/llm-providers";
import { MAX_DIM_OPACITY, MIN_DIM_OPACITY } from "./services/focus-settings";

export class SchreibstubeSettingTab extends PluginSettingTab {
  plugin: SchreibstubePlugin;

  constructor(app: App, plugin: SchreibstubePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Heading stack").setHeading();

    new Setting(containerEl)
      .setName("Enable heading stack overlay")
      .setDesc("Show the sticky ancestor-heading breadcrumb at the top of the active note.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.overlayEnabled)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              overlayEnabled: value
            });
            await this.plugin.saveSettings();
            this.plugin.requestOverlayRefresh();
          });
      });

    new Setting(containerEl).setName("Focus mode").setHeading();

    new Setting(containerEl)
      .setName("Dim opacity")
      .setDesc("Opacity of out-of-focus lines in focus mode (0.2 = very faint, 0.8 = nearly full).")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_DIM_OPACITY, MAX_DIM_OPACITY, 0.05)
          .setValue(this.plugin.settings.focusDimOpacity)
          .onChange(async (value) => {
            await this.plugin.updateDimOpacity(value);
          });
      });

    new Setting(containerEl).setName("AI models").setHeading();

    new Setting(containerEl)
      .setDesc("Provider, model, and API key shared by every AI command (rename and summarize).");

    new Setting(containerEl)
      .setName("LLM provider")
      .addDropdown((dropdown) => {
        LLM_PROVIDER_IDS.forEach((id) => dropdown.addOption(id, providerLabel(id)));
        dropdown
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (value) => {
            const provider = value as LlmProvider;
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              llmProvider: provider,
              llmModel: PROVIDER_MODELS[provider][0].value,
              llmModelCustom: "",
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    const models = PROVIDER_MODELS[this.plugin.settings.llmProvider];
    new Setting(containerEl)
      .setName("Model")
      .addDropdown((dropdown) => {
        models.forEach((m) => dropdown.addOption(m.value, m.label));
        dropdown
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              llmModel: value,
              llmModelCustom: "",
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Custom model ID")
      .setDesc("Optional. Overrides the model above — use for a newer or unlisted model.")
      .addText((text) => {
        text.setPlaceholder("e.g. claude-3-7-sonnet-latest");
        text.setValue(this.plugin.settings.llmModelCustom);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            llmModelCustom: value,
          });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Select a secret from Obsidian's secret storage, or create a new one.")
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.llmSecretName)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              llmSecretName: value,
            });
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Rename file from content").setHeading();

    new Setting(containerEl)
      .setName("Max image size")
      .setDesc("Images are resized to this maximum dimension (px) before being sent. Smaller = cheaper and faster.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_IMAGE_PX, MAX_IMAGE_PX, 128)
          .setValue(this.plugin.settings.renameMaxImagePx)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameMaxImagePx: value,
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Minimum content length")
      .setDesc(
        "The rename command does nothing if the note has fewer characters than this."
      )
      .addText((text) => {
        text.setValue(String(this.plugin.settings.renameMinContentChars));
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.style.width = "80px";
        text.inputEl.addEventListener("blur", async () => {
          const n = parseInt(text.inputEl.value, 10);
          if (Number.isInteger(n) && n > 0) {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameMinContentChars: n,
            });
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Maximum content sent to LLM")
      .setDesc("Number of characters from the beginning of the note sent to the LLM.")
      .addText((text) => {
        text.setValue(String(this.plugin.settings.renameMaxContentChars));
        text.inputEl.type = "number";
        text.inputEl.min = "100";
        text.inputEl.style.width = "80px";
        text.inputEl.addEventListener("blur", async () => {
          const n = parseInt(text.inputEl.value, 10);
          if (Number.isInteger(n) && n > 0) {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameMaxContentChars: n,
            });
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Maximum filename length")
      .setDesc("Generated filename will be truncated to this many characters.")
      .addText((text) => {
        text.setValue(String(this.plugin.settings.renameMaxFilenameLength));
        text.inputEl.type = "number";
        text.inputEl.min = "10";
        text.inputEl.max = "255";
        text.inputEl.style.width = "80px";
        text.inputEl.addEventListener("blur", async () => {
          const n = parseInt(text.inputEl.value, 10);
          if (Number.isInteger(n) && n > 0) {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameMaxFilenameLength: n,
            });
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl).setName("Summarize selection").setHeading();

    new Setting(containerEl)
      .setDesc(
        "The Summarize selection command sends the selected text to the LLM and replaces it with the result. It uses the shared AI model configured above."
      );

    new Setting(containerEl)
      .setName("Summarize prompt")
      .setDesc("System instruction that tells the LLM how to summarize the selection. Leave blank to restore the default.")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.inputEl.style.width = "100%";
        text.setValue(this.plugin.settings.summarizePrompt);
        text.inputEl.addEventListener("blur", async () => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            summarizePrompt: text.inputEl.value,
          });
          await this.plugin.saveSettings();
          text.setValue(this.plugin.settings.summarizePrompt);
        });
      });

    new Setting(containerEl)
      .setName("Maximum response tokens")
      .setDesc(`Upper bound on the length of the generated summary (${MIN_SUMMARY_TOKENS}–${MAX_SUMMARY_TOKENS}).`)
      .addText((text) => {
        text.setValue(String(this.plugin.settings.summarizeMaxTokens));
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_SUMMARY_TOKENS);
        text.inputEl.max = String(MAX_SUMMARY_TOKENS);
        text.inputEl.style.width = "80px";
        text.inputEl.addEventListener("blur", async () => {
          const n = parseInt(text.inputEl.value, 10);
          if (Number.isInteger(n)) {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              summarizeMaxTokens: n,
            });
            await this.plugin.saveSettings();
            text.setValue(String(this.plugin.settings.summarizeMaxTokens));
          }
        });
      });

    new Setting(containerEl).setName("Proofreading").setHeading();

    new Setting(containerEl)
      .setDesc(
        "Used by the proof-read sidebar. Corrections are proposed one by one and applied only when you accept them."
      );

    new Setting(containerEl)
      .setName("Proofread prompt")
      .setDesc("System instruction for the correction pass. Leave empty to restore the default.")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text.setPlaceholder(DEFAULT_PROOFREAD_PROMPT);
        text.setValue(this.plugin.settings.proofreadPrompt);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            proofreadPrompt: value
          });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Maximum response tokens")
      .setDesc("Upper bound per request. The actual budget follows the size of each chunk.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_PROOFREAD_TOKENS, MAX_PROOFREAD_TOKENS, 256)
          .setValue(this.plugin.settings.proofreadMaxTokens)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              proofreadMaxTokens: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Characters per request")
      .setDesc("Smaller chunks show the first suggestions sooner but cost more requests.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_CHUNK_CHARS, MAX_CHUNK_CHARS, 250)
          .setValue(this.plugin.settings.proofreadChunkChars)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              proofreadChunkChars: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Parallel requests")
      .setDesc("How many chunks are in flight at once.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_CONCURRENCY, MAX_CONCURRENCY, 1)
          .setValue(this.plugin.settings.proofreadConcurrency)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              proofreadConcurrency: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Glossary").setHeading();

    new Setting(containerEl)
      .setDesc(
        "A glossary is a note with `schreibstube-glossary: true` in its frontmatter and a term table. " +
          "Glossary checks run locally and need no API key. A note's own `glossary` property beats a folder rule, " +
          "which beats the pick in the sidebar, which beats the default below."
      );

    new Setting(containerEl)
      .setName("Default glossaries")
      .setDesc("Vault paths, one per line. Used when nothing more specific applies.")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.setPlaceholder("Glossare/Haus.md");
        text.setValue(this.plugin.settings.glossaryDefault.join("\n"));
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            glossaryDefault: value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
          });
          await this.plugin.saveSettings();
          window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
        });
      });

    new Setting(containerEl)
      .setName("Folder rules")
      .setDesc("One rule per line: folder | glossary.md, other.md. The deepest matching folder wins.")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text.setPlaceholder("Kunden | Glossare/Kunden.md");
        text.setValue(this.plugin.settings.glossaryFolderRules);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            glossaryFolderRules: value
          });
          await this.plugin.saveSettings();
          window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
        });
      });

    new Setting(containerEl)
      .setName("Underline glossary hits in the editor")
      .setDesc("Marks error-severity terms as you write. Off by default to keep long notes quiet.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.glossaryLiveUnderline)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              glossaryLiveUnderline: value
            });
            await this.plugin.saveSettings();
            window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
          });
      });

    new Setting(containerEl).setName("Diagnostics").setHeading();

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Log detailed diagnostics to the developer console (Ctrl/Cmd+Shift+I). Errors are always logged; enable this to trace what the plugin is doing.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.debugLogging)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              debugLogging: value,
            });
            await this.plugin.saveSettings();
          });
      });
  }
}
