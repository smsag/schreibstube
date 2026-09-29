/**
 * Search by meaning: the switch, how far it reaches, and where it stands.
 *
 * The status line is the part a person needs most. A first build takes
 * minutes and a phone may refuse the model, and without a line that says so
 * the feature just looks broken.
 */
import { Platform, Setting } from "obsidian";
import { t } from "../i18n";
import { MAX_SEMANTIC_NOTES, MIN_SEMANTIC_NOTES } from "../services/plugin-settings";
import { semanticStatusText } from "../services/semantic/status-text";
import { reportRows } from "../services/semantic/index-report";
import type { SettingsContext } from "./context";

/** How often the status line is redrawn while a build runs. */
const REPORT_EVERY_MS = 1000;
/** How often the numbers under it are, while a build runs: they read the
 *  index's coverage of every note in scope, which is not a per-note cost. */
const DETAILS_EVERY_MS = 5000;

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
  // The numbers behind the status: coverage, files, model and pace.
  const details = ctx.containerEl.createDiv({ cls: "schreibstube-semantic-report" });
  const drawDetails = async (): Promise<void> => {
    const facts = await engine.report();
    details.empty();
    if (!facts) return;
    details.createDiv({
      cls: "schreibstube-semantic-report-heading",
      text: strings.report.heading
    });
    const rows = reportRows(
      { ...facts, text: ctx.plugin.textSearchStats() },
      strings.report,
      Date.now()
    );
    for (const row of rows) {
      const line = details.createDiv({ cls: "schreibstube-semantic-report-row" });
      line.createSpan({ cls: "schreibstube-semantic-report-label", text: row.label });
      line.createSpan({ cls: "schreibstube-semantic-report-value", text: row.value });
    }
  };
  let detailsAt = 0;
  const draw = async (): Promise<void> => {
    const state = await engine.status();
    status.setDesc(semanticStatusText(state, strings.state));
    const busy = state.state === "loading" || state.state === "building";
    if (busy && Date.now() - detailsAt < DETAILS_EVERY_MS) return;
    detailsAt = Date.now();
    await drawDetails();
  };
  void draw();
  // A build emits on every note; the line is drawn at most once a second, and
  // once more when the build goes quiet.
  let last = 0;
  let trailing: number | null = null;
  // The tab is redrawn from scratch, so each drawing listens only until the
  // next; the plugin's unload releases a listener no redraw came for.
  const off = engine.onChange(() => {
    if (!status.settingEl.isConnected) {
      release();
      return;
    }
    const wait = last + REPORT_EVERY_MS - Date.now();
    if (wait <= 0) {
      last = Date.now();
      void draw();
    } else if (trailing === null) {
      trailing = window.setTimeout(() => {
        trailing = null;
        last = Date.now();
        if (status.settingEl.isConnected) void draw();
      }, wait);
    }
  });
  const release = (): void => {
    off();
    if (trailing !== null) window.clearTimeout(trailing);
    trailing = null;
  };
  ctx.plugin.register(release);

  new Setting(ctx.containerEl)
    .setName(strings.rebuild)
    .setDesc(Platform.isMobile ? strings.rebuildDescPhone : strings.rebuildDesc)
    .addButton((button) => {
      button
        .setButtonText(strings.rebuild)
        .setWarning()
        .onClick(() => engine.rebuild());
    });
}
