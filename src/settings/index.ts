import { App, PluginSettingTab } from "obsidian";
import { t } from "../i18n";
import type SchreibstubePlugin from "../main";
import { createContext } from "./context";
import { block, renderIndex } from "./layout";
import { renderHelpers } from "./editor";
import { renderSums } from "./sums";
import { renderExplorer } from "./explorer";
import { renderSemantic } from "./semantic";
import { renderAiModel, renderDescriptions, renderRename, renderSummarize } from "./ai";
import { renderProofreading } from "./proofreading";
import { renderSync } from "./sync";
import { renderMail } from "./mail";
import { renderPublish } from "./publish";
import { renderPrint } from "./print";
import { renderDiagnostics } from "./diagnostics";

/**
 * The settings tab: one module per area, in three blocks — the small helpers
 * first, then the AI model the features below may need, then the large
 * features — with a line at the top that jumps to any of them.
 *
 * It was a single 900-line class that every feature appended to, which made
 * "where does this setting live" a question about line numbers. Each section is
 * now a function of a context, so a new capability adds a file.
 */
export class SchreibstubeSettingTab extends PluginSettingTab {
  plugin: SchreibstubePlugin;

  constructor(app: App, plugin: SchreibstubePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("schreibstube-settings");
    const indexEl = containerEl.createDiv({ cls: "schreibstube-settings-index" });

    const ctx = createContext(this.app, this.plugin, containerEl, () => this.display());
    const blocks = t().settings.blocks;

    block(ctx, "helpers", blocks.helpers);
    renderHelpers(ctx);
    renderSums(ctx);

    block(ctx, "ai-model", blocks.aiModel);
    renderAiModel(ctx);

    block(ctx, "features", blocks.features);
    renderExplorer(ctx);
    renderSemantic(ctx);
    renderDescriptions(ctx);
    renderRename(ctx);
    renderSummarize(ctx);
    renderProofreading(ctx);
    renderSync(ctx);
    renderMail(ctx);
    renderPublish(ctx);
    renderPrint(ctx);

    block(ctx, "about", blocks.about);
    renderDiagnostics(ctx);

    renderIndex(indexEl, ctx.index);
  }
}
