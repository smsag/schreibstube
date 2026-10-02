/**
 * The small helpers: the heading stack, focus mode, the link that opens a new
 * doc from outside Obsidian, icons in the text, properties, Bases and the
 * commands that need no settings — each a short section of its own.
 */
import { Notice, Setting } from "obsidian";
import { activeLocale, t } from "../i18n";
import { MAX_DIM_OPACITY, MIN_DIM_OPACITY } from "../services/focus-settings";
import { normalizeTermFolder } from "../services/glossary-term-folder";
import { createLogger } from "../services/logger";
import { newDocLink } from "../services/new-note";
import { formatDate } from "../services/today-value";
import type { SettingsContext } from "./context";
import { section } from "./layout";

export function renderHelpers(ctx: SettingsContext): void {
  const words = t().settings;
  section(ctx, { id: "overlay", name: words.overlayHeading });

  new Setting(ctx.containerEl)
    .setName(t().settings.overlayEnabled)
    .setDesc(t().settings.overlayEnabledDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.overlayEnabled).onChange(async (value) => {
        await ctx.update({ overlayEnabled: value });
        ctx.plugin.requestOverlayRefresh();
      });
    });

  section(ctx, { id: "icon-shortcodes", name: words.iconShortcodesHeading });

  new Setting(ctx.containerEl)
    .setName(t().settings.iconShortcodesEnabled)
    .setDesc(t().settings.iconShortcodesEnabledDesc)
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.iconShortcodes).onChange(async (value) => {
        await ctx.update({ iconShortcodes: value });
      });
    });

  section(ctx, {
    id: "focus",
    name: words.focusHeading,
    commands: [t().commands.focusSentence, t().commands.focusParagraph]
  });

  new Setting(ctx.containerEl)
    .setName(t().settings.focusOpacity)
    .setDesc(t().settings.focusOpacityDesc)
    .addSlider((slider) => {
      slider
        .setDynamicTooltip()
        .setLimits(MIN_DIM_OPACITY, MAX_DIM_OPACITY, 0.05)
        .setValue(ctx.plugin.settings.focusDimOpacity)
        .onChange(async (value) => {
          await ctx.plugin.updateDimOpacity(value);
        });
    });

  section(ctx, { id: "new-doc", name: words.newDocHeading, commands: [t().commands.newNote] });

  new Setting(ctx.containerEl)
    .setName(t().settings.newDocLink)
    .setDesc(t().settings.newDocLinkDesc)
    .addButton((button) =>
      button.setButtonText(t().settings.newDocLinkCopy).onClick(async () => {
        const link = newDocLink(ctx.plugin.app.vault.getName());
        try {
          await navigator.clipboard.writeText(link);
          new Notice(t().common.notice(t().common.copied));
        } catch (error) {
          // A page without clipboard access, or one that refused it: the
          // console keeps the cause and the notice says that nothing was copied.
          createLogger(() => ctx.plugin.settings.debugLogging).warn(
            `Could not copy ${link} to the clipboard:`,
            error
          );
          new Notice(t().common.notice(t().explorer.bookmarks.copyFailed));
        }
      })
    );

  renderProperties(ctx);

  // No switch here: which bases open their notes for reading is each base's
  // own to say, in its file, and a switch for all of them was the wrong place.
  section(ctx, {
    id: "bases",
    name: words.basesHeading,
    desc: words.basesReadingViewDesc,
    commands: [t().commands.baseReadingView]
  });

  section(ctx, {
    id: "more-commands",
    name: words.moreCommandsHeading,
    desc: words.moreCommandsDesc,
    commands: [
      t().commands.insertTaskSummary,
      t().commands.insertSlideshow,
      t().commands.insertPdfSummary,
      t().commands.linksSwitch
    ]
  });
}

function renderProperties(ctx: SettingsContext): void {
  section(ctx, {
    id: "properties",
    name: t().properties.heading,
    commands: [t().commands.insertToday, t().commands.suggestTags]
  });

  const example = (format: string) => formatDate(new Date(), format, activeLocale());
  const dateFormat = new Setting(ctx.containerEl)
    .setName(t().properties.dateFormat)
    .setDesc(t().properties.dateFormatDesc(example(ctx.plugin.settings.dateFormat)));
  dateFormat.addText((text) => {
    text.setValue(ctx.plugin.settings.dateFormat).onChange(async (value) => {
      await ctx.update({ dateFormat: value });
      dateFormat.setDesc(t().properties.dateFormatDesc(example(ctx.plugin.settings.dateFormat)));
    });
  });

  new Setting(ctx.containerEl)
    .setName(t().properties.setFolder)
    .setDesc(t().properties.setFolderDesc)
    .addText((text) => {
      text.setPlaceholder(t().properties.setFolderPlaceholder);
      text.setValue(ctx.plugin.settings.propertySetFolder);
      text.onChange(async (value) => {
        await ctx.update({ propertySetFolder: normalizeTermFolder(value) });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().tagSuggest.controlSetting)
    .setDesc(t().tagSuggest.controlSettingDesc)
    .addToggle((toggle) =>
      toggle.setValue(ctx.plugin.settings.tagSuggestControl).onChange(async (value) => {
        await ctx.update({ tagSuggestControl: value });
      })
    );
}
