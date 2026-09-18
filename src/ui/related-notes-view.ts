/**
 * The notes related to the one in front of you, as cards in the right sidebar.
 *
 * It follows the open note rather than being asked again for each one: the
 * point of the panel is that it is already showing the answer by the time the
 * question occurs to you. Pressing a card opens that note, the panel follows
 * along, and the next note is one press away.
 *
 * Every card says why it is there. A list of related notes nobody can explain
 * is a list nobody trusts, and "because you linked them" and "because the same
 * note lists both" are different enough answers to be worth naming — the first
 * is something you did, the second something you can go and look at.
 *
 * It draws and reports. Which notes are related, how strongly and for which
 * reasons is decided in `related-notes` and handed over by the explorer
 * controller, which reads the link graph Obsidian has already resolved.
 */
import { ItemView, Keymap, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { RelatedReason } from "../services/related-notes";
import { applyIcon, installIconFont } from "./icon-font";

export const RELATED_NOTES_VIEW_TYPE = "schreibstube-related-notes";

/** One related note, as the sidebar draws it. */
export interface RelatedCard {
  path: string;
  /** The `title` in the note's frontmatter when it has one, else its name. */
  title: string;
  /** The folder holding it; empty at the vault root. */
  folder: string;
  reasons: RelatedReason[];
}

export interface RelatedNotesHost {
  cards(path: string): RelatedCard[];
  /** The title to put at the top: what the list is related *to*. */
  titleOf(path: string): string | null;
  open(path: string, newTab: boolean): Promise<void>;
  showMenu(path: string, event: MouseEvent): void;
}

export class RelatedNotesView extends ItemView {
  private host: RelatedNotesHost | null = null;
  private source: string | null = null;
  private pending = false;
  /**
   * Whether the panel follows whatever note is open.
   *
   * On by default, because a panel that has to be re-asked for every note is a
   * panel that gets asked once. It is switched off by opening the panel on a
   * particular note from that note's menu, which is a person saying which note
   * they mean.
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

  connect(host: RelatedNotesHost): void {
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

  /** List the notes related to one particular note, and stop following. */
  show(path: string): void {
    this.source = path;
    this.following = false;
    this.requestRender();
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

    const labels = t().explorer.related;
    if (this.source === null || this.host === null) {
      root.createDiv({ cls: "schreibstube-related-empty", text: labels.viewNoNote });
      return;
    }

    const header = root.createDiv({ cls: "schreibstube-related-header" });
    const title = header.createDiv({ cls: "schreibstube-related-title" });
    applyIcon(title.createSpan({ cls: "schreibstube-explorer-glyph" }), "link");
    title.createSpan({ text: this.host.titleOf(this.source) ?? this.source });

    const cards = this.host.cards(this.source);
    header.createDiv({ cls: "schreibstube-related-summary", text: labels.summary(cards.length) });

    if (cards.length === 0) {
      // Not a failure and not an empty state to apologise for: a note nothing
      // links, tags or files beside anything else genuinely has no neighbours,
      // and saying so is more use than a list padded with its folder.
      root.createDiv({ cls: "schreibstube-related-empty", text: labels.viewEmpty });
      return;
    }

    const list = root.createDiv({ cls: "schreibstube-related-list" });
    for (const card of cards) this.renderCard(list, card);
  }

  private renderCard(list: HTMLElement, card: RelatedCard): void {
    const host = this.host;
    if (!host) return;

    const el = list.createDiv({
      cls: "schreibstube-related-card",
      attr: { role: "link", tabindex: "0", title: card.path }
    });

    el.createDiv({ cls: "schreibstube-related-card-title", text: card.title });
    el.createDiv({
      cls: "schreibstube-related-card-folder",
      text: card.folder.length > 0 ? card.folder : t().explorer.related.root
    });

    // Why this note is on the list, strongest reason first. Two chips at most:
    // the third reason is never what made the difference, and a card that is
    // mostly chips stops being a note.
    const why = el.createDiv({ cls: "schreibstube-related-card-why" });
    for (const reason of card.reasons.slice(0, 2)) {
      why.createSpan({ cls: "schreibstube-related-chip", text: reasonLabel(reason) });
    }

    // A modifier opens a tab, the way a link in the editor does, so a related
    // note can be kept open beside the one already in front of the person.
    el.addEventListener("click", (event) => {
      void host.open(card.path, Keymap.isModEvent(event) !== false);
    });
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void host.open(card.path, Keymap.isModEvent(event) !== false);
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      host.showMenu(card.path, event);
    });
  }
}

/** What a reason says on a chip. */
function reasonLabel(reason: RelatedReason): string {
  const labels = t().explorer.related.reasons;
  switch (reason.kind) {
    case "link":
      return labels.link;
    case "shared-link":
      return labels.sharedLink(reason.count);
    case "co-citation":
      return labels.coCitation(reason.count);
    case "tag":
      return labels.tag(reason.count);
    default:
      return labels.folder;
  }
}
