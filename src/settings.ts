import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type SchreibstubePlugin from "./main";
import type { LlmProvider } from "./types";
import {
  MAX_OVERLAY_VISIBLE_ROWS,
  MIN_OVERLAY_VISIBLE_ROWS,
  PROVIDER_MODELS,
  normalizeSettings
} from "./services/plugin-settings";

export class SchreibstubeSettingTab extends PluginSettingTab {
  plugin: SchreibstubePlugin;

  constructor(app: App, plugin: SchreibstubePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Max visible rows")
      .setDesc("Maximum number of rows visible in expanded sibling lists.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_OVERLAY_VISIBLE_ROWS, MAX_OVERLAY_VISIBLE_ROWS, 1)
          .setValue(this.plugin.settings.overlayMaxVisibleRows)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              overlayMaxVisibleRows: value
            });
            await this.plugin.saveSettings();
            this.plugin.requestOverlayRefresh();
          });
      });

    new Setting(containerEl).setName("Rename file from content").setHeading();

    new Setting(containerEl)
      .setName("LLM provider")
      .setDesc("Provider used to generate the filename.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("anthropic", "Anthropic")
          .addOption("openai", "OpenAI")
          .addOption("google", "Google")
          .setValue(this.plugin.settings.renameProvider)
          .onChange(async (value) => {
            const provider = value as LlmProvider;
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameProvider: provider,
              renameModel: PROVIDER_MODELS[provider][0].value,
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    const models = PROVIDER_MODELS[this.plugin.settings.renameProvider];
    new Setting(containerEl)
      .setName("Model")
      .addDropdown((dropdown) => {
        models.forEach((m) => dropdown.addOption(m.value, m.label));
        dropdown
          .setValue(this.plugin.settings.renameModel)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameModel: value,
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Select a secret from Obsidian's secret storage, or create a new one.")
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.renameSecretName)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameSecretName: value,
            });
            await this.plugin.saveSettings();
          })
      );

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
  }
}
