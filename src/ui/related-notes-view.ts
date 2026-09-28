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
import { ItemView, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import { isAtOrUnder, pathAfterMove } from "../services/path-follow";
import { installIconFont } from "./icon-font";
import { RecommendedPanel, type RecommendedHost } from "./recommended-panel";

export type { RelatedCard } from "./recommended-panel";

export const RELATED_NOTES_VIEW_TYPE = "schreibstube-related-notes";

/**
 * How long the panel waits for the link graph to settle before redrawing.
 *
 * Every edit is re-parsed and a sync delivers notes in bursts, and each of
 * those resolves the graph again. Ranking the vault for each would be work
 * nobody sees; the panel answers once the burst is over.
 */
const SETTLE_MS = 300;

export class RelatedNotesView extends ItemView {
  private host: RecommendedHost | null = null;
  private panel: RecommendedPanel | null = null;
  private source: string | null = null;
  /** A redraw waiting for the next frame. */
  private frame: number | null = null;
  /** A redraw waiting for the link graph to settle. */
  private settleTimer: number | null = null;
  /** A draw was due while the panel was out of sight; it is made on return. */
  private stale = false;
  /** The header button that keeps the panel on one note or lets it follow. */
  private followAction: HTMLElement | null = null;
  /**
   * Whether the panel follows whatever note is open.
   *
   * On by default, because a panel that has to be re-asked for every note is a
   * panel that gets asked once. It is switched off by opening the panel on a
   * particular note from that note's menu, which is a person saying which note
   * they mean, or by the pin in the header; the same pin lets it follow again.
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
   * back on the same note rather than on an empty sidebar. The state is read
   * back from a file a person can edit, so only a non-empty path is taken.
   */
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const raw = (state as { path?: unknown; following?: unknown } | null) ?? {};
    if (typeof raw.path === "string" && raw.path.length > 0) this.source = raw.path;
    if (typeof raw.following === "boolean") this.following = raw.following;
    await super.setState(state, result);
    this.drawFollowAction();
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

    if (this.source === null) this.source = this.activeNote();

    // A link written or removed, a tag added: each changes an entry or whether
    // there is one. `resolved` and not `changed`, because `changed` arrives
    // before Obsidian has resolved the note's links, and the list drawn then
    // was one link behind until the next edit.
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.requestSettledRender()));
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        // The note the list was for is gone: an answer about it would be about
        // nothing. Following, the panel goes back to whatever note is open.
        if (this.source !== null && isAtOrUnder(this.source, file.path)) {
          this.source = this.following ? this.activeNote() : null;
        }
        this.requestRender();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        // Renamed or moved, directly or with its folder, the note is the same
        // note; left on the old path, the list emptied and the heading named a
        // file that no longer existed.
        if (this.source !== null) this.source = pathAfterMove(this.source, oldPath, file.path);
        this.requestRender();
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        // Only a note has neighbours to list. A picture or a PDF opened beside
        // it leaves the list on the last note rather than emptying it.
        if (!this.following || !(file instanceof TFile) || file.extension !== "md") return;
        if (file.path === this.source) return;
        this.source = file.path;
        this.requestRender();
      })
    );
    // A draw skipped while the panel was hidden is made when it shows again.
    const catchUp = (): void => {
      if (this.stale) this.requestRender();
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", catchUp));
    this.registerEvent(this.app.workspace.on("layout-change", catchUp));

    this.drawFollowAction();
    this.render();
  }

  override onResize(): void {
    if (this.stale) this.requestRender();
  }

  protected override async onClose(): Promise<void> {
    const win = this.containerEl.win;
    if (this.frame !== null) win.cancelAnimationFrame(this.frame);
    if (this.settleTimer !== null) win.clearTimeout(this.settleTimer);
    this.frame = null;
    this.settleTimer = null;
    this.contentEl.empty();
  }

  /** The note in front of the reader, when it is a note. */
  private activeNote(): string | null {
    const file = this.app.workspace.getActiveFile();
    return file?.extension === "md" ? file.path : null;
  }

  /**
   * The pin in the header: pressed while following, it keeps the panel on
   * this note; pressed while kept, it follows the open note again.
   *
   * Before it, a panel opened on one note from its menu stayed there for good,
   * and the only way back to following was to know the palette command.
   */
  private drawFollowAction(): void {
    this.followAction?.remove();
    const labels = t().explorer.related;
    this.followAction = this.addAction("pin", this.following ? labels.stay : labels.follow, () =>
      this.toggleFollowing()
    );
    this.followAction.toggleClass("is-active", !this.following);
    this.followAction.setAttribute("aria-pressed", String(!this.following));
  }

  private toggleFollowing(): void {
    this.following = !this.following;
    if (this.following) this.source = this.activeNote() ?? this.source;
    this.drawFollowAction();
    this.app.workspace.requestSaveLayout();
    this.requestRender();
  }

  /** One redraw per frame, however many vault events arrived in it. */
  private requestRender(): void {
    if (this.frame !== null) return;
    this.frame = this.containerEl.win.requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  /** A redraw once the graph has stopped changing for a moment. */
  private requestSettledRender(): void {
    const win = this.containerEl.win;
    if (this.settleTimer !== null) win.clearTimeout(this.settleTimer);
    this.settleTimer = win.setTimeout(() => {
      this.settleTimer = null;
      this.requestRender();
    }, SETTLE_MS);
  }

  private render(): void {
    // Ranking the vault for a panel nobody can see is work for nothing; the
    // draw is made when the panel comes back into view.
    if (!this.contentEl.isShown()) {
      this.stale = true;
      return;
    }
    this.stale = false;

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
