/**
 * The file pane: one decision worth exposing, and one fact worth stating.
 *
 * The decision is what happens to the menu items other plugins contribute. The
 * fact is which icon set is bundled, because a person choosing an icon should
 * know what they are searching through.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import { BOOKMARK_FILE_DEFAULT } from "../services/bookmark-file";
import { ICON_FONT_VERSION, allIconNames } from "../ui/icon-font";
import type { ExplorerForeignMenu } from "../types";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

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
    .setName(t().settings.explorerBookmarks)
    .setDesc(t().settings.explorerBookmarksDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.explorerBookmarksEnabled).onChange(async (value) => {
        await ctx.update({ explorerBookmarksEnabled: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.explorerBookmarksFile)
    .setDesc(t().settings.explorerBookmarksFileDesc)
    .addText((text) => {
      text
        .setPlaceholder(BOOKMARK_FILE_DEFAULT)
        .setValue(ctx.plugin.settings.explorerBookmarksFile)
        .onChange(async (value) => {
          await ctx.update({ explorerBookmarksFile: value.trim() || BOOKMARK_FILE_DEFAULT });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.explorerTaskCounts)
    .setDesc(t().settings.explorerTaskCountsDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.explorerTaskCounts).onChange(async (value) => {
        await ctx.update({ explorerTaskCounts: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.explorerDescriptionNotes)
    .setDesc(t().settings.explorerDescriptionNotesDesc)
    .addToggle((toggle) => {
      toggle
        .setValue(ctx.plugin.settings.explorerDescriptionNotes === "show")
        .onChange(async (value) => {
          await ctx.update({ explorerDescriptionNotes: value ? "show" : "hide" });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.recommendedPlacement)
    .setDesc(t().settings.recommendedPlacementDesc)
    .addDropdown((dropdown) => {
      dropdown
        .addOption("sidebar", t().settings.recommendedSidebar)
        .addOption("footer", t().settings.recommendedFooter)
        .setValue(ctx.plugin.settings.recommendedPlacement)
        .onChange(async (value) => {
          await ctx.update({ recommendedPlacement: value === "footer" ? "footer" : "sidebar" });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.explorerIcons)
    .setDesc(t().settings.explorerIconsDesc(allIconNames().length, ICON_FONT_VERSION));

  renderCommands(ctx, [
    t().commands.openExplorer,
    t().commands.collapseExplorer,
    t().commands.openBookmark,
    t().commands.pinTag
  ]);
}
