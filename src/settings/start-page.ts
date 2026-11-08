/**
 * The start page: which file an empty tab opens, and a way to make that file
 * when it is not there yet.
 *
 * The page itself is arranged in the note, not here. The settings name the
 * file because every device should start on the same page, and a file named
 * in the synced data file is that.
 */
import { Notice, Setting, TFile } from "obsidian";
import { t } from "../i18n";
import type { SettingsContext } from "./context";
import { section } from "./layout";

export function renderStartPage(ctx: SettingsContext): void {
  const words = t().startPage;
  section(ctx, {
    name: words.heading,
    desc: words.intro,
    commands: [t().commands.openStartPage],
    indexed: true
  });

  // Saved when the field is left rather than on every key: a half-typed path
  // is a file that is not there, and the row below would flicker for it.
  new Setting(ctx.containerEl)
    .setName(words.file)
    .setDesc(words.fileDesc)
    .addText((text) => {
      text.setPlaceholder(`${words.heading}.md`).setValue(ctx.plugin.settings.startPageFile);
      text.inputEl.addEventListener("change", async () => {
        await ctx.update({ startPageFile: text.inputEl.value });
        ctx.refresh();
      });
    });

  const path = ctx.plugin.settings.startPageFile;
  if (path === "" || ctx.app.vault.getAbstractFileByPath(path) instanceof TFile) return;

  new Setting(ctx.containerEl)
    .setName(words.missing(path))
    .setDesc(words.createDesc(path))
    .addButton((button) => {
      button
        .setButtonText(words.create)
        .setCta()
        .onClick(async () => {
          const created = await ctx.plugin.startPage?.create();
          if (!created) return;
          if (created !== path) await ctx.update({ startPageFile: created });
          new Notice(t().common.notice(words.created(created)));
          ctx.refresh();
        });
    });
}
