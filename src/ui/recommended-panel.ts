/**
 * What belongs with the open note: notes, pictures and conversations in one
 * list, most relevant first, each entry saying what it is and why it is there.
 *
 * Drawn as the note's own register rather than as boxes: what the entry is as
 * an icon in a marker column (the icon the Explorer gives it, Pythia's for a
 * conversation), the title as a link, and one line under it. Every title
 * starts on the same edge, a picture's too; its thumbnail sits apart at the far
 * end. The order is the ranking, so it needs no number of its own. Under the
 * pointer an entry offers its Obsidian URL and, for a file, a pane of its own
 * to the right.
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
import { applyIcon, applyObsidianIcon } from "./icon-font";
import { TASK_PILL_CLASS } from "./task-count-label";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import type { RecommendReason } from "../services/semantic/recommend";

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

/** One entry of the list, of whichever kind: ranked together, not by kind. */
export type RecommendedItem =
  | { kind: "note"; card: RelatedCard }
  | { kind: "picture"; picture: PictureCard }
  | { kind: "conversation"; conversation: ConversationCard };

export interface Recommendation {
  /** Most relevant first. */
  items: RecommendedItem[];
}

export interface RecommendedHost {
  /** The link graph's answer, at once. */
  cards(path: string): RelatedCard[];
  /** The full answer with meaning in it, or null when search by meaning is off. */
  recommend?(path: string): Promise<Recommendation | null>;
  /** The title to put at the top: what the list is related *to*. */
  titleOf(path: string): string | null;
  open(path: string, where: PaneTarget): Promise<void>;
  /** How many entries the list shows: the person's setting. */
  count(): number;
  openConversation(id: string): void;
  showMenu(path: string, event: MouseEvent): void;
  /** The icon a file wears in the Explorer: the one chosen for it, or its kind's. */
  glyphOf(path: string): string;
  /** Put the entry's `obsidian://` link on the clipboard, and say so. */
  copyLink(link: { kind: "file"; path: string } | { kind: "conversation"; id: string }): void;
}

/** Pythia's own mark, from the bundled icon font. */
const CONVERSATION_GLYPH = "pythia";

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
  /** Under the note only: folded away by a press on its heading. Not kept:
   *  the next note opens with the list shown. */
  private collapsed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: RecommendedHost,
    /** `heading`: the note's title over the list (the sidebar); without it,
     *  a section heading with the count (under the note). */
    private readonly opts: { heading: boolean } = { heading: true }
  ) {}

  /** Show what belongs with `path`, or the empty state for no note. */
  show(path: string | null): void {
    if (path !== this.source) {
      this.answer = null;
      this.lastAsk = null;
      this.collapsed = false;
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

    const items = (
      this.answer?.path === path
        ? this.answer.value.items
        : this.host.cards(path).map((card): RecommendedItem => ({ kind: "note", card }))
    ).slice(0, this.host.count());
    const total = items.length;

    if (this.opts.heading) {
      const header = root.createDiv({ cls: "schreibstube-related-header" });
      header.createDiv({
        cls: "schreibstube-related-title",
        text: this.host.titleOf(path) ?? path
      });
      header.createDiv({ cls: "schreibstube-related-summary", text: labels.summary(total) });
    } else {
      // Under the note the note is the title; the heading names the section,
      // counts it in the task pill the Explorer counts tasks in, and folds it.
      const section = root.createDiv({
        cls: "schreibstube-related-section",
        attr: {
          role: "button",
          tabindex: "0",
          "aria-expanded": String(!this.collapsed),
          "aria-label": this.collapsed ? labels.expand : labels.collapse
        }
      });
      section.toggleClass("is-collapsed", this.collapsed);
      applyIcon(
        section.createSpan({ cls: "schreibstube-related-section-chevron" }),
        this.collapsed ? "chevron-right" : "chevron-down"
      );
      section.createSpan({ cls: "schreibstube-related-section-label", text: labels.viewTitle });
      section.createSpan({ cls: "schreibstube-related-section-rule" });
      section.createSpan({
        cls: `schreibstube-related-section-count ${TASK_PILL_CLASS}`,
        text: String(total),
        attr: { "aria-label": labels.summary(total) }
      });
      this.pressable(section, () => {
        this.collapsed = !this.collapsed;
        this.draw();
        this.root.querySelector<HTMLElement>(".schreibstube-related-section")?.focus();
      });
      if (this.collapsed) return;
    }

    if (total === 0) {
      root.createDiv({ cls: "schreibstube-related-empty", text: labels.viewEmpty });
      return;
    }

    // Still an <ol>: the order is the ranking, and a screen reader says so.
    const list = root.createEl("ol", { cls: "schreibstube-related-list" });
    for (const item of items) {
      if (item.kind === "note") this.renderCard(list, item.card);
      else if (item.kind === "picture") this.renderPicture(list, item.picture);
      else this.renderConversation(list, item.conversation);
    }
  }

  /**
   * One entry: what it is, its title, and a line of what it is and why. Every
   * kind is built here, so a picture's title cannot start anywhere but on the
   * edge the others start on.
   */
  private renderRow(
    list: HTMLElement,
    row: {
      title: string;
      what: string;
      why: readonly string[];
      glyph: string;
      path?: string;
      kind?: string;
    }
  ): HTMLElement {
    const el = list.createEl("li").createDiv({
      cls: row.kind ? `schreibstube-related-card ${row.kind}` : "schreibstube-related-card",
      attr: { role: "link", tabindex: "0" }
    });
    if (row.path !== undefined) el.setAttribute("title", row.path);
    // The line under the title says the same in words, for a screen reader too.
    applyIcon(el.createSpan({ cls: "schreibstube-related-glyph" }), row.glyph);
    const text = el.createDiv({ cls: "schreibstube-related-card-text" });
    text.createDiv({ cls: "schreibstube-related-card-title", text: row.title });
    const meta = text.createDiv({ cls: "schreibstube-related-card-meta" });
    meta.createSpan({ cls: "schreibstube-related-card-folder", text: row.what });
    if (row.why.length > 0) {
      meta.createSpan({ cls: "schreibstube-related-card-why", text: row.why.join(" · ") });
    }
    return el;
  }

  /**
   * The entry's actions at its far end, shown under the pointer: its Obsidian
   * URL, and for a file a pane of its own to the right. A press on either is
   * the button's alone and never also opens the entry.
   */
  private actions(
    el: HTMLElement,
    link: { kind: "file"; path: string } | { kind: "conversation"; id: string }
  ): void {
    const labels = t().explorer.related;
    const bar = el.createDiv({ cls: "schreibstube-related-actions" });
    const action = (label: string, icons: string[], fallback: string, run: () => void) => {
      const button = bar.createEl("button", {
        cls: "sb sb-icon schreibstube-related-action",
        attr: { type: "button", "aria-label": label }
      });
      applyObsidianIcon(button.createSpan(), icons, fallback);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        run();
      });
      button.addEventListener("keydown", (event) => event.stopPropagation());
    };
    action(labels.copyLink, ["lucide-link"], "link", () => this.host.copyLink(link));
    if (link.kind === "file") {
      // Obsidian's own icon for its own "Open to the right".
      action(labels.openBeside, ["lucide-separator-vertical"], "external-link", () => {
        void this.host.open(link.path, "split");
      });
    }
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
    const el = this.renderRow(list, {
      title: card.title,
      what: card.folder.length > 0 ? card.folder : t().explorer.related.root,
      // Two reasons at most: the third is never what made the difference.
      why: card.reasons.slice(0, 2).map(reasonLabel),
      glyph: this.host.glyphOf(card.path),
      path: card.path
    });
    this.actions(el, { kind: "file", path: card.path });
    this.pressable(el, (event) => {
      void this.host.open(card.path, openTargetOf(Keymap.isModEvent(event)));
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.host.showMenu(card.path, event);
    });
  }

  /** A picture is an entry like the rest, its thumbnail at the far end. */
  private renderPicture(list: HTMLElement, picture: PictureCard): void {
    const labels = t().explorer.related;
    const el = this.renderRow(list, {
      title: picture.title,
      what: labels.picture,
      why: [labels.reasons.meaning],
      glyph: this.host.glyphOf(picture.path),
      path: picture.path,
      kind: "is-picture"
    });
    this.actions(el, { kind: "file", path: picture.path });
    el.createEl("img", {
      cls: "schreibstube-related-card-thumb",
      attr: { src: picture.src, alt: "", loading: "lazy" }
    });
    this.pressable(el, (event) => {
      void this.host.open(picture.path, openTargetOf(Keymap.isModEvent(event)));
    });
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.host.showMenu(picture.path, event);
    });
  }

  private renderConversation(list: HTMLElement, conversation: ConversationCard): void {
    const labels = t().explorer.related;
    const el = this.renderRow(list, {
      title: conversation.title,
      what: labels.conversation,
      why: [labels.reasons.meaning],
      glyph: CONVERSATION_GLYPH,
      kind: "is-conversation"
    });
    this.actions(el, { kind: "conversation", id: conversation.id });
    this.pressable(el, () => this.host.openConversation(conversation.id));
  }
}

/** What a reason says on an entry's line. */
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
