// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderSlideshow } from "../render/slideshow.mjs";
import {
  arrowStep,
  clampCompareSplit,
  compareSplitAt,
  compareSplitForKey,
  enhance,
  enhanceAll,
  featureDetails,
  hasArrived,
  SETTLE_MS,
  slideAt,
  slideshowCounter,
  stepIndex,
  swipeStep
} from "./slideshow.mjs";

describe("the decisions", () => {
  it("steps round the series in both directions", () => {
    expect(stepIndex(0, -1, 4)).toBe(3);
    expect(stepIndex(3, 1, 4)).toBe(0);
    expect(stepIndex(2, 0, 0)).toBe(0);
  });

  it("puts the next two beside a feature, wrapping, and one when there is one", () => {
    expect(featureDetails(5, 4)).toEqual([0, 1]);
    expect(featureDetails(2, 0)).toEqual([1]);
    expect(featureDetails(1, 0)).toEqual([]);
  });

  it("reads the slide a stage has been scrolled to", () => {
    expect(slideAt(0, 600, 4)).toBe(0);
    expect(slideAt(890, 600, 4)).toBe(1);
    expect(slideAt(99999, 600, 4)).toBe(3);
    expect(slideAt(-40, 600, 4)).toBe(0);
    expect(slideAt(300, 0, 4)).toBe(0);
  });

  it("keeps the divider inside the frame", () => {
    expect(clampCompareSplit(140)).toBe(100);
    expect(clampCompareSplit(-3)).toBe(0);
    expect(clampCompareSplit(Number.NaN)).toBe(50);
    expect(compareSplitAt(150, 100, 200)).toBe(25);
    expect(compareSplitAt(150, 100, 0)).toBe(50);
  });

  it("moves the divider by key, and ignores other keys", () => {
    expect(compareSplitForKey(50, "ArrowLeft")).toBe(45);
    expect(compareSplitForKey(98, "ArrowRight")).toBe(100);
    expect(compareSplitForKey(40, "Home")).toBe(0);
    expect(compareSplitForKey(40, "End")).toBe(100);
    expect(compareSplitForKey(40, "a")).toBeNull();
  });

  it("knows when a stage has arrived", () => {
    expect(hasArrived(1800, 600, 3)).toBe(true);
    expect(hasArrived(1799.6, 600, 3)).toBe(true);
    expect(hasArrived(1500, 600, 3)).toBe(false);
  });

  it("reads the arrows, and leaves an arrow with a modifier to the browser", () => {
    expect(arrowStep({ key: "ArrowLeft" })).toBe(-1);
    expect(arrowStep({ key: "ArrowRight" })).toBe(1);
    expect(arrowStep({ key: "ArrowLeft", altKey: true })).toBe(0);
    expect(arrowStep({ key: "ArrowRight", metaKey: true })).toBe(0);
    expect(arrowStep({ key: "Enter" })).toBe(0);
  });

  it("counts from one", () => {
    expect(slideshowCounter(1, 6)).toBe("2 / 6");
  });

  it("turns the page only on a clearly sideways swipe", () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, 10)).toBe(-1);
    expect(swipeStep(30, 0)).toBe(0);
    expect(swipeStep(-80, 120)).toBe(0);
  });
});

const ASSETS = {
  "a.png": { url: "a.png", kind: "image" },
  "b.png": { url: "b.png", kind: "image" },
  "c.png": { url: "c.png", kind: "image" },
  "d.png": { url: "d.png", kind: "image" }
};

/** Put a block on the page exactly as the bridge writes it. */
function mount(source) {
  document.body.innerHTML = renderSlideshow(source, (src) => ASSETS[src]).html;
  const figure = document.querySelector("figure.slideshow");
  const track = figure.querySelector(".slideshow-items");
  track.scrollTo = vi.fn();
  enhance(figure);
  return figure;
}

const four = "![Eins](a.png)\n![Zwei](b.png)\n![Drei](c.png)\n![Vier](d.png)";
const controls = (figure) => [...figure.querySelectorAll(".slideshow-control")];
const label = (el) => el.getAttribute("aria-label");
const dialog = () => document.querySelector("dialog.slideshow-fs");

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the stage", () => {
  it("adds the header with the alt text and the three controls", () => {
    const figure = mount(four);
    expect(figure.classList.contains("is-enhanced")).toBe(true);
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Eins");
    expect(controls(figure).map(label)).toEqual(["Vollbild", "Voriges Bild", "Nächstes Bild"]);
  });

  it("scrolls to the next picture, and round from the last to the first", () => {
    const figure = mount(four);
    const track = figure.querySelector(".slideshow-items");
    const [, prev, next] = controls(figure);
    next.click();
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Zwei");
    expect(track.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: track.clientWidth })
    );
    prev.click();
    prev.click();
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Vier");
  });

  it("answers the arrow keys on the block", () => {
    const figure = mount(four);
    figure.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Zwei");
    figure.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Eins");
  });

  it("keeps the arrows working after a control has been pressed", () => {
    const figure = mount(four);
    const next = controls(figure)[2];
    next.focus();
    next.click();
    next.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Drei");
    next.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true })
    );
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Drei");
  });

  it("gives a filmstrip a thumbnail per picture, marking the one on stage", () => {
    const figure = mount(`layout: filmstrip\n${four}`);
    const thumbs = [...figure.querySelectorAll(".slideshow-thumb")];
    expect(thumbs).toHaveLength(4);
    expect(label(thumbs[2])).toBe("Bild 3 anzeigen: Drei");
    thumbs[2].click();
    expect(thumbs.map((t) => t.getAttribute("aria-current"))).toEqual([
      "false",
      "false",
      "true",
      "false"
    ]);
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Drei");
  });

  it("does nothing the second time, so a block is never given two headers", () => {
    const figure = mount(four);
    enhance(figure);
    enhanceAll(document);
    expect(figure.querySelectorAll(".slideshow-header")).toHaveLength(1);
  });
});

describe("a stage in motion", () => {
  /** A track 600 pixels wide whose scroll position the test moves by hand. */
  function measured(figure) {
    const track = figure.querySelector(".slideshow-items");
    let left = 0;
    Object.defineProperty(track, "clientWidth", { value: 600, configurable: true });
    Object.defineProperty(track, "scrollLeft", {
      get: () => left,
      set: (value) => {
        left = value;
      },
      configurable: true
    });
    return {
      scrollTo(x) {
        left = x;
        track.dispatchEvent(new Event("scroll"));
      },
      end() {
        track.dispatchEvent(new Event("scrollend"));
      }
    };
  }
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const caption = (figure) => figure.querySelector(".slideshow-caption").textContent;

  it("does not show the pictures a control scrolls past, and counts from where it is going", async () => {
    const figure = mount(four);
    const stage = measured(figure);
    const [, prev, next] = controls(figure);

    prev.click();
    stage.scrollTo(300);
    await frame();
    expect(caption(figure)).toBe("Vier");

    // Still on its way to the last picture: the next one is the first.
    next.click();
    expect(caption(figure)).toBe("Eins");
    stage.scrollTo(0);
    await frame();
    expect(caption(figure)).toBe("Eins");
  });

  it("follows a finger again once it has arrived", async () => {
    const figure = mount(four);
    const stage = measured(figure);
    controls(figure)[2].click();
    stage.scrollTo(600);
    await frame();
    stage.scrollTo(1200);
    await frame();
    expect(caption(figure)).toBe("Drei");
  });

  it("settles where a finger took it when the scroll ends elsewhere", async () => {
    const figure = mount(four);
    const stage = measured(figure);
    controls(figure)[1].click();
    stage.scrollTo(1200);
    await frame();
    expect(caption(figure)).toBe("Vier");
    stage.end();
    expect(caption(figure)).toBe("Drei");
  });

  it("stops waiting after a while in a browser that never says the scroll ended", () => {
    vi.useFakeTimers();
    try {
      const figure = mount(four);
      measured(figure);
      controls(figure)[1].click();
      figure.querySelector(".slideshow-items").scrollLeft = 600;
      vi.advanceTimersByTime(SETTLE_MS);
      expect(caption(figure)).toBe("Zwei");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fullscreen", () => {
  it("opens on the picture on stage, steps, counts and closes", () => {
    const figure = mount(four);
    controls(figure)[2].click();
    controls(figure)[0].click();

    const view = dialog();
    const img = view.querySelector(".slideshow-fs-img");
    expect(view.hasAttribute("open")).toBe(true);
    expect(img.getAttribute("src")).toBe("b.png");
    expect(view.querySelector(".slideshow-fs-counter").textContent).toBe("2 / 4");

    view.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(img.getAttribute("src")).toBe("c.png");
    view.querySelector(".slideshow-fs-prev").click();
    view.querySelector(".slideshow-fs-prev").click();
    view.querySelector(".slideshow-fs-prev").click();
    expect(img.getAttribute("src")).toBe("d.png");
    expect(img.getAttribute("alt")).toBe("Vier");

    view.querySelector(".slideshow-fs-close").click();
    expect(view.hasAttribute("open")).toBe(false);
  });

  it("closes on a press beside the picture, not on the picture", () => {
    const figure = mount(four);
    controls(figure)[0].click();
    dialog().querySelector(".slideshow-fs-img").click();
    expect(dialog().hasAttribute("open")).toBe(true);
    dialog().click();
    expect(dialog().hasAttribute("open")).toBe(false);
  });
});

describe("tiles", () => {
  it("opens a strip's tile in fullscreen, by click or by Enter", () => {
    const figure = mount(`layout: strip\n${four}`);
    const tiles = [...figure.querySelectorAll(".slideshow-tile")];
    expect(tiles).toHaveLength(4);
    expect(label(tiles[1])).toBe("Bild 2 anzeigen: Zwei");
    expect(controls(figure).map(label)).toEqual(["Vollbild"]);

    tiles[2].click();
    expect(dialog().querySelector(".slideshow-fs-img").getAttribute("src")).toBe("c.png");
    dialog().querySelector(".slideshow-fs-close").click();

    tiles[3].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(dialog().querySelector(".slideshow-fs-img").getAttribute("src")).toBe("d.png");
  });

  it("names the tile under the pointer in the header", () => {
    const figure = mount(`layout: masonry\n${four}`);
    figure.querySelectorAll(".slideshow-tile")[1].dispatchEvent(new Event("pointerenter"));
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Zwei");
  });

  it("brings a feature's detail forward when it is pressed", () => {
    const figure = mount(`layout: feature\n${four}`);
    const slots = [...figure.querySelectorAll(".slideshow-item img")];
    expect(slots.map((img) => img.getAttribute("src"))).toEqual(["a.png", "b.png", "c.png"]);

    figure.querySelectorAll(".slideshow-tile")[2].click();
    expect(slots.map((img) => img.getAttribute("src"))).toEqual(["c.png", "a.png", "b.png"]);
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Drei");

    figure.querySelectorAll(".slideshow-tile")[0].click();
    expect(dialog().querySelector(".slideshow-fs-img").getAttribute("src")).toBe("c.png");
  });

  it("steps a feature with the arrows from one of its tiles", () => {
    const figure = mount(`layout: feature\n${four}`);
    const tile = figure.querySelectorAll(".slideshow-tile")[1];
    tile.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(figure.querySelector(".slideshow-caption").textContent).toBe("Zwei");
  });
});

describe("compare", () => {
  it("draws a divider in the middle that the keys move", () => {
    const figure = mount("layout: compare\n![Vorher](a.png)\n![Nachher](b.png)");
    const handle = figure.querySelector(".slideshow-compare-handle");
    expect(label(handle)).toBe("Trenner verschieben");
    expect(figure.style.getPropertyValue("--slideshow-split")).toBe("50%");

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    expect(figure.style.getPropertyValue("--slideshow-split")).toBe("45%");
    expect(handle.getAttribute("aria-valuenow")).toBe("45");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "End", cancelable: true }));
    expect(figure.style.getPropertyValue("--slideshow-split")).toBe("100%");
  });

  it("keeps the labels the bridge wrote and offers only fullscreen", () => {
    const figure = mount("layout: compare\n![Vorher](a.png)\n![Nachher](b.png)");
    expect([...figure.querySelectorAll(".slideshow-label")].map((l) => l.textContent)).toEqual([
      "Vorher",
      "Nachher"
    ]);
    expect(controls(figure).map(label)).toEqual(["Vollbild"]);
  });
});
