/**
 * The file pane: one decision worth exposing, and one fact worth stating.
 *
 * The decision is what happens to the menu items other plugins contribute. The
 * fact is which icon set is bundled, because a person choosing an icon should
 * know what they are searching through.
 */
import { Notice, Setting } from "obsidian";
import { t } from "../i18n";
import { DueMigration } from "../controllers/due-migration";
import { BOOKMARK_FILE_DEFAULT } from "../services/bookmark-file";
import { DUE_KEY, MAX_DUE_SYNONYMS, normalizeDueSynonyms } from "../services/due-date";
import { createLogger } from "../services/logger";
import { MAX_RECOMMENDED, MIN_RECOMMENDED } from "../services/plugin-settings";
import { ICON_FONT_VERSION, allIconNames } from "../ui/icon-font";
import type { ExplorerForeignMenu } from "../types";
import type { SettingsContext } from "./context";
import { section } from "./layout";

export function renderExplorer(ctx: SettingsContext): void {
  section(ctx, {
    name: t().settings.explorerHeading,
    desc: t().settings.explorerIntro,
    commands: [
      t().commands.openExplorer,
      t().commands.collapseExplorer,
      t().commands.focusExplorerFilter,
      t().commands.openBookmark,
      t().commands.pinTag
    ],
    indexed: true
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
    .setName(t().settings.explorerDueDates)
    .setDesc(t().settings.explorerDueDatesDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.explorerDueDates).onChange(async (value) => {
        await ctx.update({ explorerDueDates: value });
      });
    });

  renderDueKeys(ctx);

  new Setting(ctx.containerEl)
    .setName(t().settings.explorerShowExtensions)
    .setDesc(t().settings.explorerShowExtensionsDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.explorerShowExtensions).onChange(async (value) => {
        await ctx.update({ explorerShowExtensions: value });
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
    .setName(t().settings.recommendedCount)
    .setDesc(t().settings.recommendedCountDesc(MIN_RECOMMENDED, MAX_RECOMMENDED))
    .addText((text) => {
      text.setValue(String(ctx.plugin.settings.recommendedCount));
      text.inputEl.type = "number";
      text.inputEl.min = String(MIN_RECOMMENDED);
      text.inputEl.max = String(MAX_RECOMMENDED);
      text.inputEl.style.width = "60px";
      text.inputEl.addEventListener("blur", async () => {
        await ctx.update({ recommendedCount: Number(text.inputEl.value) });
        text.setValue(String(ctx.plugin.settings.recommendedCount));
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.explorerIcons)
    .setDesc(t().settings.explorerIconsDesc(allIconNames().length, ICON_FONT_VERSION));
}

/**
 * Which property says when a note is due. Both fields are saved when they lose
 * focus rather than on every key: a half-typed name would be a property no
 * note has, and the count below is redrawn for the name as finally typed.
 */
function renderDueKeys(ctx: SettingsContext): void {
  const words = t().settings;
  new Setting(ctx.containerEl)
    .setName(words.dueProperty)
    .setDesc(words.duePropertyDesc(DUE_KEY))
    .addText((text) => {
      text.setPlaceholder(DUE_KEY).setValue(ctx.plugin.settings.dueProperty);
      text.inputEl.addEventListener("change", async () => {
        await ctx.update({ dueProperty: text.inputEl.value });
        ctx.refresh();
      });
    });

  new Setting(ctx.containerEl)
    .setName(words.dueSynonyms)
    .setDesc(words.dueSynonymsDesc(MAX_DUE_SYNONYMS))
    .addTextArea((text) => {
      text.inputEl.rows = 3;
      text.setValue(ctx.plugin.settings.dueSynonyms.join("\n"));
      text.inputEl.addEventListener("change", async () => {
        const typed = normalizeDueSynonyms(text.inputEl.value, ctx.plugin.settings.dueProperty);
        await ctx.update({ dueSynonyms: typed });
        text.setValue(ctx.plugin.settings.dueSynonyms.join("\n"));
      });
    });

  const property = ctx.plugin.settings.dueProperty;
  if (property === DUE_KEY) return;
  const migration = new DueMigration(
    ctx.app,
    () => ctx.plugin.settings.dueProperty,
    createLogger(() => ctx.plugin.settings.debugLogging)
  );
  const tally = migration.count();
  const movable = tally.move + tally.drop;
  if (movable + tally.conflict === 0) return;

  const row = new Setting(ctx.containerEl)
    .setName(words.dueMoveName(DUE_KEY))
    .setDesc(
      words.dueMoveDesc(DUE_KEY, property, movable, tally.conflict) +
        (tally.conflicts.length > 0 ? " " + words.dueMoveConflicts(tally.conflicts) : "")
    );
  if (movable === 0) return;
  row.addButton((button) =>
    button.setButtonText(words.dueMoveButton(property)).onClick(async () => {
      button.setDisabled(true);
      const result = await migration.run();
      new Notice(
        t().common.notice(
          words.dueMoved(result.tally.move + result.tally.drop, property, result.failed)
        )
      );
      ctx.refresh();
    })
  );
}
