/**
 * Schreibstube's buttons on the bar Obsidian shows over a picture in Live
 * Preview: open or start the picture's description, and star it.
 *
 * The bar has no API. Obsidian builds it with the picture and builds it again
 * whenever the picture is drawn anew, so the buttons are put in at the moment
 * the bar is about to be seen: the pointer reaching the picture, or a finger
 * touching it. Nothing watches the editor, so typing costs nothing; and the
 * buttons are drawn from the description as it is at that moment, so a
 * picture described elsewhere offers its note the next time it is pointed at.
 *
 * Which buttons a picture gets is decided in `services/picture-embed-actions`;
 * finding the bar is `workspace-internals`' business.
 */
import { Keymap, setIcon, setTooltip, TFile, type App } from "obsidian";
import { t } from "../i18n";
import { getImageMimeType } from "../services/image-resize";
import { DESCRIPTION_KEYS } from "../services/image-description";
import type { Logger } from "../services/logger";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import {
  embedLinkpath,
  isFavorite,
  pictureActionState,
  type PictureActionState
} from "../services/picture-embed-actions";
import {
  embedActionsOf,
  embedSourceOf,
  fileShownAround,
  imageEmbedAround,
  isElementLike
} from "../services/workspace-internals";

export interface PictureEmbedHooks {
  /** The note describing a picture, if it has one. */
  descriptionNoteOf(imagePath: string): string | null;
  /** Describe a picture; says for itself what happened. */
  describe(picture: TFile): Promise<void>;
  /** Whether the person has picture descriptions switched on. */
  describingEnabled(): boolean;
  open(note: TFile, where: PaneTarget): Promise<void>;
}

type Register = (doc: Document, type: string, handler: (event: Event) => void) => void;

const ACTION_CLASS = "schreibstube-embed-action";
const DESCRIBE_CLASS = "schreibstube-embed-describe";
const FAVORITE_CLASS = "schreibstube-embed-favorite";

export class PictureEmbedActions {
  private readonly documents = new Set<Document>();
  /** Pictures being described from their bar, so a second press waits for the first. */
  private readonly describing = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly hooks: PictureEmbedHooks,
    private readonly logger: Logger
  ) {}

  attach(win: Window, register: Register): void {
    const doc = win.document;
    this.documents.add(doc);
    register(doc, "mouseover", (event) => this.decorateAt(event.target));
    register(doc, "pointerdown", (event) => this.decorateAt(event.target));
    register(doc, "click", (event) => this.onPress(event));
    register(doc, "keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") this.onPress(event);
    });
  }

  detach(win: Window): void {
    this.documents.delete(win.document);
  }

  stop(): void {
    for (const doc of this.documents) {
      for (const el of Array.from(doc.querySelectorAll(`.${ACTION_CLASS}`))) el.remove();
    }
    this.documents.clear();
  }

  private decorateAt(target: EventTarget | null): void {
    const embed = imageEmbedAround(target);
    if (!embed) return;
    const bar = embedActionsOf(embed);
    if (!bar) return;
    const picture = this.pictureOf(embed);
    this.draw(bar, picture ? this.stateOf(picture) : { describe: null, favorite: null });
  }

  /**
   * The description button first in the bar and the star after it, so
   * Obsidian's own keep their place at its edge. A button whose state is
   * unchanged is left alone, since the pointer crossing the picture asks again
   * with every element it enters.
   */
  private draw(bar: HTMLElement, state: PictureActionState): void {
    const describe = this.button(bar, DESCRIBE_CLASS, state.describe !== null);
    if (describe && state.describe !== null) {
      this.paint(
        describe,
        state.describe,
        state.describe === "open" ? "sparkles" : "wand-sparkles",
        state.describe === "open" ? t().pictureActions.open : t().pictureActions.describe
      );
    }
    const favorite = this.button(bar, FAVORITE_CLASS, state.favorite !== null);
    if (favorite && state.favorite !== null) {
      this.paint(
        favorite,
        state.favorite ? "on" : "off",
        "star",
        state.favorite ? t().pictureActions.unfavorite : t().pictureActions.favorite
      );
      favorite.classList.toggle("is-favorite", state.favorite);
      favorite.setAttribute("aria-pressed", String(state.favorite));
    }

    let anchor: HTMLElement | null = null;
    for (const el of [describe, favorite]) {
      if (!el) continue;
      const place: Element | null = anchor ? anchor.nextElementSibling : bar.firstElementChild;
      if (place !== el) {
        if (anchor) anchor.after(el);
        else bar.prepend(el);
      }
      anchor = el;
    }
  }

  /** The button of this kind in the bar, made if missing; null, and taken out, when not wanted. */
  private button(bar: HTMLElement, className: string, wanted: boolean): HTMLElement | null {
    const existing = bar.querySelector(`.${className}`);
    if (!wanted) {
      existing?.remove();
      return null;
    }
    if (isElementLike(existing)) return existing;
    const el = bar.ownerDocument.createElement("div");
    // Obsidian's own class for the bar's buttons, so they look and behave as
    // its zoom and "edit block" do; ours for finding them again.
    el.className = `embed-action ${ACTION_CLASS} ${className}`;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    return el;
  }

  private paint(el: HTMLElement, state: string, icon: string, label: string): void {
    if (el.dataset.state === state) return;
    el.dataset.state = state;
    setIcon(el, icon);
    setTooltip(el, label);
    el.setAttribute("aria-label", label);
  }

  private onPress(event: Event): void {
    const target = event.target;
    if (!isElementLike(target)) return;
    const button = target.closest(`.${ACTION_CLASS}`);
    if (!isElementLike(button)) return;
    // Ours alone: the editor must not take the press as a click on the picture.
    event.preventDefault();
    event.stopPropagation();
    const embed = imageEmbedAround(button);
    const picture = embed ? this.pictureOf(embed) : null;
    if (!embed || !picture) return;

    if (button.classList.contains(DESCRIBE_CLASS)) {
      void this.describeOrOpen(picture, event, embed);
    } else if (button.classList.contains(FAVORITE_CLASS)) {
      void this.toggleFavorite(picture, button);
    }
  }

  private async describeOrOpen(picture: TFile, event: Event, embed: HTMLElement): Promise<void> {
    const opened = await this.describeOrOpenPicture(picture, event);
    // The note is read by the metadata cache a moment after it is written; the
    // bar is drawn from it on the next look, and once now in case it is ready.
    if (!opened) this.decorateAt(embed);
  }

  /**
   * The buttons a picture gets now, for a surface that draws its own: the
   * slideshow, which has no bar of Obsidian's to join.
   */
  stateFor(picture: TFile): PictureActionState {
    return this.stateOf(picture);
  }

  /**
   * Open the picture's description where the press asks, or write one when it
   * has none and describing is on. Answers whether a note was opened, so a
   * surface knows to draw its buttons again after a description was written.
   */
  async describeOrOpenPicture(picture: TFile, event: Event): Promise<boolean> {
    const note = this.noteOf(picture);
    if (note) {
      // Not `instanceof`: an event from a pop-out window is that window's MouseEvent.
      await this.hooks.open(note, openTargetOf(Keymap.isModEvent(event as MouseEvent)));
      return true;
    }
    if (!this.hooks.describingEnabled() || this.describing.has(picture.path)) return false;
    this.describing.add(picture.path);
    try {
      await this.hooks.describe(picture);
    } finally {
      this.describing.delete(picture.path);
    }
    return false;
  }

  /**
   * Turn the star over in the description note. The button shows the new
   * state at once rather than when the metadata cache has read the write.
   */
  private async toggleFavorite(picture: TFile, button: HTMLElement): Promise<void> {
    const now = await this.toggleFavoriteOf(picture);
    const bar = button.parentElement;
    if (bar && now !== null) this.draw(bar, { describe: "open", favorite: now });
  }

  /**
   * Turn the star over in the picture's description note, and answer how it
   * stands now: the button shows that at once rather than when the metadata
   * cache has read the write. Null when the picture has no note or the write
   * failed.
   */
  async toggleFavoriteOf(picture: TFile): Promise<boolean | null> {
    const note = this.noteOf(picture);
    if (!note) return null;
    let now = false;
    try {
      await this.app.fileManager.processFrontMatter(
        note,
        (frontmatter: Record<string, unknown>) => {
          now = !isFavorite(frontmatter[DESCRIPTION_KEYS.favorite]);
          frontmatter[DESCRIPTION_KEYS.favorite] = now;
        }
      );
    } catch (error) {
      this.logger.warn(`Could not star ${note.path}:`, error);
      return null;
    }
    return now;
  }

  private stateOf(picture: TFile): PictureActionState {
    const note = this.noteOf(picture);
    const frontmatter = note ? this.app.metadataCache.getFileCache(note)?.frontmatter : undefined;
    return pictureActionState({
      described: note !== null,
      describingEnabled:
        this.hooks.describingEnabled() && getImageMimeType(picture.extension) !== null,
      favorite: frontmatter?.[DESCRIPTION_KEYS.favorite]
    });
  }

  private noteOf(picture: TFile): TFile | null {
    const path = this.hooks.descriptionNoteOf(picture.path);
    return path ? this.app.vault.getFileByPath(path) : null;
  }

  /** The vault picture an embed shows, resolved from the note it is in. */
  private pictureOf(embed: HTMLElement): TFile | null {
    const link = embedLinkpath(embedSourceOf(embed));
    if (!link) return null;
    const from = fileShownAround(this.app, embed)?.path ?? "";
    const file = this.app.metadataCache.getFirstLinkpathDest(link, from);
    return file instanceof TFile ? file : null;
  }
}
