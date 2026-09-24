/**
 * The slideshow on a published page, in the reader's browser.
 *
 * The bridge writes each block as plain HTML that already reads without this
 * script; this turns it into what the plugin shows in the vault: a header with
 * the alt text and the controls, arrow keys, the filmstrip's thumbnails, the
 * feature's details coming forward, the comparison's divider, and one
 * fullscreen view for them all.
 *
 * It is served to the site as `assets/slideshow.js`, one self-contained module
 * with no imports, so the page needs nothing else. The decisions are the pure
 * functions at the top, tested on their own; the rest wires them to the page.
 */

export const LABELS = {
  previous: "Voriges Bild",
  next: "Nächstes Bild",
  fullscreen: "Vollbild",
  exit: "Vollbild verlassen",
  compareHandle: "Trenner verschieben",
  showImage: (n) => `Bild ${n} anzeigen`
};

/** Where the divider stands before anyone moves it, in percent. */
export const DEFAULT_COMPARE_SPLIT = 50;

/** One arrow-key press of the divider, in percent of the frame. */
export const COMPARE_SPLIT_STEP = 5;

/** How far a finger has to travel sideways in fullscreen to turn the page. */
export const SWIPE_DISTANCE = 50;

/** How long a stage sent to a picture waits to arrive before it stops
 *  waiting, for a browser that does not say when a scroll has ended. */
export const SETTLE_MS = 1000;

/** The index reached from `active` by `step`, wrapping in either direction. */
export function stepIndex(active, step, count) {
  if (count <= 0) return 0;
  return (((active + step) % count) + count) % count;
}

/** The details beside the featured image: the next two after it, wrapping. */
export function featureDetails(count, active) {
  if (count <= 1) return [];
  const details = [];
  for (let step = 1; step <= Math.min(2, count - 1); step += 1) {
    details.push(stepIndex(active, step, count));
  }
  return details;
}

/** The slide a stage scrolled to `scrollLeft` shows, for slides `width` wide. */
export function slideAt(scrollLeft, width, count) {
  if (width <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / width)));
}

/** Whether a stage sent to `target` has got there. */
export function hasArrived(scrollLeft, width, target) {
  return Math.abs(scrollLeft - target * width) < 1;
}

/**
 * The step an arrow key asks for, or 0. A key held with a modifier is the
 * browser's or the system's — Alt with an arrow goes back a page — and is
 * left to them.
 */
export function arrowStep(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  if (event.key === "ArrowLeft") return -1;
  if (event.key === "ArrowRight") return 1;
  return 0;
}

/** The divider's place, held inside the frame; not a number is the middle. */
export function clampCompareSplit(percent) {
  if (!Number.isFinite(percent)) return DEFAULT_COMPARE_SPLIT;
  return Math.min(100, Math.max(0, percent));
}

/** Where a pointer at `clientX` puts the divider over a frame. */
export function compareSplitAt(clientX, left, width) {
  if (width <= 0) return DEFAULT_COMPARE_SPLIT;
  return clampCompareSplit(((clientX - left) / width) * 100);
}

/** The divider after a key: the arrows step, Home and End go to an edge. */
export function compareSplitForKey(percent, key) {
  switch (key) {
    case "ArrowLeft":
      return clampCompareSplit(percent - COMPARE_SPLIT_STEP);
    case "ArrowRight":
      return clampCompareSplit(percent + COMPARE_SPLIT_STEP);
    case "Home":
      return 0;
    case "End":
      return 100;
    default:
      return null;
  }
}

/** The `2 / 6` a viewer reads to know where in the series they are. */
export function slideshowCounter(active, count) {
  return `${active + 1} / ${count}`;
}

/** Which way a finger's sideways travel turns the page, if it turns it. */
export function swipeStep(dx, dy) {
  if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

// Drawn here rather than taken from an icon font: the page loads nothing the
// block does not need, and four strokes are cheaper than a font.
const ICONS = {
  previous: '<path d="M15 6l-6 6l6 6"/>',
  next: '<path d="M9 6l6 6l-6 6"/>',
  expand:
    '<path d="M16 4h4v4"/><path d="M14 10l6-6"/><path d="M8 20h-4v-4"/><path d="M4 20l6-6"/>' +
    '<path d="M16 20h4v-4"/><path d="M14 14l6 6"/><path d="M8 4h-4v4"/><path d="M4 4l6 6"/>',
  close: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  handle: '<path d="M8 8l-4 4l4 4"/><path d="M16 8l4 4l-4 4"/>'
};

function icon(doc, name) {
  const span = doc.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  return span.firstChild;
}

function button(doc, className, label, iconName) {
  const el = doc.createElement("button");
  el.type = "button";
  el.className = className;
  el.setAttribute("aria-label", label);
  el.title = label;
  el.appendChild(icon(doc, iconName));
  return el;
}

/** Make a picture a control: focusable, named, pressed by Enter or Space. */
function makeTile(item, label, onPress) {
  item.classList.add("slideshow-tile");
  item.setAttribute("role", "button");
  item.setAttribute("tabindex", "0");
  item.setAttribute("aria-label", label);
  item.addEventListener("click", onPress);
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPress();
    }
  });
}

/**
 * The arrow keys, anywhere in the block: on the block itself, and on a
 * control inside it, so they keep working after a button has been pressed.
 */
function arrowKeys(figure, onStep) {
  figure.addEventListener("keydown", (event) => {
    const step = arrowStep(event);
    if (step === 0 || event.defaultPrevented) return;
    event.preventDefault();
    onStep(step);
  });
}

function prefersReducedMotion(win) {
  return Boolean(win.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * The fullscreen view: one picture at a time, a counter, previous and next,
 * and a way out by the ✕, Escape, a press beside the picture or — on a phone —
 * a swipe down.
 */
function fullscreen(doc, images) {
  let dialog = null;
  let current = 0;
  let img;
  let counter;

  const show = (index) => {
    current = stepIndex(index, 0, images.length);
    img.src = images[current].src;
    img.alt = images[current].alt;
    counter.textContent = slideshowCounter(current, images.length);
  };

  const build = () => {
    dialog = doc.createElement("dialog");
    dialog.className = "slideshow-fs";
    dialog.setAttribute("aria-label", LABELS.fullscreen);

    img = doc.createElement("img");
    img.className = "slideshow-fs-img";
    counter = doc.createElement("div");
    counter.className = "slideshow-fs-counter";

    const prev = button(doc, "slideshow-fs-control slideshow-fs-prev", LABELS.previous, "previous");
    const next = button(doc, "slideshow-fs-control slideshow-fs-next", LABELS.next, "next");
    const close = button(doc, "slideshow-fs-control slideshow-fs-close", LABELS.exit, "close");
    prev.addEventListener("click", () => show(current - 1));
    next.addEventListener("click", () => show(current + 1));
    close.addEventListener("click", () => hide());

    dialog.append(counter, img, prev, next, close);
    dialog.addEventListener("keydown", (event) => {
      const step = arrowStep(event);
      if (step !== 0) show(current + step);
    });
    // A press on the dark ground around the picture closes; a press on the
    // picture or a control does not.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) hide();
    });

    let start = null;
    dialog.addEventListener("pointerdown", (event) => {
      start = { x: event.clientX, y: event.clientY };
    });
    dialog.addEventListener("pointerup", (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      const step = swipeStep(dx, dy);
      if (step !== 0) show(current + step);
      else if (dy > SWIPE_DISTANCE * 2 && Math.abs(dx) < SWIPE_DISTANCE) hide();
    });

    doc.body.appendChild(dialog);
  };

  const hide = () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };

  return {
    open(index) {
      if (!dialog) build();
      show(index);
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    },
    get element() {
      return dialog;
    }
  };
}

/** The header row: the alt text on the left, the controls on the right. */
function header(doc, figure, controls) {
  const row = doc.createElement("div");
  row.className = "slideshow-header";
  const caption = doc.createElement("span");
  caption.className = "slideshow-caption";
  const actions = doc.createElement("div");
  actions.className = "slideshow-actions";
  actions.append(...controls);
  row.append(caption, actions);
  figure.insertBefore(row, figure.firstChild);
  return caption;
}

function stage(doc, win, figure, items, images, view) {
  const track = figure.querySelector(".slideshow-items");
  let current = 0;
  let thumbs = [];

  const expand = button(doc, "slideshow-control", LABELS.fullscreen, "expand");
  const prev = button(doc, "slideshow-control", LABELS.previous, "previous");
  const next = button(doc, "slideshow-control", LABELS.next, "next");
  const caption = header(doc, figure, [expand, prev, next]);

  const mark = (index) => {
    current = index;
    caption.textContent = images[index].alt;
    thumbs.forEach((thumb, i) => thumb.setAttribute("aria-current", String(i === index)));
    const thumb = thumbs[index];
    if (thumb) {
      // Scrolled within the row only; scrollIntoView would move the page.
      const row = thumb.parentElement;
      if (thumb.offsetLeft < row.scrollLeft) row.scrollLeft = thumb.offsetLeft;
      else if (thumb.offsetLeft + thumb.offsetWidth > row.scrollLeft + row.clientWidth) {
        row.scrollLeft = thumb.offsetLeft + thumb.offsetWidth - row.clientWidth;
      }
    }
  };

  // While a control is scrolling the stage to a picture, the pictures it
  // passes are not the one on stage: followed, they flickered through the
  // caption, and a second press counted from whichever was passing. The
  // stage follows its scroll again once it arrives, once the browser says the
  // scroll has ended — a finger may have taken it elsewhere — or, failing
  // both, after a second.
  let heading = null;
  let release = 0;
  const settle = () => {
    heading = null;
    win.clearTimeout(release);
    const index = slideAt(track.scrollLeft, track.clientWidth, items.length);
    if (index !== current) mark(index);
  };

  const goTo = (index) => {
    const target = stepIndex(index, 0, items.length);
    heading = target;
    win.clearTimeout(release);
    release = win.setTimeout(settle, SETTLE_MS);
    track.scrollTo({
      left: target * track.clientWidth,
      behavior: prefersReducedMotion(win) ? "auto" : "smooth"
    });
    mark(target);
  };

  if (figure.dataset.layout === "filmstrip") {
    const row = doc.createElement("div");
    row.className = "slideshow-thumbs";
    thumbs = images.map((image, index) => {
      const thumb = doc.createElement("button");
      thumb.type = "button";
      thumb.className = "slideshow-thumb";
      thumb.setAttribute(
        "aria-label",
        image.alt ? `${LABELS.showImage(index + 1)}: ${image.alt}` : LABELS.showImage(index + 1)
      );
      const img = doc.createElement("img");
      img.src = image.src;
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
      thumb.addEventListener("click", () => goTo(index));
      row.appendChild(thumb);
      return thumb;
    });
    figure.appendChild(row);
  }

  // The stage scrolls itself under a finger; the header follows it there.
  let pending = false;
  track.addEventListener("scroll", () => {
    if (pending) return;
    pending = true;
    win.requestAnimationFrame(() => {
      pending = false;
      if (heading !== null) {
        if (hasArrived(track.scrollLeft, track.clientWidth, heading)) settle();
        return;
      }
      const index = slideAt(track.scrollLeft, track.clientWidth, items.length);
      if (index !== current) mark(index);
    });
  });
  track.addEventListener("scrollend", () => {
    if (heading !== null) settle();
  });

  expand.addEventListener("click", () => view.open(current));
  prev.addEventListener("click", () => goTo(current - 1));
  next.addEventListener("click", () => goTo(current + 1));
  items.forEach((item) => item.addEventListener("dblclick", () => view.open(current)));
  arrowKeys(figure, (step) => goTo(current + step));

  mark(0);
}

function feature(doc, figure, items, images, view) {
  let active = 0;
  const expand = button(doc, "slideshow-control", LABELS.fullscreen, "expand");
  const prev = button(doc, "slideshow-control", LABELS.previous, "previous");
  const next = button(doc, "slideshow-control", LABELS.next, "next");
  const caption = header(doc, figure, [expand, prev, next]);
  const slots = items.map((item) => item.querySelector("img"));
  let shown = [];

  const draw = () => {
    shown = [active, ...featureDetails(images.length, active)];
    shown.forEach((index, slot) => {
      slots[slot].src = images[index].src;
      slots[slot].alt = images[index].alt;
      const label = slot === 0 ? LABELS.fullscreen : LABELS.showImage(index + 1);
      items[slot].setAttribute(
        "aria-label",
        images[index].alt ? `${label}: ${images[index].alt}` : label
      );
    });
    caption.textContent = images[active].alt;
  };

  items.forEach((item, slot) => {
    makeTile(item, "", () => {
      if (slot === 0) view.open(active);
      else {
        active = shown[slot];
        draw();
      }
    });
  });

  const goTo = (index) => {
    active = stepIndex(index, 0, images.length);
    draw();
  };
  expand.addEventListener("click", () => view.open(active));
  prev.addEventListener("click", () => goTo(active - 1));
  next.addEventListener("click", () => goTo(active + 1));
  arrowKeys(figure, (step) => goTo(active + step));

  draw();
}

function tiles(doc, figure, items, images, view) {
  let last = 0;
  const expand = button(doc, "slideshow-control", LABELS.fullscreen, "expand");
  const caption = header(doc, figure, [expand]);
  const name = (index) => {
    last = index;
    caption.textContent = images[index].alt;
  };

  items.forEach((item, index) => {
    const label = LABELS.showImage(index + 1);
    makeTile(item, images[index].alt ? `${label}: ${images[index].alt}` : label, () =>
      view.open(index)
    );
    item.addEventListener("pointerenter", () => name(index));
    item.addEventListener("focus", () => name(index));
  });
  expand.addEventListener("click", () => view.open(last));
}

function compare(doc, figure, items, view) {
  const frame = figure.querySelector(".slideshow-items");
  let split = DEFAULT_COMPARE_SPLIT;

  const expand = button(doc, "slideshow-control", LABELS.fullscreen, "expand");
  header(doc, figure, [expand]);
  expand.addEventListener("click", () => view.open(0));

  const handle = doc.createElement("button");
  handle.type = "button";
  handle.className = "slideshow-compare-handle";
  handle.setAttribute("role", "slider");
  handle.setAttribute("aria-label", LABELS.compareHandle);
  handle.setAttribute("aria-valuemin", "0");
  handle.setAttribute("aria-valuemax", "100");
  const knob = doc.createElement("span");
  knob.appendChild(icon(doc, "handle"));
  handle.appendChild(knob);
  frame.appendChild(handle);

  const place = (percent) => {
    split = clampCompareSplit(percent);
    figure.style.setProperty("--slideshow-split", `${split}%`);
    handle.setAttribute("aria-valuenow", String(Math.round(split)));
  };

  const fromPointer = (event) => {
    const box = frame.getBoundingClientRect();
    place(compareSplitAt(event.clientX, box.left, box.width));
  };

  frame.addEventListener("pointerdown", (event) => {
    fromPointer(event);
    frame.setPointerCapture?.(event.pointerId);
    const move = (next) => fromPointer(next);
    const up = () => {
      frame.removeEventListener("pointermove", move);
      frame.removeEventListener("pointerup", up);
      frame.removeEventListener("pointercancel", up);
    };
    frame.addEventListener("pointermove", move);
    frame.addEventListener("pointerup", up);
    frame.addEventListener("pointercancel", up);
  });

  handle.addEventListener("keydown", (event) => {
    const next = compareSplitForKey(split, event.key);
    if (next === null) return;
    event.preventDefault();
    place(next);
  });

  // The frame takes the first picture's proportions, so neither side is
  // stretched; until it has loaded it stands at 3:2.
  const first = items[0].querySelector("img");
  const fit = () => {
    if (first.naturalWidth > 0 && first.naturalHeight > 0) {
      figure.style.setProperty(
        "--slideshow-ratio",
        `${first.naturalWidth} / ${first.naturalHeight}`
      );
    }
  };
  if (first.complete) fit();
  else first.addEventListener("load", fit, { once: true });

  place(DEFAULT_COMPARE_SPLIT);
}

/** Turn one block the bridge wrote into the plugin's slideshow. */
export function enhance(figure, doc = figure.ownerDocument, win = doc.defaultView) {
  if (figure.classList.contains("is-enhanced")) return;
  const items = [...figure.querySelectorAll(".slideshow-items > .slideshow-item")];
  const images = items.map((item) => {
    const img = item.querySelector("img");
    return { src: img?.getAttribute("src") ?? "", alt: img?.getAttribute("alt") ?? "" };
  });
  if (images.length < 2) return;

  figure.classList.add("is-enhanced");
  figure.setAttribute("tabindex", "0");
  const view = fullscreen(doc, images);

  switch (figure.dataset.layout) {
    case "slideshow":
    case "filmstrip":
      stage(doc, win, figure, items, images, view);
      break;
    case "feature":
      feature(doc, figure, items, images, view);
      break;
    case "compare":
      compare(doc, figure, items, view);
      break;
    default:
      tiles(doc, figure, items, images, view);
  }
}

export function enhanceAll(doc) {
  for (const figure of doc.querySelectorAll("figure.slideshow")) enhance(figure, doc);
}

if (typeof document !== "undefined") enhanceAll(document);
