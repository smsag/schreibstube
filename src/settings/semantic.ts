/**
 * Search by meaning: the switch, how far it reaches, and where it stands.
 *
 * The status line is the part a person needs most. A first build takes
 * minutes and a phone may refuse the model, and without a line that says so
 * the feature just looks broken.
 */
import { Setting } from "obsidian";
import { t } from "../i18n";
import { MAX_SEMANTIC_NOTES, MIN_SEMANTIC_NOTES } from "../services/plugin-settings";
import { semanticStatusText } from "../services/semantic/status-text";
import type { SettingsContext } from "./context";

export function renderSemantic(ctx: SettingsContext): void {
  const strings = t().semantic;
  const engine = ctx.plugin.semantic;
  new Setting(ctx.containerEl).setName(strings.heading).setHeading();

  ctx.containerEl.createEl("p", { text: strings.intro, cls: "setting-item-description" });

  new Setting(ctx.containerEl)
    .setName(strings.enabled)
    .setDesc(strings.enabledDesc(engine?.downloadMb() ?? 0))
    .addToggle((toggle) => {
      toggle.setValue(ctx.plugin.settings.semanticSearchEnabled).onChange(async (value) => {
        await ctx.update({ semanticSearchEnabled: value });
        engine?.settingsChanged();
        ctx.refresh();
      });
    });

  if (!ctx.plugin.settings.semanticSearchEnabled || !engine) return;

  new Setting(ctx.containerEl)
    .setName(strings.maxNotes)
    .setDesc(strings.maxNotesDesc(MIN_SEMANTIC_NOTES, MAX_SEMANTIC_NOTES))
    .addText((text) => {
      text.setValue(String(ctx.plugin.settings.semanticMaxNotes));
      text.inputEl.type = "number";
      text.inputEl.min = String(MIN_SEMANTIC_NOTES);
      text.inputEl.max = String(MAX_SEMANTIC_NOTES);
      text.inputEl.style.width = "80px";
      text.inputEl.addEventListener("blur", async () => {
        await ctx.update({ semanticMaxNotes: Number(text.inputEl.value) });
        text.setValue(String(ctx.plugin.settings.semanticMaxNotes));
        engine.settingsChanged();
      });
    });

  const status = new Setting(ctx.containerEl).setName(strings.status).addButton((button) => {
    button.setButtonText(strings.buildNow).onClick(() => engine.buildNow());
  });
  const draw = async (): Promise<void> => {
    status.setDesc(semanticStatusText(await engine.status(), strings.state));
  };
  void draw();
  // The tab is redrawn from scratch, so each drawing listens only until the next.
  const off = engine.onChange(() => {
    if (!status.settingEl.isConnected) {
      off();
      return;
    }
    void draw();
  });

  new Setting(ctx.containerEl)
    .setName(strings.rebuild)
    .setDesc(strings.rebuildDesc)
    .addButton((button) => {
      button
        .setButtonText(strings.rebuild)
        .setWarning()
        .onClick(() => engine.rebuild());
    });
}
