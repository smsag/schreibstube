/**
 * What belongs with the open note: notes, pictures and conversations, each
 * card saying why it is there.
 *
 * Drawn in two steps. The link graph answers at once, from what Obsidian has
 * already resolved, so the panel is never empty while it waits. Search by
 * meaning answers a moment later from vectors already stored — no model is
 * loaded for it — and the list is drawn again with what it found: notes
 * nobody linked, the pictures whose descriptions read alike, and the
 * conversations about the same thing. An answer for a note that is no longer
 * the one shown is dropped.
 *
 * The same panel is the sidebar view and the footer under a note, so the two
 * places cannot drift apart.
 */
import { Keymap } from "obsidian";
import { t } from "../i18n";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import type { RecommendReason } from "../services/semantic/recommend";
import { applyIcon } from "./icon-font";

/** One related note, as a card draws it. */
export interface RelatedCard {
  path: string;
  /** The `title` in the note's frontmatter when it has one, else its name. */
  title: string;
  /** The folder holding it; empty at the vault root. */
  folder: string;
  reasons: RecommendReason[];
}

export interface PictureCard {
  path: string;
  title: string;
  /** What an `<img>` can load: Obsidian's resource path for the file. */
  src: string;
}

export interface ConversationCard {
  id: string;
  title: string;
}

export interface Recommendation {
  notes: RelatedCard[];
  pictures: PictureCard[];
  conversations: ConversationCard[];
}

export interface RecommendedHost {
  /** The link graph's answer, at once. */
  cards(path: string): RelatedCard[];
  /** The full answer with meaning in it, or null when search by meaning is off. */
  recommend?(path: string): Promise<Recommendation | null>;
  /** The title to put at the top: what the list is related *to*. */
  titleOf(path: string): string | null;
  open(path: string, where: PaneTarget): Promise<void>;
  openConversation(id: string): void;
  showMenu(path: string, event: MouseEvent): void;
}

/** Pictures drawn at most: a row of thumbnails, not a gallery. */
const MAX_PICTURES = 8;
/** Conversations drawn at most. */
const MAX_CONVERSATIONS = 5;

/**
 * How long an answer for the same note stands before a vault change asks again.
 * Every autosave is a metadata change, and ranking the whole index on each one
 * would be paid for every few seconds while someone types in the note shown.
 */
const REASK_MS = 15_000;

export class RecommendedPanel {
  private source: string | null = null;
  private answer: { path: string; value: Recommendation } | null = null;
  /** Which request is the latest, so an older answer cannot land on a newer note. */
  private asked = 0;
  private lastAsk: { path: string; at: number } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: RecommendedHost,
    private readonly opts: { heading: boolean } = { heading: true }
  ) {}

  /** Show what belongs with `path`, or the empty state for no note. */
  show(path: string | null): void {
    if (path !== this.source) {
      this.answer = null;
      this.lastAsk = null;
    }
    this.source = path;
    this.draw();
    if (path !== null) this.ask(path);
  }

  /** Something in the vault changed: ask again for the note shown. */
  refresh(): void {
    this.show(this.source);
  }

  private ask(path: string): void {
    const recommend = this.host.recommend;
    if (!recommend) return;
    const now = Date.now();
    if (this.lastAsk?.path === path && now - this.lastAsk.at < REASK_MS) return;
    this.lastAsk = { path, at: now };
    const token = ++this.asked;
    void recommend(path).then((value) => {
      if (token !== this.asked || this.source !== path || value === null) return;
      this.answer = { path, value };
      this.draw();
    });
  }

  private draw(): void {
    const root = this.root;
    root.empty();
    const labels = t().explorer.related;
    const path = this.source;
    if (path === null) {
      root.createDiv({ cls: "schreibstube-related-empty", text: labels.viewNoNote });
      return;
    }

    const value =
      this.answer?.path === path
        ? this.answer.value
        : { notes: this.host.cards(path), pictures: [], conversations: [] };
    const total = value.notes.length + value.pictures.length + value.conversations.length;

    if (this.opts.heading) {
      const header = root.createDiv({ cls: "schreibstube-related-header" });
      const title = header.createDiv({ cls: "schreibstube-related-title" });
      applyIcon(title.createSpan({ cls: "schreibstube-explorer-glyph" }), "link");
      title.createSpan({ text: this.host.titleOf(path) ?? path });
      header.createDiv({ cls: "schreibstube-related-summary", text: labels.summary(total) });
    }

    if (total === 0) {
      root.createDiv({ cls: "schreibstube-related-empty", text: labels.viewEmpty });
      return;
    }

    if (value.pictures.length > 0) {
      this.sectionTitle(labels.pictures);
      const strip = root.createDiv({ cls: "schreibstube-related-pictures" });
      for (const picture of value.pictures.slice(0, MAX_PICTURES))
        this.renderPicture(strip, picture);
    }
    if (value.notes.length > 0) {
      if (value.pictures.length > 0 || value.conversations.length > 0)
        this.sectionTitle(labels.notes);
      const list = root.createDiv({ cls: "schreibstube-related-list" });
      for (const card of value.notes) this.renderCard(list, card);
    }
    if (value.conversations.length > 0) {
      this.sectionTitle(labels.conversations);
      const list = root.createDiv({ cls: "schreibstube-related-list" });
      for (const conversation of value.conversations.slice(0, MAX_CONVERSATIONS)) {
        this.renderConversation(list, conversation);
      }
    }
  }

  private sectionTitle(text: string): void {
    this.root.createDiv({ cls: "schreibstube-related-section", text });
  }

  /** Press, Enter or Space opens; a modifier opens beside, as a link does. */
  private pressable(el: HTMLElement, open: (event: MouseEvent | KeyboardEvent) => void): void {
    el.addEventListener("click", (event) => open(event));
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open(event);
    });
  }

  private renderCard(list: HTMLElement, card: RelatedCard): void {
    const el = list.createDiv({
      cls: "schreibstube-related-card",
      attr: { role: "link", tabindex: "0", title: card.path }
    });
    el.createDiv({ cls: "schreibstube-related-card-title", text: card.title });
    el.createDiv({
      cls: "schreibstube-related-card-folder",
      text: card.folder.length > 0 ? card.folder : t().explorer.related.root
    });
    // Two chips at most: the third reason is never what made the difference.
    const why = el.createDiv({ cls: "schreibstube-related-card-why" });
    for (const reason of card.reasons.slice(0, 2)) {
      why.createSpan({ cls: "schreibstube-related-chip", text: reasonLabel(reason) });
    }
    this.pressable(el, (event) => {
      void this.host.open(card.path, openTargetOf(Keymap.isModEvent(event)));
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.host.showMenu(card.path, event);
    });
  }

  private renderPicture(strip: HTMLElement, picture: PictureCard): void {
    const el = strip.createDiv({
      cls: "schreibstube-related-picture",
      attr: {
        role: "link",
        tabindex: "0",
        title: `${picture.title} · ${t().explorer.related.reasons.meaning}`
      }
    });
    el.createEl("img", { attr: { src: picture.src, alt: picture.title, loading: "lazy" } });
    this.pressable(el, (event) => {
      void this.host.open(picture.path, openTargetOf(Keymap.isModEvent(event)));
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.host.showMenu(picture.path, event);
    });
  }

  private renderConversation(list: HTMLElement, conversation: ConversationCard): void {
    const el = list.createDiv({
      cls: "schreibstube-related-card is-conversation",
      attr: { role: "link", tabindex: "0" }
    });
    const title = el.createDiv({ cls: "schreibstube-related-card-title" });
    applyIcon(title.createSpan({ cls: "schreibstube-explorer-glyph" }), "messages");
    title.createSpan({ text: conversation.title });
    const why = el.createDiv({ cls: "schreibstube-related-card-why" });
    why.createSpan({
      cls: "schreibstube-related-chip",
      text: t().explorer.related.reasons.meaning
    });
    this.pressable(el, () => this.host.openConversation(conversation.id));
  }
}

/** What a reason says on a chip. */
function reasonLabel(reason: RecommendReason): string {
  const labels = t().explorer.related.reasons;
  switch (reason.kind) {
    case "link":
      return labels.link;
    case "meaning":
      return labels.meaning;
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
