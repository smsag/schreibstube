import { type App, MarkdownRenderChild, type Plugin, setIcon, TFile } from "obsidian";
import { t } from "../i18n";
import { parseSlideshow, SLIDESHOW_LANGUAGE, type SlideshowImage } from "../services/slideshow";

/** Minimum horizontal swipe distance (px) to move between slides. */
const SWIPE_THRESHOLD_PX = 40;

/**
 * The ```schreibstube-slideshow``` block: two or more images shown one at a
 * time, navigable by button, arrow key, swipe, and a fullscreen view.
 *
 * This file is the wiring half: it resolves image paths against the vault and
 * builds the DOM. Every decision — what counts as an image, how many are
 * allowed — lives in the tested `services/slideshow` module.
 */
export function registerSlideshow(plugin: Plugin): void {
  plugin.registerMarkdownCodeBlockProcessor(SLIDESHOW_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new Slideshow(plugin.app, el, source, ctx.sourcePath));
  });
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
    this.render(result.images);
  }

  override onunload(): void {
    for (const off of this.teardown.splice(0)) off();
  }

  /** A vault-relative resource URL for an image path, or "" when it is not in
   *  the vault — the slide then shows its alt text with no picture. */
  private resolvePath(src: string): string {
    const file =
      this.app.metadataCache.getFirstLinkpathDest(src, this.sourcePath) ??
      this.app.vault.getAbstractFileByPath(src);
    if (!(file instanceof TFile)) return "";
    return this.app.vault.getResourcePath(file);
  }

  private render(images: SlideshowImage[]): void {
    const wrapper = this.containerEl.createEl("div", {
      cls: "schreibstube-slideshow",
      attr: {
        tabindex: "0",
        role: "region",
        "aria-label": t().slideshow.region(images.length)
      }
    });

    const header = wrapper.createEl("div", { cls: "schreibstube-slideshow-header" });
    const caption = header.createEl("span", {
      cls: "schreibstube-slideshow-caption",
      text: images[0]?.alt ?? ""
    });

    const actions = header.createEl("div", { cls: "schreibstube-slideshow-actions" });
    const fullscreenBtn = actions.createEl("button", {
      cls: "schreibstube-slideshow-btn",
      attr: { "aria-label": t().slideshow.fullscreen }
    });
    setIcon(fullscreenBtn, "expand");
    const prevBtn = actions.createEl("button", {
      cls: "schreibstube-slideshow-btn",
      attr: { "aria-label": t().slideshow.previous }
    });
    setIcon(prevBtn, "chevron-left");
    const nextBtn = actions.createEl("button", {
      cls: "schreibstube-slideshow-btn",
      attr: { "aria-label": t().slideshow.next }
    });
    setIcon(nextBtn, "chevron-right");

    const track = wrapper.createEl("div", { cls: "schreibstube-slideshow-track" });
    const resolved = images.map((img) => this.resolvePath(img.src));

    const slideEls = images.map((img, idx) => {
      const slide = track.createEl("div", { cls: "schreibstube-slideshow-slide" });
      slide.toggleClass("schreibstube-slideshow-slide-active", idx === 0);
      const image = slide.createEl("img");
      image.alt = img.alt;
      image.draggable = false;
      return image;
    });

    // Probe every image off-DOM before assigning any src, then lock the track's
    // aspect-ratio to the tallest one. Without this, text below the block jumps
    // as each image arrives at its own size.
    let settled = 0;
    let maxRatio = 0;
    let bestW = 1;
    let bestH = 1;
    resolved.forEach((src, idx) => {
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
        if (image) image.src = src;
        settled += 1;
        if (settled === images.length && maxRatio > 0) {
          track.style.aspectRatio = `${bestW} / ${bestH}`;
        }
      };
      probe.addEventListener("load", settle);
      probe.addEventListener("error", settle);
      probe.src = src;
    });

    let current = 0;
    const goTo = (next: number): void => {
      slideEls[current]?.parentElement?.removeClass("schreibstube-slideshow-slide-active");
      current = ((next % images.length) + images.length) % images.length;
      slideEls[current]?.parentElement?.addClass("schreibstube-slideshow-slide-active");
      caption.textContent = images[current]?.alt ?? "";
    };

    fullscreenBtn.addEventListener("click", () => this.openFullscreen(images, resolved, current));
    track.addEventListener("dblclick", () => this.openFullscreen(images, resolved, current));
    prevBtn.addEventListener("click", () => goTo(current - 1));
    nextBtn.addEventListener("click", () => goTo(current + 1));
    wrapper.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(current - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(current + 1);
      }
    });

    wireSwipe(wrapper, (direction) => goTo(current + direction));
  }

  private openFullscreen(images: SlideshowImage[], resolved: string[], startAt: number): void {
    let fsCurrent = startAt;
    const doc = this.containerEl.ownerDocument;
    const overlay = doc.body.createEl("div", { cls: "schreibstube-slideshow-fs" });

    const fsImg = overlay.createEl("img", { cls: "schreibstube-slideshow-fs-img" });
    fsImg.draggable = false;
    const fsCaption = overlay.createEl("div", { cls: "schreibstube-slideshow-fs-caption" });
    const fsCounter = overlay.createEl("div", { cls: "schreibstube-slideshow-fs-counter" });

    const fsPrev = overlay.createEl("span", {
      cls: "schreibstube-slideshow-fs-nav schreibstube-slideshow-fs-nav--prev",
      text: "‹",
      attr: { role: "button", tabindex: "0", "aria-label": t().slideshow.previous }
    });
    const fsNext = overlay.createEl("span", {
      cls: "schreibstube-slideshow-fs-nav schreibstube-slideshow-fs-nav--next",
      text: "›",
      attr: { role: "button", tabindex: "0", "aria-label": t().slideshow.next }
    });
    const fsClose = overlay.createEl("span", {
      cls: "schreibstube-slideshow-fs-close",
      text: "×",
      attr: { role: "button", tabindex: "0", "aria-label": t().slideshow.exit }
    });

    const fsGoTo = (next: number): void => {
      fsCurrent = ((next % images.length) + images.length) % images.length;
      fsImg.src = resolved[fsCurrent] ?? "";
      fsImg.alt = images[fsCurrent]?.alt ?? "";
      fsCaption.textContent = images[fsCurrent]?.alt ?? "";
      fsCounter.textContent = `${fsCurrent + 1} / ${images.length}`;
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
    fsPrev.addEventListener("click", () => fsGoTo(fsCurrent - 1));
    fsNext.addEventListener("click", () => fsGoTo(fsCurrent + 1));
    fsClose.addEventListener("click", dismiss);
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
