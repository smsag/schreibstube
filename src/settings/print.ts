/**
 * Printing: where templates live, and where a PDF lands.
 *
 * Deliberately two settings. Everything else about a printed page — paper,
 * margins, fonts, what the sender's name is — belongs to a template, which is
 * a folder in the vault a person can open and change. A setting for any of it
 * here would be a second place to look.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import { TEMPLATE_ROOT_DEFAULT } from "../services/print-template";
import { TYPST_VERSION } from "../services/typst-runtime";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

export function renderPrint(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().settings.printHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().settings.printIntro(TYPST_VERSION));

  new Setting(ctx.containerEl)
    .setName(t().settings.printTemplateRoot)
    .setDesc(t().settings.printTemplateRootDesc)
    .addText((text) => {
      text
        .setPlaceholder(TEMPLATE_ROOT_DEFAULT)
        .setValue(ctx.plugin.settings.printTemplateRoot)
        .onChange(async (value) => {
          await ctx.update({ printTemplateRoot: value });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().settings.printOutputFolder)
    .setDesc(t().settings.printOutputFolderDesc)
    .addText((text) => {
      text
        .setPlaceholder(t().settings.printOutputBesideNote)
        .setValue(ctx.plugin.settings.printOutputFolder)
        .onChange(async (value) => {
          await ctx.update({ printOutputFolder: value });
        });
    });

  renderCommands(ctx, [t().commands.print]);
}
