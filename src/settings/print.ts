/**
 * Printing: whether it is on, where templates live, and where a PDF lands.
 *
 * Deliberately few settings. Everything else about a printed page — paper,
 * margins, fonts, what the sender's name is — belongs to a template, which is
 * a folder in the vault a person can open and change. A setting for any of it
 * here would be a second place to look.
 *
 * The switch comes first and hides the rest, because until it is thrown there
 * is nothing to configure: no typesetter on the device, and no print to aim
 * anywhere. Showing a folder field above a feature that is off invites somebody
 * to set it and wonder why nothing happens.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import { TEMPLATE_ROOT_DEFAULT } from "../services/print-template";
import { RUNTIME_MEGABYTES, TYPST_VERSION } from "../services/typst-runtime";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

export function renderPrint(ctx: SettingsContext): void {
  const strings = t().settings;
  new Setting(ctx.containerEl).setName(strings.printHeading).setHeading();

  new Setting(ctx.containerEl).setDesc(strings.printIntro(TYPST_VERSION));

  new Setting(ctx.containerEl)
    .setName(strings.printEnabled)
    .setDesc(strings.printEnabledDesc(RUNTIME_MEGABYTES))
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.printEnabled).onChange(async (value) => {
        await ctx.update({ printEnabled: value });
        // The switch adds and removes controls below it, so the tab is redrawn
        // rather than left showing settings for something that is now off.
        ctx.refresh();
      });
    });

  if (!ctx.plugin.settings.printEnabled) return;

  new Setting(ctx.containerEl)
    .setName(strings.printTemplateRoot)
    .setDesc(strings.printTemplateRootDesc)
    .addText((text) => {
      text
        .setPlaceholder(TEMPLATE_ROOT_DEFAULT)
        .setValue(ctx.plugin.settings.printTemplateRoot)
        .onChange(async (value) => {
          await ctx.update({ printTemplateRoot: value });
        });
    });

  new Setting(ctx.containerEl)
    .setName(strings.printOutputFolder)
    .setDesc(strings.printOutputFolderDesc)
    .addText((text) => {
      text
        .setPlaceholder(strings.printOutputBesideNote)
        .setValue(ctx.plugin.settings.printOutputFolder)
        .onChange(async (value) => {
          await ctx.update({ printOutputFolder: value });
        });
    });

  renderRuntime(ctx);

  new Setting(ctx.containerEl).setDesc(strings.printAddTemplateDesc);

  renderCommands(ctx, [t().commands.print, t().commands.addPrintTemplate]);
}

/**
 * Whether the typesetter is on this device, and the one button that changes it.
 *
 * Asked rather than assumed: the files sit in a folder a person can open, and
 * a vault synced from another machine may or may not have brought them. The
 * answer arrives after the tab has drawn, so the row is written twice — once
 * saying nothing, once saying what is true.
 */
function renderRuntime(ctx: SettingsContext): void {
  const strings = t().settings;
  const row = new Setting(ctx.containerEl).setName(strings.printRuntimeHeading);

  void ctx.plugin
    .printRuntimeInstalled()
    .then((installed) => {
      row.setDesc(
        installed
          ? strings.printRuntimeInstalled(RUNTIME_MEGABYTES)
          : strings.printRuntimeMissing(RUNTIME_MEGABYTES)
      );
      row.addButton((button) =>
        button
          .setButtonText(installed ? strings.printRemoveRuntime : strings.printDownloadNow)
          .onClick(async () => {
            button.setDisabled(true);
            if (installed) await ctx.plugin.removePrintRuntime();
            else await ctx.plugin.downloadPrintRuntime();
            ctx.refresh();
          })
      );
    })
    .catch(() => {
      row.setDesc(strings.printRuntimeMissing(RUNTIME_MEGABYTES));
    });
}
