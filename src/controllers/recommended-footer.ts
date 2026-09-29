import { MarkdownView, type Plugin, type TFile } from "obsidian";
import { FooterHold } from "../services/footer-hold";
import {
  keepEditorTailBelow,
  noteFooterHost,
  placeAfterNote,
  watchViewMode
} from "../services/workspace-internals";
import { RecommendedPanel, type RecommendedHost } from "../ui/recommended-panel";

interface Footer {
  el: HTMLElement;
  panel: RecommendedPanel;
  path: string | null;
  /** Stops listening for the view's switch between editing and reading. */
  unwatch: () => void;
  /** While editing: the editor the end-of-note padding is kept below the footer for, and how to stop. */
  tail: { sizer: HTMLElement; stop: () => void } | null;
}

/**
 * The Recommended panel under the note instead of in the sidebar (S1, a
 * setting). Wiring only: the panel is the sidebar's, drawn at the end of each
 * open note's scrolling content, so it is read where the note ends — in
 * editing and in Reading view alike, moved across when the view switches.
 * Switched back to the sidebar, every footer goes.
 */
export class RecommendedFooter {
  private readonly footers = new Map<MarkdownView, Footer>();
  private readonly hold = new FooterHold<MarkdownView, TFile>();

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

  /**
   * Open this note without the footer, this once; call what comes back once
   * the note is open.
   *
   * What comes back looks at the open views, so the note's view claims its
   * hold even if no workspace event has run since the open, and then gives
   * up the hold if nothing claimed it.
   */
  holdBack(file: TFile): () => void {
    this.hold.hold(file);
    return () => {
      this.sync();
      this.hold.release(file);
    };
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
        this.drop(view, footer);
      }
    }
    this.hold.keepOnly(views);
    if (!on) return;

    for (const view of views) {
      if (this.hold.isHeld(view, view.file)) {
        const footer = this.footers.get(view);
        if (footer) this.drop(view, footer);
        continue;
      }
      const target = noteFooterHost(view, view.getMode() === "preview");
      if (!target) continue;
      let footer = this.footers.get(view);
      if (footer && footer.el.parentElement !== target) {
        // The view switched between editing and reading: the same panel
        // moves with its answer, rather than asking again for the same note.
        placeAfterNote(target, footer.el);
      }
      if (!footer) {
        // Made in the note's own document: a note in a pop-out window has another.
        const el = target.ownerDocument.createElement("div");
        el.addClass("schreibstube-recommended-footer");
        placeAfterNote(target, el);
        // Inside the editor's content: a press here must not place the cursor.
        el.setAttr("contenteditable", "false");
        const panel = new RecommendedPanel(el.createDiv(), host, { heading: false });
        const unwatch = watchViewMode(view.containerEl, () => this.sync());
        footer = { el, panel, path: null, unwatch, tail: null };
        this.footers.set(view, footer);
      }
      // In editing, the footer comes after the editor's own end-of-note
      // padding; that padding is moved below it. Reading view pads the page
      // after the footer already.
      const editing = view.getMode() !== "preview";
      if (footer.tail && (!editing || footer.tail.sizer !== target)) {
        footer.tail.stop();
        footer.tail = null;
      }
      if (editing && !footer.tail) {
        footer.tail = { sizer: target, stop: keepEditorTailBelow(target, footer.el) };
      }
      const path = view.file?.path ?? null;
      if (footer.path !== path) {
        footer.path = path;
        footer.panel.show(path);
      }
    }
  }

  private drop(view: MarkdownView, footer: Footer): void {
    footer.unwatch();
    footer.tail?.stop();
    footer.el.remove();
    this.footers.delete(view);
  }

  private clear(): void {
    for (const [view, footer] of this.footers) this.drop(view, footer);
  }
}
