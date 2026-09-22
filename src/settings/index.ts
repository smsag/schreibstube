import { App, PluginSettingTab } from "obsidian";
import type SchreibstubePlugin from "../main";
import { createContext } from "./context";
import { renderEditor } from "./editor";
import { renderPlanner } from "./planner";
import { renderExplorer } from "./explorer";
import { renderAi } from "./ai";
import { renderProofreading } from "./proofreading";
import { renderSync } from "./sync";
import { renderMail } from "./mail";
import { renderPublish } from "./publish";
import { renderPrint } from "./print";
import { renderDiagnostics } from "./diagnostics";

/**
 * The settings tab: one module per area, in the order a person meets them.
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

    const ctx = createContext(this.app, this.plugin, containerEl, () => this.display());

    renderEditor(ctx);
    renderPlanner(ctx);
    renderExplorer(ctx);
    renderAi(ctx);
    renderProofreading(ctx);
    renderSync(ctx);
    renderMail(ctx);
    renderPublish(ctx);
    renderPrint(ctx);
    renderDiagnostics(ctx);
  }
}
