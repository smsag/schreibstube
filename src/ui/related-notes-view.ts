/**
 * What belongs with the open note, in the right sidebar: notes, pictures and
 * conversations (`recommended-panel`).
 *
 * It follows the open note rather than being asked again for each one: the
 * point of the panel is that it is already showing the answer by the time the
 * question occurs to you. Opened on one note from that note's menu, it stays on
 * that note instead.
 *
 * It draws and reports. What belongs together, how strongly and why is decided
 * in `related-notes` and `semantic/recommend`, and handed over by the host.
 */
import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import { installIconFont } from "./icon-font";
import { RecommendedPanel, type RecommendedHost } from "./recommended-panel";

export type { RelatedCard } from "./recommended-panel";

export const RELATED_NOTES_VIEW_TYPE = "schreibstube-related-notes";

export class RelatedNotesView extends ItemView {
  private host: RecommendedHost | null = null;
  private panel: RecommendedPanel | null = null;
  private source: string | null = null;
  private pending = false;
  /**
   * Whether the panel follows whatever note is open.
   *
   * On by default, because a panel that has to be re-asked for every note is a
   * panel that gets asked once. It is switched off by opening the panel on a
   * particular note from that note's menu, which is a person saying which note
   * they mean; whoever opens the panel says which of the two it is, through
   * the state below.
   */
  private following = true;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {
    return RELATED_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t().explorer.related.viewTitle;
  }

  override getIcon(): string {
    return "git-fork";
  }

  connect(host: RecommendedHost): void {
    this.host = host;
    this.requestRender();
  }

  /**
   * Which note the leaf is listing for.
   *
   * Kept in the view's own state so a workspace restored after a restart comes
   * back on the same note rather than on an empty sidebar.
   */
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const raw = (state as { path?: unknown; following?: unknown } | null) ?? {};
    if (typeof raw.path === "string") this.source = raw.path;
    if (typeof raw.following === "boolean") this.following = raw.following;
    await super.setState(state, result);
    this.requestRender();
  }

  override getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      following: this.following,
      ...(this.source === null ? {} : { path: this.source })
    };
  }

  protected override async onOpen(): Promise<void> {
    installIconFont(this.containerEl.doc);
    this.contentEl.addClass("schreibstube-related-notes");

    if (this.source === null) this.source = this.app.workspace.getActiveFile()?.path ?? null;

    // A link written or removed, a tag added, a note deleted or moved: each
    // changes a card or whether there is one.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRender()));
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (this.following && file) this.source = file.path;
        this.requestRender();
      })
    );

    this.render();
  }

  protected override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** One redraw per frame, however many vault events arrived in it. */
  private requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    window.requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  private render(): void {
    if (this.host === null) {
      this.contentEl.empty();
      this.contentEl.createDiv({
        cls: "schreibstube-related-empty",
        text: t().explorer.related.viewNoNote
      });
      return;
    }
    this.panel ??= new RecommendedPanel(this.contentEl, this.host);
    this.panel.show(this.source);
  }
}
