import { MarkdownView, type Plugin } from "obsidian";
import { t } from "../i18n";
import { noteFooterHost } from "../services/workspace-internals";
import { RecommendedPanel, type RecommendedHost } from "../ui/recommended-panel";

interface Footer {
  el: HTMLElement;
  panel: RecommendedPanel;
  path: string | null;
}

/**
 * The Recommended panel under the note instead of in the sidebar (S1, a
 * setting). Wiring only: the panel is the sidebar's, drawn at the end of each
 * open note's scrolling content, so it is read where the note ends. Switched
 * back to the sidebar, every footer goes.
 */
export class RecommendedFooter {
  private readonly footers = new Map<MarkdownView, Footer>();

  constructor(
    private readonly plugin: Plugin,
    private readonly host: () => RecommendedHost | null,
    private readonly placement: () => "sidebar" | "footer"
  ) {}

  start(): void {
    const { workspace, metadataCache } = this.plugin.app;
    this.plugin.registerEvent(workspace.on("layout-change", () => this.sync()));
    this.plugin.registerEvent(workspace.on("active-leaf-change", () => this.sync()));
    this.plugin.registerEvent(workspace.on("file-open", () => this.sync()));
    // A link written or a tag added changes the cards; the panel itself decides
    // how often that is worth asking meaning again.
    this.plugin.registerEvent(
      metadataCache.on("changed", (file) => {
        for (const footer of this.footers.values()) {
          if (footer.path === file.path) footer.panel.refresh();
        }
      })
    );
    workspace.onLayoutReady(() => this.sync());
    this.plugin.register(() => this.clear());
  }

  /** Bring every open note's footer in line with the setting and its file. */
  sync(): void {
    const host = this.host();
    const on = this.placement() === "footer" && host !== null;
    const views = new Set<MarkdownView>();
    if (on) {
      for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file) views.add(view);
      }
    }
    for (const [view, footer] of this.footers) {
      if (!views.has(view)) {
        footer.el.remove();
        this.footers.delete(view);
      }
    }
    if (!on || !host) return;

    for (const view of views) {
      const target = noteFooterHost(view.contentEl, view.getMode() === "preview");
      if (!target) continue;
      let footer = this.footers.get(view);
      if (!footer || footer.el.parentElement !== target) {
        footer?.el.remove();
        const el = target.createDiv({ cls: "schreibstube-recommended-footer" });
        // Inside the editor's content: a press here must not place the cursor.
        el.setAttr("contenteditable", "false");
        el.createDiv({ cls: "schreibstube-related-section", text: t().explorer.related.viewTitle });
        const panel = new RecommendedPanel(el.createDiv(), host, { heading: false });
        footer = { el, panel, path: null };
        this.footers.set(view, footer);
      }
      const path = view.file?.path ?? null;
      if (footer.path !== path) {
        footer.path = path;
        footer.panel.show(path);
      }
    }
  }

  private clear(): void {
    for (const footer of this.footers.values()) footer.el.remove();
    this.footers.clear();
  }
}
