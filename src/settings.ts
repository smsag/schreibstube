import { App, PluginSettingTab, Setting } from "obsidian";
import type SchreibstubePlugin from "./main";
import {
  MAX_DIM_OPACITY,
  MIN_DIM_OPACITY,
  normalizeFocusSettings
} from "./services/focus-settings";

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
      .setName("Focus dim strength")
      .setDesc("Controls how much non-focused text is dimmed in Live Edit focus mode.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_DIM_OPACITY, MAX_DIM_OPACITY, 0.05)
          .setValue(this.plugin.settings.focusDimOpacity)
          .onChange(async (value) => {
            const normalized = normalizeFocusSettings({
              ...this.plugin.settings,
              focusDimOpacity: value
            });

            await this.plugin.updateDimOpacity(normalized.focusDimOpacity);
          });
      });
  }
}
