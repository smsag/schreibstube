/**
 * A layout for Bases: each row as its picture, opening the article the
 * picture appears in.
 *
 * Obsidian's own cards open the row a card stands for. A base of starred
 * pictures lists their description notes, since that is where a star is
 * kept, so every card there led to a description nobody wanted to read.
 * Here a card shows the picture and a press opens the note the picture is
 * in, in Reading view unless the layout's settings say otherwise; a picture
 * in several notes offers them, and one in none opens itself. The base still decides what is listed and in what
 * order: its filter, sort and grouping are drawn as they come.
 *
 * It draws and reports. What a row stands for, which notes count and what a
 * press does are decided in `services/picture-cards`; the vault is asked
 * through the controller.
 */
import { BasesView, Keymap, Menu, type QueryController } from "obsidian";
import { t } from "../i18n";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import {
  cardPress,
  MAX_PICTURE_CARDS,
  opensInReadingView,
  pictureCards,
  READING_VIEW_OPTION,
  type PictureCard,
  type PictureCardSources
} from "../services/picture-cards";
import { basename } from "../services/file-name";
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

export class PictureCardsView extends BasesView {
  readonly type = PICTURE_CARDS_VIEW_TYPE;
  /** Ours, inside the container Bases hands over: switching to another
   *  layout takes this away and leaves the container as it was. */
  private readonly root: HTMLElement;

  constructor(
    controller: QueryController,
    parentEl: HTMLElement,
    private readonly host: PictureCardsHost
  ) {
    super(controller);
    this.root = parentEl.createDiv({ cls: "schreibstube-picture-cards" });
  }

  override onunload(): void {
    this.root.detach();
  }

  onDataUpdated(): void {
    this.render();
  }

  private render(): void {
    const root = this.root;
    root.empty();
    const labels = t().pictureCards;
    const sources = this.host.sources();

    // One budget across the groups: the limit is about how many pictures a
    // page holds, not how many each group may have.
    let budget = MAX_PICTURE_CARDS;
    let drawn = 0;
    let held = 0;
    let skipped = 0;

    for (const group of this.data.groupedData) {
      const rows = group.entries.map((entry) => entry.file.path);
      const result = pictureCards(rows, sources, budget);
      budget -= result.cards.length;
      held += result.held;
      skipped += result.skipped;
      if (result.cards.length === 0) continue;

      if (group.hasKey()) {
        root.createDiv({
          cls: "schreibstube-picture-cards-group",
          text: group.key?.toString() ?? ""
        });
      }
      const grid = root.createDiv({ cls: "schreibstube-picture-cards-grid" });
      for (const card of result.cards) this.renderCard(grid, card);
      drawn += result.cards.length;
    }

    if (drawn === 0) {
      root.createDiv({ cls: "schreibstube-picture-cards-note", text: labels.empty });
    }
    if (held > 0) {
      root.createDiv({ cls: "schreibstube-picture-cards-note", text: labels.more(held) });
    }
    // A base with no filter lists every note; saying what was left out is
    // how a person learns that this layout wants pictures.
    if (skipped > 0) {
      root.createDiv({ cls: "schreibstube-picture-cards-note", text: labels.skipped(skipped) });
    }
  }

  private renderCard(grid: HTMLElement, card: PictureCard): void {
    const labels = t().pictureCards;
    const [first] = card.articles;
    const name = first === undefined ? basename(card.picture) : this.host.title(first);
    const el = grid.createDiv({
      cls: "schreibstube-picture-card",
      attr: { role: "button", tabindex: "0", "aria-label": name, title: name }
    });

    const frame = el.createDiv({ cls: "schreibstube-picture-card-image" });
    const url = this.host.resourceUrl(card.picture);
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
      caption.createSpan({ cls: "schreibstube-picture-card-title", text: name });
      if (card.articles.length > 1) {
        caption.createSpan({
          cls: "schreibstube-picture-card-more",
          text: labels.moreArticles(card.articles.length - 1)
        });
      }
    }

    wirePress(el, {
      isDragging: () => false,
      activate: (event) => this.press(card, el, event),
      showMenu: (at) => this.showMenu(card, at)
    });
    pressKeys(el, (event) => this.press(card, el, event));
  }

  /** Read at the press, so a toggle changed while the base is open counts at once. */
  private readingView(): boolean {
    return opensInReadingView(this.config.get(READING_VIEW_OPTION));
  }

  private press(card: PictureCard, el: HTMLElement, event?: MouseEvent | KeyboardEvent): void {
    const where = openTargetOf(Keymap.isModEvent(event));
    const action = cardPress(card);
    if (action.kind === "article") {
      void this.host.openArticle(action.path, where, this.readingView());
    } else if (action.kind === "picture") {
      void this.host.openFile(action.path, where);
    } else {
      const menu = new Menu();
      for (const path of action.paths) {
        menu.addItem((item) =>
          item
            .setTitle(this.host.title(path))
            .setIcon("file-text")
            .onClick((chosen) => {
              void this.host.openArticle(
                path,
                openTargetOf(Keymap.isModEvent(chosen)),
                this.readingView()
              );
            })
        );
      }
      show(menu, isMouseEvent(event) ? event : below(el));
    }
  }

  /**
   * The long press and the right click: every note the picture is in, then
   * the picture and its description — the description is where the star is
   * taken off again.
   */
  private showMenu(card: PictureCard, at: MenuPlace): void {
    const labels = t().pictureCards;
    const menu = new Menu();
    for (const path of card.articles) {
      menu.addItem((item) =>
        item
          .setTitle(this.host.title(path))
          .setIcon("file-text")
          .onClick(() => void this.host.openArticle(path, false, this.readingView()))
      );
    }
    if (card.articles.length > 0) menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(labels.openPicture)
        .setIcon("image")
        .onClick(() => void this.host.openFile(card.picture, false))
    );
    if (card.entry !== card.picture) {
      menu.addItem((item) =>
        item
          .setTitle(labels.openDescription)
          .setIcon("sparkles")
          .onClick(() => void this.host.openFile(card.entry, false))
      );
    }
    show(menu, at);
  }
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
