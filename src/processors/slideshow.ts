import { type App, MarkdownRenderChild, type Plugin, setIcon, TFile } from "obsidian";
import { t } from "../i18n";
import {
  featureDetails,
  parseSlideshow,
  SLIDESHOW_LANGUAGE,
  slideshowCounter,
  stepIndex,
  stripColumns,
  type SlideshowBlock,
  type SlideshowImage
} from "../services/slideshow";
import { applyIcon, installIconFont } from "../ui/icon-font";

/** Minimum horizontal swipe distance (px) to move between slides. */
const SWIPE_THRESHOLD_PX = 40;

/**
 * The ```schreibstube-slideshow``` block: two or more images, as one stage
 * with prev/next controls (with or without a filmstrip of thumbnails), as one
 * large scene with its details beside it, or all at once as a strip of equal
 * tiles or a masonry of uncropped ones — each with a fullscreen view.
 *
 * This file is the wiring half: it resolves image paths against the vault and
 * builds the DOM. Every decision — what counts as an image, which layout was
 * asked for, which details stand beside the featured picture — lives in the
 * tested `services/slideshow` module.
 */
export function registerSlideshow(plugin: Plugin): void {
  plugin.registerMarkdownCodeBlockProcessor(SLIDESHOW_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new Slideshow(plugin.app, el, source, ctx.sourcePath));
  });
}

/** An image and where the vault serves it from; "" when it is not there. */
interface ResolvedImage extends SlideshowImage {
  url: string;
}

class Slideshow extends MarkdownRenderChild {
  /** Teardown for anything living outside `containerEl` — a document-level key
   *  listener and the fullscreen overlay, which are attached to `document.body`
   *  and so are not removed when Obsidian empties the block's element. */
  private readonly teardown: Array<() => void> = [];

  constructor(
    private readonly app: App,
    containerEl: HTMLElement,
    private readonly source: string,
    private readonly sourcePath: string
  ) {
    super(containerEl);
  }

  override onload(): void {
    const result = parseSlideshow(this.source);
    if (!result.ok) {
      this.containerEl.createEl("div", {
        cls: "schreibstube-slideshow-error",
        text: t().common.notice(result.message)
      });
      return;
    }

    // The controls draw from the plugin's own icon font, which is installed
    // per window: a note in a popped-out window has its own document.
    installIconFont(this.containerEl.doc);
    this.render(result);
  }

  override onunload(): void {
    for (const off of this.teardown.splice(0)) off();
  }

  /** A vault-relative resource URL for an image path, or "" when it is not in
   *  the vault — the tile then shows its alt text with no picture. */
  private resolvePath(src: string): string {
    const file =
      this.app.metadataCache.getFirstLinkpathDest(src, this.sourcePath) ??
      this.app.vault.getAbstractFileByPath(src);
    if (!(file instanceof TFile)) return "";
    return this.app.vault.getResourcePath(file);
  }

  private render(block: SlideshowBlock): void {
    const images: ResolvedImage[] = block.images.map((img) => ({
      ...img,
      url: this.resolvePath(img.src)
    }));

    const wrapper = this.containerEl.createEl("div", {
      cls: "schreibstube-slideshow",
      attr: {
        tabindex: "0",
        role: "region",
        "aria-label": regionLabel(block.layout, images.length),
        "data-layout": block.layout
      }
    });

    switch (block.layout) {
      case "feature":
        this.renderFeature(wrapper, images);
        break;
      case "strip":
      case "masonry":
        this.renderGallery(wrapper, images, block.layout);
        break;
      case "filmstrip":
        this.renderStage(wrapper, images, true);
        break;
      default:
        this.renderStage(wrapper, images, false);
    }
  }

  /**
   * One stage, one image on it. The header carries the active image's alt text
   * as its caption, where it has always been. With `thumbnails`, every image
   * also sits in a strip under the stage, and pressing one puts it there.
   */
  private renderStage(wrapper: HTMLElement, images: ResolvedImage[], thumbnails: boolean): void {
    const header = wrapper.createEl("div", { cls: "schreibstube-slideshow-header" });
    const caption = header.createEl("span", {
      cls: "schreibstube-slideshow-caption",
      text: images[0]?.alt ?? ""
    });

    let current = 0;
    const actions = header.createEl("div", { cls: "schreibstube-slideshow-actions" });
    this.control(actions, "arrows-maximize", "expand", t().slideshow.fullscreen, () =>
      this.openFullscreen(images, current)
    );
    this.control(actions, "chevron-left", "chevron-left", t().slideshow.previous, () =>
      goTo(current - 1)
    );
    this.control(actions, "chevron-right", "chevron-right", t().slideshow.next, () =>
      goTo(current + 1)
    );

    const track = wrapper.createEl("div", { cls: "schreibstube-slideshow-track" });
    const slideEls = images.map((img, idx) => {
      const slide = track.createEl("div", { cls: "schreibstube-slideshow-slide" });
      slide.toggleClass("schreibstube-slideshow-slide-active", idx === 0);
      const image = slide.createEl("img");
      image.alt = img.alt;
      image.draggable = false;
      return image;
    });

    const thumbStrip = thumbnails
      ? wrapper.createEl("div", { cls: "schreibstube-slideshow-thumbs" })
      : null;
    const thumbEls = thumbStrip
      ? images.map((img, index) => {
          const thumb = this.tile(thumbStrip, "schreibstube-slideshow-thumb", () => goTo(index));
          fillTile(thumb, img, t().slideshow.showImage(index + 1));
          thumb.toggleClass("is-active", index === 0);
          return thumb;
        })
      : [];

    // Probe every image off-DOM before assigning any src, then lock the track's
    // aspect-ratio to the tallest one. Without this, text below the block jumps
    // as each image arrives at its own size.
    let settled = 0;
    let maxRatio = 0;
    let bestW = 1;
    let bestH = 1;
    images.forEach((img, idx) => {
      const probe = new Image();
      const settle = (): void => {
        if (probe.naturalWidth > 0) {
          const ratio = probe.naturalHeight / probe.naturalWidth;
          if (ratio > maxRatio) {
            maxRatio = ratio;
            bestW = probe.naturalWidth;
            bestH = probe.naturalHeight;
          }
        }
        const image = slideEls[idx];
        if (image) image.src = img.url;
        settled += 1;
        if (settled === images.length && maxRatio > 0) {
          track.style.aspectRatio = `${bestW} / ${bestH}`;
        }
      };
      probe.addEventListener("load", settle);
      probe.addEventListener("error", settle);
      probe.src = img.url;
    });

    const goTo = (next: number): void => {
      slideEls[current]?.parentElement?.removeClass("schreibstube-slideshow-slide-active");
      thumbEls[current]?.removeClass("is-active");
      current = stepIndex(current, next - current, images.length);
      slideEls[current]?.parentElement?.addClass("schreibstube-slideshow-slide-active");
      caption.textContent = images[current]?.alt ?? "";

      const thumb = thumbEls[current];
      if (thumbStrip && thumb) {
        thumb.addClass("is-active");
        // Scrolled by hand: scrollIntoView would scroll the note as well, to
        // bring the strip into view, every time the picture changes.
        thumbStrip.scrollTo({
          left: thumb.offsetLeft - (thumbStrip.clientWidth - thumb.offsetWidth) / 2,
          behavior: "smooth"
        });
      }
    };

    track.addEventListener("dblclick", () => this.openFullscreen(images, current));
    wireArrowKeys(wrapper, (direction) => goTo(current + direction));
    // On the stage only: a sideways swipe along the thumbnails scrolls them.
    wireSwipe(track, (direction) => goTo(current + direction));
  }

  /**
   * One scene, several details: the featured image large, the next two beside
   * it as tiles that bring themselves forward when pressed. The header carries
   * the featured image's alt text, as the stage's does.
   */
  private renderFeature(wrapper: HTMLElement, images: ResolvedImage[]): void {
    const header = wrapper.createEl("div", { cls: "schreibstube-slideshow-header" });
    const caption = header.createEl("span", { cls: "schreibstube-slideshow-caption" });

    let current = 0;
    const actions = header.createEl("div", { cls: "schreibstube-slideshow-actions" });
    this.control(actions, "arrows-maximize", "expand", t().slideshow.fullscreen, () =>
      this.openFullscreen(images, current)
    );
    this.control(actions, "chevron-left", "chevron-left", t().slideshow.previous, () =>
      goTo(current - 1)
    );
    this.control(actions, "chevron-right", "chevron-right", t().slideshow.next, () =>
      goTo(current + 1)
    );

    const grid = wrapper.createEl("div", { cls: "schreibstube-slideshow-feature" });
    const main = this.tile(grid, "schreibstube-slideshow-feature-main", () =>
      this.openFullscreen(images, current)
    );
    const column = grid.createEl("div", { cls: "schreibstube-slideshow-feature-details" });
    const detailCount = featureDetails(images.length, 0).length;
    const details = Array.from({ length: detailCount }, () => {
      let target = 0;
      const tile = this.tile(column, "schreibstube-slideshow-feature-detail", () => goTo(target));
      return { tile, setTarget: (index: number) => (target = index) };
    });

    const goTo = (next: number): void => {
      current = stepIndex(current, next - current, images.length);
      fillTile(main, images[current], t().slideshow.fullscreen);
      featureDetails(images.length, current).forEach((index, slot) => {
        const detail = details[slot];
        if (!detail) return;
        detail.setTarget(index);
        fillTile(detail.tile, images[index], t().slideshow.showImage(index + 1));
      });
      caption.textContent = images[current]?.alt ?? "";
    };
    goTo(0);

    wireArrowKeys(wrapper, (direction) => goTo(current + direction));
    wireSwipe(wrapper, (direction) => goTo(current + direction));
  }

  /**
   * Every image at once: a strip of equal tiles, or a masonry that keeps each
   * picture's proportions. Nothing rotates; a tile opens the fullscreen view at
   * its place. With no image on stage, the header names the one under the
   * pointer or the keyboard focus, so the alt text still has its one place.
   */
  private renderGallery(
    wrapper: HTMLElement,
    images: ResolvedImage[],
    layout: "strip" | "masonry"
  ): void {
    const header = wrapper.createEl("div", { cls: "schreibstube-slideshow-header" });
    const caption = header.createEl("span", { cls: "schreibstube-slideshow-caption" });

    const actions = header.createEl("div", { cls: "schreibstube-slideshow-actions" });
    this.control(actions, "arrows-maximize", "expand", t().slideshow.fullscreen, () =>
      this.openFullscreen(images, 0)
    );

    const gallery = wrapper.createEl("div", { cls: `schreibstube-slideshow-${layout}` });
    if (layout === "strip") {
      gallery.style.setProperty(
        "--schreibstube-strip-columns",
        String(stripColumns(images.length))
      );
    }
    images.forEach((img, index) => {
      const tile = this.tile(gallery, `schreibstube-slideshow-${layout}-tile`, () =>
        this.openFullscreen(images, index)
      );
      fillTile(tile, img, t().slideshow.showImage(index + 1));
      const name = (): void => {
        caption.textContent = img.alt;
      };
      tile.addEventListener("pointerenter", name);
      tile.addEventListener("focus", name);
    });
    const clear = (): void => {
      caption.textContent = "";
    };
    gallery.addEventListener("pointerleave", clear);
    gallery.addEventListener("focusout", clear);
  }

  /**
   * A control in the header: a labelled, focusable span with the glyph in a
   * child, the way the file pane builds its own. A span rather than a button
   * because a button in the reading view wears Obsidian's fill and shadow,
   * and these are icons standing on the page, not chips.
   */
  private control(
    parent: HTMLElement,
    icon: string,
    fallbackIcon: string,
    label: string,
    run: () => void
  ): HTMLElement {
    const control = parent.createSpan({
      cls: "schreibstube-slideshow-control",
      attr: { role: "button", tabindex: "0", "aria-label": label, title: label }
    });
    drawGlyph(control.createSpan(), icon, fallbackIcon);
    wirePress(control, run);
    return control;
  }

  /** A picture that can be pressed: no frame, no fill, the image is the control. */
  private tile(parent: HTMLElement, cls: string, run: () => void): HTMLElement {
    const tile = parent.createSpan({
      cls: `schreibstube-slideshow-tile ${cls}`,
      attr: { role: "button", tabindex: "0" }
    });
    wirePress(tile, run);
    return tile;
  }

  private openFullscreen(images: ResolvedImage[], startAt: number): void {
    let fsCurrent = startAt;
    const doc = this.containerEl.ownerDocument;
    const overlay = doc.body.createEl("div", { cls: "schreibstube-slideshow-fs" });

    const fsImg = overlay.createEl("img", { cls: "schreibstube-slideshow-fs-img" });
    fsImg.draggable = false;
    const fsCaption = overlay.createEl("div", { cls: "schreibstube-slideshow-fs-caption" });
    const fsCounter = overlay.createEl("div", { cls: "schreibstube-slideshow-fs-counter" });

    const fsControl = (cls: string, icon: string, fallback: string, label: string): HTMLElement => {
      const control = overlay.createSpan({
        cls: `schreibstube-slideshow-fs-control ${cls}`,
        attr: { role: "button", tabindex: "0", "aria-label": label, title: label }
      });
      drawGlyph(control.createSpan(), icon, fallback);
      return control;
    };
    const fsPrev = fsControl(
      "schreibstube-slideshow-fs-nav schreibstube-slideshow-fs-nav--prev",
      "chevron-left",
      "chevron-left",
      t().slideshow.previous
    );
    const fsNext = fsControl(
      "schreibstube-slideshow-fs-nav schreibstube-slideshow-fs-nav--next",
      "chevron-right",
      "chevron-right",
      t().slideshow.next
    );
    const fsClose = fsControl("schreibstube-slideshow-fs-close", "x", "x", t().slideshow.exit);

    const fsGoTo = (next: number): void => {
      fsCurrent = stepIndex(fsCurrent, next - fsCurrent, images.length);
      fsImg.src = images[fsCurrent]?.url ?? "";
      fsImg.alt = images[fsCurrent]?.alt ?? "";
      fsCaption.textContent = images[fsCurrent]?.alt ?? "";
      fsCounter.textContent = slideshowCounter(fsCurrent, images.length);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") dismiss();
      else if (e.key === "ArrowLeft") fsGoTo(fsCurrent - 1);
      else if (e.key === "ArrowRight") fsGoTo(fsCurrent + 1);
    };
    const dismiss = (): void => {
      overlay.remove();
      doc.removeEventListener("keydown", onKey);
      const idx = this.teardown.indexOf(dismiss);
      if (idx >= 0) this.teardown.splice(idx, 1);
    };

    fsGoTo(fsCurrent);
    wirePress(fsPrev, () => fsGoTo(fsCurrent - 1));
    wirePress(fsNext, () => fsGoTo(fsCurrent + 1));
    wirePress(fsClose, dismiss);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
    doc.addEventListener("keydown", onKey);

    wireSwipe(overlay, (direction) => fsGoTo(fsCurrent + direction));

    // The block can be unloaded (note closed, view re-rendered) while the
    // overlay is open; onunload runs this to tear it down.
    this.teardown.push(dismiss);
  }
}

/** The accessible name of the block, saying which shape it takes. */
function regionLabel(layout: SlideshowBlock["layout"], count: number): string {
  switch (layout) {
    case "feature":
      return t().slideshow.regionFeature(count);
    case "strip":
      return t().slideshow.regionStrip(count);
    case "filmstrip":
      return t().slideshow.regionFilmstrip(count);
    case "masonry":
      return t().slideshow.regionMasonry(count);
    default:
      return t().slideshow.region(count);
  }
}

/**
 * The glyph goes in a child of the control, never on the control itself:
 * drawing an icon marks what it is drawn on `aria-hidden`, which is right for
 * the icon and wrong for the labelled, focusable thing carrying it.
 *
 * The bundled font first, as everywhere else in the plugin, and Obsidian's own
 * icon if that font has nothing under the name — a control drawn as an empty
 * box is indistinguishable from one that is broken.
 */
function drawGlyph(glyph: HTMLElement, icon: string, fallbackIcon: string): void {
  if (!applyIcon(glyph, icon)) {
    glyph.removeClass("schreibstube-icon");
    setIcon(glyph, fallbackIcon);
  }
}

/**
 * Puts an image into a tile. One the vault does not have shows its alt text
 * on a plain ground instead, so the grid keeps its shape around the gap.
 */
function fillTile(tile: HTMLElement, image: ResolvedImage | undefined, label: string): void {
  tile.empty();
  tile.setAttribute("aria-label", image?.alt ? `${label}: ${image.alt}` : label);
  tile.toggleClass("schreibstube-slideshow-tile-missing", !image || image.url === "");
  if (!image) return;
  if (image.url === "") {
    tile.createSpan({ cls: "schreibstube-slideshow-tile-alt", text: image.alt });
    return;
  }
  const img = tile.createEl("img");
  img.src = image.url;
  img.alt = image.alt;
  img.draggable = false;
}

/** Click, Enter and Space all press the control. */
function wirePress(el: HTMLElement, run: () => void): void {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    run();
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      run();
    }
  });
}

/** The arrow keys move through the series while the block has focus. */
function wireArrowKeys(el: HTMLElement, onStep: (direction: 1 | -1) => void): void {
  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onStep(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onStep(1);
    }
  });
}

/**
 * A horizontal swipe, and only a horizontal one.
 *
 * Measured on the width alone, a thumb scrolling the note down with a little
 * drift to the side turned the page. A swipe now has to travel further
 * sideways than up or down, which is what makes it a swipe and not a scroll.
 */
function wireSwipe(el: HTMLElement, onSwipe: (direction: 1 | -1) => void): void {
  let startX = 0;
  let startY = 0;
  el.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0]?.clientX ?? 0;
      startY = e.touches[0]?.clientY ?? 0;
    },
    { passive: true }
  );
  el.addEventListener(
    "touchend",
    (e) => {
      const dx = (e.changedTouches[0]?.clientX ?? 0) - startX;
      const dy = (e.changedTouches[0]?.clientY ?? 0) - startY;
      if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
        onSwipe(dx < 0 ? 1 : -1);
      }
    },
    { passive: true }
  );
}
