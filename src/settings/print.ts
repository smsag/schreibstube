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
        // Switching it on fetches the typesetter, because that is what the
        // description above promises and what somebody deliberately doing this
        // on wifi is asking for. Switching it off leaves the files alone: the
        // row below offers to remove them, and throwing away 28 MB that might
        // be wanted tomorrow is not a decision a toggle should make.
        if (value) await ctx.plugin.downloadPrintRuntime();
        // The switch adds and removes controls below it, so the tab is redrawn
        // rather than left showing settings for something that is now off.
        ctx.refresh();
      });
    });

  // Shown whether or not printing is on, because somebody who switched it off
  // still has 28 MB in their vault folder and this is the only way to see it.
  // The row takes itself away when there is nothing on the device to talk about.
  renderRuntime(ctx);

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

  const draw = (installed: boolean): void => {
    // Nothing on the device and printing switched off: there is no sentence
    // worth writing here, so the row removes itself rather than sit empty.
    if (!installed && !ctx.plugin.settings.printEnabled) {
      row.settingEl.remove();
      return;
    }

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
  };

  // A question that could not be answered is answered as "not here": the button
  // it draws then fetches, which is the right move either way and beats a row
  // that says something and offers nothing.
  void ctx.plugin
    .printRuntimeInstalled()
    .then(draw)
    .catch(() => {
      draw(false);
    });
}
