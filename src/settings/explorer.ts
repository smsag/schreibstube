/**
 * The file pane: one decision worth exposing, and one fact worth stating.
 *
 * The decision is what happens to the menu items other plugins contribute. The
 * fact is which icon set is bundled, because a person choosing an icon should
 * know what they are searching through.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import { ICON_FONT_VERSION, allIconNames } from "../ui/icon-font";
import type { ExplorerForeignMenu } from "../types";
import type { SettingsContext } from "./context";

export function renderExplorer(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().settings.explorerHeading).setHeading();

  ctx.containerEl.createEl("p", {
    text: t().settings.explorerIntro,
    cls: "setting-item-description"
  });

  new Setting(ctx.containerEl)
    .setName(t().settings.explorerForeign)
    .setDesc(t().settings.explorerForeignDesc)
    .addDropdown((dropdown) => {
      dropdown
        .addOption("submenu", t().settings.explorerForeignSubmenu)
        .addOption("inline", t().settings.explorerForeignInline)
        .addOption("off", t().settings.explorerForeignOff)
        .setValue(ctx.plugin.settings.explorerForeignMenu)
        .onChange(async (value) => {
          await ctx.update({ explorerForeignMenu: value as ExplorerForeignMenu });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.explorerIcons)
    .setDesc(t().settings.explorerIconsDesc(allIconNames().length, ICON_FONT_VERSION));
}
