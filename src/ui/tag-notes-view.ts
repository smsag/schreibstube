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
import { checkTag, summarizeTagCards, type TagCard } from "../services/tag-pins";
import { drawTaskCount } from "./task-count-label";
import { wirePress } from "./explorer-gestures";
import { applyIcon, installIconFont } from "./icon-font";
import { pressKeys } from "./pressable";

export const TAG_NOTES_VIEW_TYPE = "schreibstube-tag-notes";

export interface TagNotesHost {
  cards(tag: string): TagCard[];
  open(path: string, where: PaneTarget): Promise<void>;
  /** Open the note's menu, at the pointer or at a finger. */
  showMenu(path: string, at: MouseEvent | { x: number; y: number }): void;
}

export class TagNotesView extends ItemView {
  private host: TagNotesHost | null = null;
  private tag: string | null = null;
  /** The redraw waiting for the next frame. */
  private frame: number | null = null;

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
    this.tag = typeof raw === "string" ? checkTag(raw) : null;
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
    if (this.frame !== null) this.containerEl.win.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.contentEl.empty();
  }

  /** One redraw per frame, however many vault events arrived in it. */
  private requestRender(): void {
    if (this.frame !== null) return;
    // The view's own window: a leaf popped out has one of its own.
    this.frame = this.containerEl.win.requestAnimationFrame(() => {
      this.frame = null;
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

    // The same press a row in the pane answers: a click opens, a right click
    // or a held finger asks for the menu, so a phone reaches it at all. A
    // modifier opens a tab, a split or a window, the way a link in the editor
    // does, so a card can be kept open beside the note already in front of
    // the person.
    wirePress(el, {
      isDragging: () => false,
      activate: (event) => void host.open(card.path, openTargetOf(Keymap.isModEvent(event))),
      showMenu: (at) => host.showMenu(card.path, at)
    });
    pressKeys(el, (event) => void host.open(card.path, openTargetOf(Keymap.isModEvent(event))));
  }
}
