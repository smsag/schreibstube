/**
 * The notes carrying a pinned tag, as cards in the right sidebar.
 *
 * The pinned row says how much is open under a tag; this says where. One card
 * per note, the most open work first, and a press on a card opens the note in
 * the editor — the sidebar stays put, so the next note is one press away.
 *
 * It draws and reports. Which notes carry the tag, what they count and the
 * order they come in are decided in `tag-pins` and handed over by the explorer
 * controller, which already reads the same metadata for the pinned row.
 */
import { ItemView, Keymap, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import { normalizeTag, summarizeTagCards, type TagCard } from "../services/tag-pins";
import { drawTaskCount } from "./task-count-label";
import { applyIcon, installIconFont } from "./icon-font";

export const TAG_NOTES_VIEW_TYPE = "schreibstube-tag-notes";

export interface TagNotesHost {
  cards(tag: string): TagCard[];
  open(path: string, where: PaneTarget): Promise<void>;
  showMenu(path: string, event: MouseEvent): void;
}

export class TagNotesView extends ItemView {
  private host: TagNotesHost | null = null;
  private tag: string | null = null;
  private pending = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {
    return TAG_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.tag === null
      ? t().explorer.tags.viewTitle
      : t().explorer.tags.viewTitleFor(this.tag);
  }

  override getIcon(): string {
    return "tag";
  }

  connect(host: TagNotesHost): void {
    this.host = host;
    this.requestRender();
  }

  /**
   * Which tag the leaf lists.
   *
   * Kept in the view's own state, so a workspace restored after a restart
   * comes back listing the same tag rather than an empty sidebar.
   */
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const raw = (state as { tag?: unknown } | null)?.tag;
    this.tag = typeof raw === "string" ? normalizeTag(raw) : null;
    await super.setState(state, result);
    this.requestRender();
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), ...(this.tag === null ? {} : { tag: this.tag }) };
  }

  protected override async onOpen(): Promise<void> {
    installIconFont(this.containerEl.doc);
    this.contentEl.addClass("schreibstube-tag-notes");

    // A task ticked, a tag added or removed, a note moved: each changes a card
    // or whether there is one.
    this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.requestRender()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.requestRender()));

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
    const root = this.contentEl;
    root.empty();

    if (this.tag === null || this.host === null) {
      root.createDiv({ cls: "schreibstube-tag-notes-empty", text: t().explorer.tags.viewNoTag });
      return;
    }

    const cards = this.host.cards(this.tag);
    const summary = summarizeTagCards(cards);

    const header = root.createDiv({ cls: "schreibstube-tag-notes-header" });
    const title = header.createDiv({ cls: "schreibstube-tag-notes-title" });
    applyIcon(title.createSpan({ cls: "schreibstube-explorer-glyph" }), "tag");
    title.createSpan({ text: `#${this.tag}` });
    header.createDiv({
      cls: "schreibstube-tag-notes-summary",
      text: t().explorer.tags.summary(
        t().explorer.tags.notes(summary.notes),
        summary.open,
        summary.total
      )
    });

    if (cards.length === 0) {
      root.createDiv({ cls: "schreibstube-tag-notes-empty", text: t().explorer.tags.viewEmpty });
      return;
    }

    const list = root.createDiv({ cls: "schreibstube-tag-notes-list" });
    const active = this.app.workspace.getActiveFile()?.path;
    for (const card of cards) this.renderCard(list, card, card.path === active);
  }

  private renderCard(list: HTMLElement, card: TagCard, active: boolean): void {
    const host = this.host;
    if (!host) return;

    const el = list.createDiv({
      cls: "schreibstube-tag-card",
      attr: { role: "link", tabindex: "0", title: card.path }
    });
    if (active) el.addClass("is-active");

    const head = el.createDiv({ cls: "schreibstube-tag-card-head" });
    head.createDiv({ cls: "schreibstube-tag-card-title", text: card.title });

    drawTaskCount(head, card.tally, "schreibstube-tag-card-tasks");

    el.createDiv({
      cls: "schreibstube-tag-card-folder",
      text: card.folder.length > 0 ? card.folder : t().explorer.tags.root
    });

    // A modifier opens a tab, a split or a window, the way a link in the editor does, so a card can
    // be kept open beside the note already in front of the person.
    el.addEventListener("click", (event) => {
      void host.open(card.path, openTargetOf(Keymap.isModEvent(event)));
    });
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void host.open(card.path, openTargetOf(Keymap.isModEvent(event)));
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      host.showMenu(card.path, event);
    });
  }
}
