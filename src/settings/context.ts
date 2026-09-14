import type { App } from "obsidian";
import type SchreibstubePlugin from "../main";
import type { SchreibstubeSettings } from "../types";
import { normalizeSettings } from "../services/plugin-settings";

/**
 * What every settings section needs, and the one way it changes a setting.
 *
 * Each control used to repeat the same five lines: spread the settings,
 * normalise, assign, save. That is the sort of repetition a reader stops
 * seeing, and it hid which key a block actually changed.
 */
export interface SettingsContext {
  app: App;
  plugin: SchreibstubePlugin;
  containerEl: HTMLElement;
  /** Apply a change, validated the same way a loaded file is, and persist it. */
  update(patch: Partial<SchreibstubeSettings>): Promise<void>;
  /** Redraw the whole tab, for a change that adds or removes controls. */
  refresh(): void;
}

export function createContext(
  app: App,
  plugin: SchreibstubePlugin,
  containerEl: HTMLElement,
  refresh: () => void
): SettingsContext {
  return {
    app,
    plugin,
    containerEl,
    refresh,
    async update(patch) {
      plugin.settings = normalizeSettings({ ...plugin.settings, ...patch });
      await plugin.saveSettings();
    }
  };
}
