// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverBackdrops } from "./cover-backdrops";

const PROPERTY = "--bases-cards-cover-background";

/** A card with its picture drawn as Obsidian draws it, as the cover's background. */
function card(container: HTMLElement, url: string, size = "contain"): HTMLElement {
  const item = document.createElement("div");
  item.className = "bases-cards-item";
  const cover = document.createElement("div");
  cover.className = "bases-cards-cover";
  cover.style.backgroundImage = `url("${url}")`;
  cover.style.backgroundSize = size;
  item.appendChild(cover);
  container.appendChild(item);
  return cover;
}

/** A base's cards as Obsidian draws them, one picture per card, fitted whole or filling. */
function base(...covers: { url: string; size?: string }[]) {
  document.body.innerHTML = `<div class="bases-view"><div class="bases-cards-container"></div></div>`;
  const container = document.querySelector(".bases-cards-container") as HTMLElement;
  return covers.map(({ url, size }) => card(container, url, size)) as [
    HTMLElement,
    ...HTMLElement[]
  ];
}

/** Lets the observer and the reader's promises run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(colours: Record<string, string | null> = {}) {
  const read = vi.fn(async (url: string) => colours[url] ?? null);
  const backdrops = new CoverBackdrops(read);
  return { read, backdrops };
}

let current: CoverBackdrops | null = null;

afterEach(() => {
  current?.stop();
  current = null;
  document.body.innerHTML = "";
});

describe("CoverBackdrops", () => {
  it("paints the band of a fitted picture in its edge colour", async () => {
    const [cover] = base({ url: "app://a.png" });
    const { backdrops } = setup({ "app://a.png": "rgb(255, 255, 255)" });
    current = backdrops;
    backdrops.attach(window);
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("rgb(255, 255, 255)");
  });

  it("leaves a picture that fills its card alone, and does not read it", async () => {
    const [cover] = base({ url: "app://a.png", size: "cover" });
    const { backdrops, read } = setup({ "app://a.png": "rgb(255, 255, 255)" });
    current = backdrops;
    backdrops.attach(window);
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("");
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps the theme's band when the edge has no colour to give", async () => {
    const [cover] = base({ url: "app://cutout.png" });
    const { backdrops } = setup();
    current = backdrops;
    backdrops.attach(window);
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("");
  });

  it("reads each picture once, however many cards show it", async () => {
    base({ url: "app://a.png" }, { url: "app://a.png" });
    const { backdrops, read } = setup({ "app://a.png": "rgb(1, 2, 3)" });
    current = backdrops;
    backdrops.attach(window);
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("paints again when a card is reused for another picture", async () => {
    const [cover] = base({ url: "app://a.png" });
    const { backdrops } = setup({ "app://a.png": "rgb(1, 2, 3)", "app://b.png": "rgb(4, 5, 6)" });
    current = backdrops;
    backdrops.attach(window);
    await settle();
    cover.style.backgroundImage = `url("app://b.png")`;
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("rgb(4, 5, 6)");
  });

  it("clears the band when the base stops fitting its pictures", async () => {
    const [cover] = base({ url: "app://a.png" });
    const { backdrops } = setup({ "app://a.png": "rgb(1, 2, 3)" });
    current = backdrops;
    backdrops.attach(window);
    await settle();
    cover.style.backgroundSize = "cover";
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("");
  });

  it("paints cards drawn after the base was found", async () => {
    base();
    const { backdrops } = setup({ "app://late.png": "rgb(7, 8, 9)" });
    current = backdrops;
    backdrops.attach(window);
    const container = document.querySelector(".bases-cards-container") as HTMLElement;
    const cover = card(container, "app://late.png");
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("rgb(7, 8, 9)");
  });

  it("finds a base opened after it started looking", async () => {
    const { backdrops } = setup({ "app://a.png": "rgb(1, 2, 3)" });
    current = backdrops;
    backdrops.attach(window);
    const [cover] = base({ url: "app://a.png" });
    backdrops.watchSoon();
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("rgb(1, 2, 3)");
  });

  it("does not paint a picture the card has moved on from", async () => {
    const [cover] = base({ url: "app://slow.png" });
    let finish: (colour: string) => void = () => {};
    const read = vi.fn((url: string) =>
      url === "app://slow.png"
        ? new Promise<string | null>((resolve) => (finish = resolve))
        : Promise.resolve("rgb(4, 5, 6)")
    );
    const backdrops = new CoverBackdrops(read);
    current = backdrops;
    backdrops.attach(window);
    await settle();
    cover.style.backgroundImage = `url("app://b.png")`;
    await settle();
    finish("rgb(1, 2, 3)");
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("rgb(4, 5, 6)");
  });

  it("takes its colours back when it stops", async () => {
    const [cover] = base({ url: "app://a.png" });
    const { backdrops } = setup({ "app://a.png": "rgb(1, 2, 3)" });
    backdrops.attach(window);
    await settle();
    backdrops.stop();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("");
  });

  it("keeps the theme's band when the picture cannot be read", async () => {
    const [cover] = base({ url: "app://broken.png" });
    const backdrops = new CoverBackdrops(() => Promise.reject(new Error("no")));
    current = backdrops;
    backdrops.attach(window);
    await settle();
    expect(cover.style.getPropertyValue(PROPERTY)).toBe("");
  });
});
