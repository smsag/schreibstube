/**
 * What belongs with the open note: notes, pictures and other plugins' items in one
 * list, most relevant first, each entry saying what it is and why it is there.
 *
 * Drawn as the note's own register rather than as boxes: what the entry is as
 * an icon in a marker column (the icon the Explorer gives it, its source's for
 * an item), the title as a link, and one line under it. Every title
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
 * items about the same thing. An answer for a note that is no longer
 * the one shown is dropped.
 *
 * The same panel is the sidebar view and the footer under a note, so the two
 * places cannot drift apart. They differ in where in the note the meaning half
 * ranks from: the sidebar from the section the cursor is in, the footer from
 * the note's end, where it is read. Each section's answer is kept while the
 * note is shown, so moving back and forth asks nothing again.
 */
import { Keymap } from "obsidian";
import { t } from "../i18n";
import { applyIcon, applyObsidianIcon } from "./icon-font";
import { TASK_PILL_CLASS } from "./task-count-label";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_SIMILARITY_PRESET,
  embeddingModelConfig
} from "../services/semantic/embedding-models";
import {
  relevanceOf,
  similarityPercent,
  type RecommendReason,
  type Relevance,
  type RelevanceFloors
} from "../services/semantic/recommend";
import { groundColour } from "../services/ground-colour";
import { isElementLike } from "../services/workspace-internals";

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
  reasons: RecommendReason[];
}

/** One of another plugin's items, as its source names and draws it. */
export interface ItemCard {
  key: string;
  title: string;
  /** What one of them is: "Conversation in Pythia". */
  label: string;
  icon?: string;
  /** Whether the item has a link its source will give. */
  linkable: boolean;
  reasons: RecommendReason[];
}

/** What "copy link" is asked for: a vault file, or a source's item by key. */
export type EntryLink = { kind: "file"; path: string } | { kind: "item"; key: string };

/** A source that named no icon of the set. */
const ITEM_FALLBACK_ICON = "stack-2";

/** One entry of the list, of whichever kind: ranked together, not by kind. */
export type RecommendedItem =
  | { kind: "note"; card: RelatedCard }
  | { kind: "picture"; picture: PictureCard }
  | { kind: "item"; item: ItemCard };

export interface Recommendation {
  /** Most relevant first. */
  items: RecommendedItem[];
}

/** Where in the note the meaning half ranks from: the place being written, or the end. */
export type RecommendPlace = "cursor" | "end";

export interface RecommendedHost {
  /** The link graph's answer, at once; under the note, without what it links. */
  links(path: string, place: RecommendPlace): RecommendedItem[];
  /** The full answer with meaning in it, or null when search by meaning is off. */
  recommend?(path: string, place: RecommendPlace): Promise<Recommendation | null>;
  /**
   * Which part of the note `place` stands for now, as a key: a list moved
   * within it asks nothing. Without it, the whole note is one place.
   */
  placeKey?(path: string, place: RecommendPlace): string;
  /** The title to put at the top: what the list is related *to*. */
  titleOf(path: string): string | null;
  open(path: string, where: PaneTarget): Promise<void>;
  /** How many entries the list shows: the person's setting. */
  count(): number;
  openItem(key: string): void;
  showMenu(path: string, event: MouseEvent): void;
  /** The icon a file wears in the Explorer: the one chosen for it, or its kind's. */
  glyphOf(path: string): string;
  /** Put the entry's `obsidian://` link on the clipboard, and say so. */
  copyLink(link: EntryLink): void;
  /** The similarity levels an entry's likeness is read against: the model's
   *  measured floors, which differ for an item. */
  relevanceFloors?(kind: "file" | "item"): RelevanceFloors;
  /** Where a failed answer is reported; without it, only the next ask tells. */
  warn?(message: string, error: unknown): void;
}

/** The meter's three bars; how many are lit says the level. */
const RELEVANCE_BARS: Record<Relevance, number> = { high: 3, medium: 2, low: 1 };

/**
 * How long an answer for the same note stands before a vault change asks again.
 * Every autosave is a metadata change, and ranking the whole index on each one
 * would be paid for every few seconds while someone types in the note shown.
 */
const REASK_MS = 15_000;

/** The most places of one note whose answers are kept while it is shown. */
const MAX_KEPT_ANSWERS = 16;

export class RecommendedPanel {
  private source: string | null = null;
  /** The place in the note shown: its section, or the end (`placeKey`). */
  private place = "";
  /** Each place's answer for the note shown, and when each was last asked for. */
  private answers = new Map<string, Recommendation>();
  private asks = new Map<string, number>();
  /** The last answer that landed for the note shown, whatever its place: shown
   *  for a new place until its own arrives, rather than the links alone. */
  private latest: Recommendation | null = null;
  /** Which request is the latest, so an older answer cannot land on a newer note. */
  private asked = 0;
  /** Under the note only: folded away by a press on its heading. Not kept:
   *  the next note opens with the list shown. */
  private collapsed = false;
  /**
   * What the last draw showed, as one string.
   *
   * A vault change rarely changes this note's list, and drawing it again
   * anyway threw away the scroll and the keyboard focus under a person
   * reading it — every time the note being typed in was saved.
   */
  private drawn: string | null = null;
  /** The note that draw was for, to tell a redraw from another note. */
  private drawnPath: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: RecommendedHost,
    /** `heading`: the note's title over the list (the sidebar); without it,
     *  a section heading with the count (under the note). `place`: where in
     *  the note the meaning half ranks from. */
    private readonly opts: { heading: boolean; place: RecommendPlace } = {
      heading: true,
      place: "cursor"
    }
  ) {}

  /** Show what belongs with `path`, or the empty state for no note. */
  show(path: string | null): void {
    if (path !== this.source) {
      this.answers.clear();
      this.asks.clear();
      this.latest = null;
      this.collapsed = false;
    }
    this.source = path;
    this.place = path === null ? "" : (this.host.placeKey?.(path, this.opts.place) ?? "");
    this.draw();
    if (path !== null) this.ask(path);
  }

  /** Something in the vault changed: ask again for the note shown. */
  refresh(): void {
    this.show(this.source);
  }

  /**
   * The place in the note may have moved — the cursor went somewhere else.
   * Asks only when it is in another section than before.
   */
  refocus(): void {
    const path = this.source;
    if (path === null) return;
    const place = this.host.placeKey?.(path, this.opts.place) ?? "";
    if (place === this.place) return;
    this.place = place;
    this.draw();
    this.ask(path);
  }

  private ask(path: string): void {
    const recommend = this.host.recommend;
    if (!recommend) return;
    const place = this.place;
    const now = Date.now();
    const asked = this.asks.get(place);
    if (asked !== undefined && now - asked < REASK_MS) return;
    this.asks.set(place, now);
    const token = ++this.asked;
    recommend(path, this.opts.place)
      .then((value) => {
        if (this.source !== path || value === null) return;
        this.keep(place, value);
        // An older answer for this place does not replace a newer one on screen.
        if (token === this.asked) this.latest = value;
        if (place === this.place) this.draw();
      })
      // The graph's answer is already on screen; a meaning search that failed
      // leaves it there, and the next change asks again.
      .catch((e: unknown) => {
        this.host.warn?.("recommended: the answer for the open note failed", e);
        if (this.source === path) this.asks.delete(place);
      });
  }

  /** A place's answer, kept for the note shown; the oldest goes past the limit. */
  private keep(place: string, value: Recommendation): void {
    this.answers.delete(place);
    this.answers.set(place, value);
    if (this.answers.size > MAX_KEPT_ANSWERS) {
      const oldest = this.answers.keys().next().value;
      if (oldest !== undefined) this.answers.delete(oldest);
    }
  }

  private draw(): void {
    const root = this.root;
    const labels = t().explorer.related;
    const path = this.source;
    // A note the vault no longer holds has nothing to belong with.
    const title = path === null ? null : this.host.titleOf(path);

    const items =
      path === null || title === null
        ? []
        : (
            this.answers.get(this.place)?.items ??
            this.latest?.items ??
            this.host.links(path, this.opts.place)
          ).slice(0, this.host.count());

    const signature = JSON.stringify([path, title, this.collapsed, items]);
    if (signature === this.drawn) return;
    const sameNote = this.drawn !== null && path !== null && this.drawnPath === path;
    this.drawn = signature;
    this.drawnPath = path;

    // The scroller is the sidebar's own content or, under the note, the note's.
    const scroller = root.closest<HTMLElement>(".view-content") ?? root;
    const scrollTop = scroller.scrollTop;
    const focused = root.ownerDocument.activeElement;
    const focusedKey =
      isElementLike(focused) && root.contains(focused)
        ? (focused.closest("[data-key]")?.getAttribute("data-key") ?? null)
        : null;

    root.empty();
    this.drawInto(root, labels, path, title, items);

    // The same note drawn again keeps its place; another note starts at the top.
    if (sameNote) scroller.scrollTop = scrollTop;
    if (focusedKey !== null) {
      root.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus();
    }
  }

  private drawInto(
    root: HTMLElement,
    labels: ReturnType<typeof t>["explorer"]["related"],
    path: string | null,
    title: string | null,
    items: RecommendedItem[]
  ): void {
    if (path === null || title === null) {
      root.createDiv({ cls: "schreibstube-related-empty", text: labels.viewNoNote });
      return;
    }
    const total = items.length;

    if (this.opts.heading) {
      const header = root.createDiv({ cls: "schreibstube-related-header" });
      // The heading is the note the list is about, and opens it: kept on one
      // note, the panel is otherwise the only way back to it.
      const heading = header.createDiv({
        cls: "schreibstube-related-title",
        text: title,
        attr: {
          role: "link",
          tabindex: "0",
          title: labels.openSource,
          "data-key": `source:${path}`
        }
      });
      this.pressable(heading, (event) => {
        void this.host.open(path, openTargetOf(Keymap.isModEvent(event)));
      });
      header.createDiv({ cls: "schreibstube-related-summary", text: labels.summary(total) });
    } else {
      // Under the note the note is the title; the heading names the section,
      // counts it in the task pill the Explorer counts tasks in, and folds it.
      const section = root.createDiv({
        cls: "schreibstube-related-section",
        attr: {
          "data-key": "section",
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
    // One picture in the list gives every row the thumbnail's column, so the
    // meters stand in one column whatever each row ends in.
    list.toggleClass(
      "has-pictures",
      items.some((item) => item.kind === "picture")
    );
    for (const item of items) {
      if (item.kind === "note") this.renderCard(list, item.card);
      else if (item.kind === "picture") this.renderPicture(list, item.picture);
      else this.renderItem(list, item.item);
    }
    this.measureGround();
  }

  /**
   * Find the colour painted behind the list, for the fade under an entry's
   * actions where they lie over its title.
   *
   * Which variable that is depends on where the list sits — under the note,
   * in a desktop sidebar, in a phone's drawer — and on what the theme does to
   * each; the Explorer's sticky headers learned that a guessed one shows as a
   * band. So it is read off the ancestors, as the Explorer reads its own (see
   * ground-colour). A host calls it again when the theme changes.
   */
  measureGround(): void {
    const layers: string[] = [];
    let element: HTMLElement | null = this.root;
    while (element) {
      layers.push(getComputedStyle(element).backgroundColor);
      element = element.parentElement;
    }
    const colour = groundColour(layers);
    if (colour) this.root.style.setProperty("--schreibstube-related-ground", colour);
    else this.root.style.removeProperty("--schreibstube-related-ground");
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
      reasons: readonly RecommendReason[];
      glyph: string;
      path?: string;
      kind?: string;
      /** What the entry is, to find it again after a redraw. */
      key: string;
      /** Which floors its likeness is read against. */
      floors: "file" | "item";
    }
  ): HTMLElement {
    const el = list.createEl("li").createDiv({
      cls: row.kind ? `schreibstube-related-card ${row.kind}` : "schreibstube-related-card",
      attr: { role: "link", tabindex: "0", "data-key": row.key }
    });
    if (row.path !== undefined) el.setAttribute("title", row.path);
    // The line under the title says the same in words, for a screen reader too.
    applyIcon(el.createSpan({ cls: "schreibstube-related-glyph" }), row.glyph);
    const text = el.createDiv({ cls: "schreibstube-related-card-text" });
    text.createDiv({ cls: "schreibstube-related-card-title", text: row.title });
    const meta = text.createDiv({ cls: "schreibstube-related-card-meta" });
    meta.createSpan({ cls: "schreibstube-related-card-folder", text: row.what });
    // Two reasons at most: the third is never what made the difference.
    const why = row.reasons.slice(0, 2).map(reasonLabel);
    if (why.length > 0) {
      meta.createSpan({ cls: "schreibstube-related-card-why", text: why.join(" · ") });
    }
    this.relevance(el, row.reasons, row.floors);
    return el;
  }

  /**
   * How relevant the entry is, as a meter of three bars at its end.
   *
   * The order said only which entry was more relevant than the next, never
   * whether any of them was relevant at all: the first of seven weak entries
   * looked like the first of seven strong ones. The level comes from the
   * evidence (`relevanceOf`), and pointing at the meter, or a screen reader,
   * says the level and every reason in words — the line under the title has
   * room for two.
   */
  private relevance(
    el: HTMLElement,
    reasons: readonly RecommendReason[],
    kind: "file" | "item"
  ): void {
    const labels = t().explorer.related;
    const level = relevanceOf(reasons, this.floors(kind));
    const said = labels.relevanceTitle(
      labels.relevance[level],
      reasons.map(reasonLabel).join(", ")
    );
    const meter = el.createSpan({
      cls: "schreibstube-related-relevance",
      attr: { role: "img", "aria-label": said, title: said, "data-level": level }
    });
    for (let bar = 1; bar <= 3; bar++) {
      meter.createSpan({
        cls:
          bar <= RELEVANCE_BARS[level]
            ? "schreibstube-related-bar is-lit"
            : "schreibstube-related-bar"
      });
    }
  }

  private floors(kind: "file" | "item"): RelevanceFloors {
    const given = this.host.relevanceFloors?.(kind);
    if (given) return given;
    // Without search by meaning there is no likeness to read; the default
    // model's floors keep the rule whole.
    const model = embeddingModelConfig(DEFAULT_EMBEDDING_MODEL_ID);
    const floors = kind === "item" ? model.conversationFloors : model.relatedFloors;
    return { balanced: floors[DEFAULT_SIMILARITY_PRESET], strict: floors.strict };
  }

  /**
   * The entry's actions, just before its meter: its Obsidian URL, and for a
   * file a pane of its own to the right. Shown under the pointer, and always
   * where there is none to hover with. They lie over the end of the title
   * rather than take a column of their own, so the meters stand in one column
   * and no title is narrowed for buttons that are mostly hidden. A press on
   * either is the button's alone and never also opens the entry.
   */
  private actions(el: HTMLElement, link: EntryLink | null): void {
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
    if (link) action(labels.copyLink, ["lucide-link"], "link", () => this.host.copyLink(link));
    if (link?.kind === "file") {
      // Obsidian's own icon for its own "Open to the right".
      action(labels.openBeside, ["lucide-separator-vertical"], "external-link", () => {
        void this.host.open(link.path, "split");
      });
    }
  }

  /**
   * Press, Enter or Space opens; a modifier opens beside, as a link does. A
   * middle click is a click too, which Obsidian reads as a tab; the browser
   * reports it as `auxclick`, and it did nothing here.
   */
  private pressable(el: HTMLElement, open: (event: MouseEvent | KeyboardEvent) => void): void {
    el.addEventListener("click", (event) => open(event));
    el.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      open(event);
    });
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open(event);
    });
  }

  private renderCard(list: HTMLElement, card: RelatedCard): void {
    const el = this.renderRow(list, {
      title: card.title,
      what: card.folder.length > 0 ? card.folder : t().explorer.rootFolder,
      reasons: card.reasons,
      glyph: this.host.glyphOf(card.path),
      path: card.path,
      key: `file:${card.path}`,
      floors: "file"
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
      reasons: picture.reasons,
      glyph: this.host.glyphOf(picture.path),
      path: picture.path,
      kind: "is-picture",
      key: `file:${picture.path}`,
      floors: "file"
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

  private renderItem(list: HTMLElement, item: ItemCard): void {
    const el = this.renderRow(list, {
      title: item.title,
      what: item.label,
      reasons: item.reasons,
      glyph: item.icon ?? ITEM_FALLBACK_ICON,
      kind: "is-item",
      key: item.key,
      floors: "item"
    });
    this.actions(el, item.linkable ? { kind: "item", key: item.key } : null);
    this.pressable(el, () => this.host.openItem(item.key));
  }
}

/** What a reason says on an entry's line. */
function reasonLabel(reason: RecommendReason): string {
  const labels = t().explorer.related.reasons;
  switch (reason.kind) {
    case "link":
      return labels.link;
    case "backlink":
      return labels.backlink;
    case "attached":
      return labels.attached;
    case "meaning":
      return labels.meaning(similarityPercent(reason.similarity));
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
