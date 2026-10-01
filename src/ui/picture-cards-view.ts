/**
 * A layout for Bases: each row as its picture, opening the article the
 * picture appears in.
 *
 * Obsidian's own cards open the row a card stands for. A base of starred
 * pictures lists their description notes, since that is where a star is
 * kept, so every card there led to a description nobody wanted to read.
 * Here a card shows the picture and a press opens the note the picture is
 * in, in Reading view unless the layout's settings say otherwise; a picture
 * in several notes offers them, and one in none opens itself. The base
 * still decides what is listed and in what order: its filter, sort and
 * grouping are drawn as they come.
 *
 * It draws and reports. What a row stands for, which notes count and what a
 * press does are decided in `services/picture-cards`; the vault is asked
 * through the controller.
 */
import { BasesView, Keymap, Menu, type QueryController } from "obsidian";
import { t } from "../i18n";
import { basename } from "../services/file-name";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import {
  cardPress,
  opensInReadingView,
  pictureCardGroups,
  READING_VIEW_OPTION,
  type PictureCard,
  type PictureCardSources
} from "../services/picture-cards";
import { wirePress } from "./explorer-gestures";
import { pressKeys } from "./pressable";

export const PICTURE_CARDS_VIEW_TYPE = "schreibstube-picture-cards";

export interface PictureCardsHost {
  sources(): PictureCardSources;
  title(path: string): string;
  resourceUrl(path: string): string | null;
  openArticle(path: string, where: PaneTarget, reading: boolean): Promise<void>;
  openFile(path: string, where: PaneTarget): Promise<void>;
}

type MenuPlace = MouseEvent | { x: number; y: number };

/** A card as drawn, and what it was drawn from. */
interface DrawnCard {
  el: HTMLElement;
  /** Everything the element shows or its presses use, so an equal one can stay. */
  signature: string;
}

export class PictureCardsView extends BasesView {
  readonly type = PICTURE_CARDS_VIEW_TYPE;
  /** Ours, inside the container Bases hands over: switching to another
   *  layout takes this away and leaves the container as it was. */
  private readonly root: HTMLElement;
  /**
   * Last drawing's cards, by picture. A base redraws whenever a listed row
   * changes, a star or a word in a listed note; a card that would come out
   * the same keeps its element, and with it a picture already decoded, so
   * the grid does not blink and a phone does not decode it again.
   */
  private drawn = new Map<string, DrawnCard>();

  constructor(
    controller: QueryController,
    parentEl: HTMLElement,
    private readonly host: PictureCardsHost
  ) {
    super(controller);
    this.root = parentEl.createDiv({ cls: "schreibstube-picture-cards" });
  }

  override onunload(): void {
    this.drawn.clear();
    this.root.detach();
  }

  onDataUpdated(): void {
    this.render();
  }

  private render(): void {
    const root = this.root;
    const labels = t().pictureCards;
    const groups = this.data.groupedData;
    const result = pictureCardGroups(
      groups.map((group) => group.entries.map((entry) => entry.file.path)),
      this.host.sources()
    );

    const previous = this.drawn;
    this.drawn = new Map();
    root.empty();

    groups.forEach((group, index) => {
      const cards = result.groups[index] ?? [];
      if (cards.length === 0) return;
      if (group.hasKey()) {
        root.createDiv({
          cls: "schreibstube-picture-cards-group",
          text: group.key?.toString() ?? ""
        });
      }
      const grid = root.createDiv({ cls: "schreibstube-picture-cards-grid" });
      for (const card of cards) this.placeCard(grid, card, previous);
    });

    if (this.drawn.size === 0) {
      root.createDiv({ cls: "schreibstube-picture-cards-note", text: labels.empty });
    }
    if (result.held > 0) {
      root.createDiv({ cls: "schreibstube-picture-cards-note", text: labels.more(result.held) });
    }
    // A base with no filter lists every note; saying what was left out is
    // how a person learns that this layout wants pictures.
    if (result.skipped > 0) {
      root.createDiv({
        cls: "schreibstube-picture-cards-note",
        text: labels.skipped(result.skipped)
      });
    }
  }

  /** The card's element from last time when nothing on it changed, else a new one. */
  private placeCard(grid: HTMLElement, card: PictureCard, previous: Map<string, DrawnCard>): void {
    const titles = card.articles.map((path) => this.host.title(path));
    const url = this.host.resourceUrl(card.picture);
    const signature = JSON.stringify([card, titles, url]);
    const kept = previous.get(card.picture);
    if (kept && kept.signature === signature) {
      grid.appendChild(kept.el);
      this.drawn.set(card.picture, kept);
      return;
    }
    this.drawn.set(card.picture, { el: this.renderCard(grid, card, titles, url), signature });
  }

  private renderCard(
    grid: HTMLElement,
    card: PictureCard,
    titles: readonly string[],
    url: string | null
  ): HTMLElement {
    const labels = t().pictureCards;
    const [first] = titles;
    const name = first ?? basename(card.picture);
    const el = grid.createDiv({
      cls: "schreibstube-picture-card",
      attr: { role: "button", tabindex: "0", "aria-label": name, title: name }
    });

    const frame = el.createDiv({ cls: "schreibstube-picture-card-image" });
    if (url === null) {
      frame.addClass("is-missing");
      frame.createSpan({ text: basename(card.picture) });
    } else {
      // Lazy, as in the folder grid: the frame is sized by the stylesheet, so
      // the browser knows which cards are in view without loading them.
      const img = frame.createEl("img", { attr: { src: url, alt: name } });
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
    }

    // No caption for a picture in no article: a name there would read as a
    // link to somewhere, and there is nowhere.
    if (first !== undefined) {
      const caption = el.createDiv({ cls: "schreibstube-picture-card-caption" });
      caption.createSpan({ cls: "schreibstube-picture-card-title", text: first });
      if (titles.length > 1) {
        caption.createSpan({
          cls: "schreibstube-picture-card-more",
          text: labels.moreArticles(titles.length - 1)
        });
      }
    }

    wirePress(el, {
      isDragging: () => false,
      activate: (event) => this.press(card, el, event),
      showMenu: (at) => this.showMenu(card, at)
    });
    pressKeys(el, (event) => this.press(card, el, event));
    return el;
  }

  /** Read at the press, so a toggle changed while the base is open counts at once. */
  private readingView(): boolean {
    return opensInReadingView(this.config.get(READING_VIEW_OPTION));
  }

  private press(card: PictureCard, el: HTMLElement, event?: MouseEvent | KeyboardEvent): void {
    const where = targetOf(event);
    const action = cardPress(card);
    if (action.kind === "article") {
      void this.host.openArticle(action.path, where, this.readingView());
    } else if (action.kind === "picture") {
      void this.host.openFile(action.path, where);
    } else {
      const menu = new Menu();
      for (const path of action.paths) this.addArticle(menu, path);
      show(menu, isMouseEvent(event) ? event : below(el));
    }
  }

  /**
   * The long press and the right click: every note the picture is in, then
   * the picture and its description — the description is where the star is
   * taken off again, so it is offered whenever the picture has one, not only
   * when the base listed the description rather than the picture.
   */
  private showMenu(card: PictureCard, at: MenuPlace): void {
    const labels = t().pictureCards;
    const menu = new Menu();
    for (const path of card.articles) this.addArticle(menu, path);
    if (card.articles.length > 0) menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(labels.openPicture)
        .setIcon("image")
        .onClick((chosen) => void this.host.openFile(card.picture, targetOf(chosen)))
    );
    const description = card.description;
    if (description !== null) {
      menu.addItem((item) =>
        item
          .setTitle(labels.openDescription)
          .setIcon("sparkles")
          .onClick((chosen) => void this.host.openFile(description, targetOf(chosen)))
      );
    }
    show(menu, at);
  }

  /** An article in a menu, opened where the press on the item asks. */
  private addArticle(menu: Menu, path: string): void {
    menu.addItem((item) =>
      item
        .setTitle(this.host.title(path))
        .setIcon("file-text")
        .onClick((chosen) => {
          void this.host.openArticle(path, targetOf(chosen), this.readingView());
        })
    );
  }
}

/** Obsidian's reading of a press: in place, or the tab, split or window its modifiers ask for. */
function targetOf(event: MouseEvent | KeyboardEvent | undefined): PaneTarget {
  return openTargetOf(Keymap.isModEvent(event));
}

/** Not `instanceof`: a press in a pop-out window is that window's MouseEvent. */
function isMouseEvent(event: unknown): event is MouseEvent {
  return typeof event === "object" && event !== null && "clientX" in event && "button" in event;
}

/** Where a menu opened from the keyboard goes: under the card. */
function below(el: HTMLElement): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.bottom };
}

function show(menu: Menu, at: MenuPlace): void {
  if (isMouseEvent(at)) menu.showAtMouseEvent(at);
  else menu.showAtPosition(at);
}
