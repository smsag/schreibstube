/**
 * The bands beside a card's picture, when a base fits its pictures whole,
 * painted in the colour of the picture's edge instead of the theme's grey.
 *
 * Obsidian draws each picture as its card's background and changes it as
 * the cards scroll and are reused, swapping a picture for a smaller copy
 * once it has made one. So each base's results are watched, never the
 * whole document, and a card is painted again whenever the picture it
 * draws changes. The colour is decided in `services/cover-backdrop`; here
 * a picture is only read into pixels, once per address.
 */
import { COVER_SAMPLE_PX, coverImageUrl, edgeColor } from "../services/cover-backdrop";
import { scaleDimensions } from "../services/image-resize";
import {
  basesCoversIn,
  basesResultsIn,
  coverBackdropProperty,
  isElementLike
} from "../services/workspace-internals";
import { withTimeout } from "../utils/with-timeout";

/** A base opens before its results are drawn; a second look catches a slow one. */
const LATE_LOOK_MS = 300;

/** A picture that has not loaded by then keeps the theme's band. */
const LOAD_TIMEOUT_MS = 10_000;

/** Colours remembered, by address; a smaller copy of a picture has its own. */
const MAX_COLOURS = 200;

export type EdgeReader = (url: string) => Promise<string | null>;

export class CoverBackdrops {
  private readonly documents = new Set<Document>();
  /** One watch per base's results on screen; dropped once it is gone. */
  private readonly watches = new Map<HTMLElement, MutationObserver>();
  private readonly colours = new Map<string, Promise<string | null>>();
  /** The picture each card was last painted for, so a repaint of the same one costs nothing. */
  private painted = new WeakMap<HTMLElement, string | null>();
  private lateTimer = 0;

  constructor(private readonly read: EdgeReader = readEdgeColor) {}

  attach(win: Window): void {
    this.documents.add(win.document);
    this.watch(win.document);
  }

  detach(win: Window): void {
    this.documents.delete(win.document);
  }

  stop(): void {
    window.clearTimeout(this.lateTimer);
    for (const observer of this.watches.values()) observer.disconnect();
    this.watches.clear();
    for (const doc of this.documents) {
      for (const cover of basesCoversIn(doc)) {
        const property = coverBackdropProperty(cover);
        if (property) cover.style.removeProperty(property);
      }
    }
    this.documents.clear();
    this.painted = new WeakMap();
  }

  /** Look for bases again, now and once more when a slow one has drawn. */
  watchSoon(): void {
    for (const doc of this.documents) this.watch(doc);
    window.clearTimeout(this.lateTimer);
    this.lateTimer = window.setTimeout(() => {
      for (const doc of this.documents) this.watch(doc);
    }, LATE_LOOK_MS);
  }

  private watch(doc: Document): void {
    for (const [results, observer] of this.watches) {
      if (results.isConnected) continue;
      observer.disconnect();
      this.watches.delete(results);
    }
    for (const results of basesResultsIn(doc)) {
      if (!this.watches.has(results)) {
        const observer = new MutationObserver((records) => this.changed(records));
        observer.observe(results, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["style"]
        });
        this.watches.set(results, observer);
      }
      for (const cover of basesCoversIn(results)) this.paint(cover);
    }
  }

  private changed(records: MutationRecord[]): void {
    const covers = new Set<HTMLElement>();
    for (const record of records) {
      if (record.type === "attributes") {
        if (isElementLike(record.target) && coverBackdropProperty(record.target)) {
          covers.add(record.target);
        }
        continue;
      }
      for (const node of Array.from(record.addedNodes)) {
        if (isElementLike(node)) for (const cover of basesCoversIn(node)) covers.add(cover);
      }
    }
    for (const cover of covers) this.paint(cover);
  }

  private paint(cover: HTMLElement): void {
    const property = coverBackdropProperty(cover);
    if (!property) return;
    // A picture that fills its card leaves no band to paint.
    const url =
      cover.style.backgroundSize === "contain" ? coverImageUrl(cover.style.backgroundImage) : null;
    if (this.painted.get(cover) === url) return;
    this.painted.set(cover, url);
    if (!url) {
      cover.style.removeProperty(property);
      return;
    }
    // The band keeps its colour until the next one is known: the smaller
    // copy of the same picture would otherwise flash grey on its way in.
    void this.colourOf(url).then((colour) => {
      if (this.painted.get(cover) !== url) return;
      if (colour) cover.style.setProperty(property, colour);
      else cover.style.removeProperty(property);
    });
  }

  private colourOf(url: string): Promise<string | null> {
    const known = this.colours.get(url);
    if (known) return known;
    if (this.colours.size >= MAX_COLOURS) {
      const oldest = this.colours.keys().next().value;
      if (oldest !== undefined) this.colours.delete(oldest);
    }
    const colour = this.read(url).catch(() => null);
    this.colours.set(url, colour);
    return colour;
  }
}

/**
 * A picture's edge colour, read from a small copy of it. Null when it does
 * not load in time, or comes from a server that will not let it be read.
 */
async function readEdgeColor(url: string): Promise<string | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("cover picture failed to load"));
  });
  img.src = url;
  await withTimeout(loaded, LOAD_TIMEOUT_MS, (s) => `cover picture took over ${s} s`);
  if (img.naturalWidth === 0 || img.naturalHeight === 0) return null;
  const size = scaleDimensions(img.naturalWidth, img.naturalHeight, COVER_SAMPLE_PX);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size.width, size.height);
  return edgeColor(ctx.getImageData(0, 0, size.width, size.height).data, size.width, size.height);
}
