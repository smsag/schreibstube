// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Plugin, TFile } from "obsidian";
import { t } from "../i18n";
import { installObsidianDom } from "../testing/obsidian-dom";
import { TFile as StubFile } from "../testing/obsidian-stub";
import { registerSlideshow, type SlideshowPictureActions } from "./slideshow";

/**
 * The block as a reader meets it, rendered against the stub: its fullscreen
 * view, and the picture buttons it shares with the header.
 */

const FILES = new Map(
  ["a.png", "b.png", "c.png"].map((path) => [path, new StubFile(path) as unknown as TFile])
);

type Processor = (source: string, el: HTMLElement, ctx: unknown) => void;

function render(source: string, actions: SlideshowPictureActions | null = null): HTMLElement {
  let processor: Processor | null = null;
  const app = {
    metadataCache: { getFirstLinkpathDest: (path: string) => FILES.get(path) ?? null },
    vault: {
      getAbstractFileByPath: () => null,
      getResourcePath: (file: TFile) => `app://vault/${file.path}`
    }
  };
  const plugin = {
    app,
    registerMarkdownCodeBlockProcessor: (_: string, run: Processor) => (processor = run)
  } as unknown as Plugin;
  registerSlideshow(plugin, () => actions);

  const el = document.body.createDiv();
  (processor as Processor | null)?.(source, el, {
    sourcePath: "note.md",
    addChild: (child: { onload(): void }) => child.onload()
  });
  return el;
}

function press(el: Element | null): void {
  (el as HTMLElement | null)?.click();
}

function key(name: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: name,
    shiftKey,
    bubbles: true,
    cancelable: true
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

function openFullscreen(block: HTMLElement): void {
  press(block.querySelector(`[aria-label="${t().slideshow.fullscreen}"]`));
}

const overlay = (): HTMLElement | null => document.body.querySelector(".schreibstube-slideshow-fs");

beforeAll(() => installObsidianDom());

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the fullscreen view", () => {
  it("closes from its cross", () => {
    const block = render("![a](a.png)\n![b](b.png)");
    openFullscreen(block);
    expect(overlay()).not.toBeNull();

    press(overlay()?.querySelector(".schreibstube-slideshow-fs-close") ?? null);

    expect(overlay()).toBeNull();
  });

  it("keeps the keys it answers from Obsidian and the note behind it", () => {
    const block = render("![a](a.png)\n![b](b.png)");
    openFullscreen(block);
    const heard = vi.fn();
    window.addEventListener("keydown", heard);

    const right = key("ArrowRight");
    const escape = key("Escape");
    window.removeEventListener("keydown", heard);

    expect(right.defaultPrevented).toBe(true);
    expect(escape.defaultPrevented).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  it("holds Tab inside itself, round from the last control to the first", () => {
    const block = render("![a](a.png)\n![b](b.png)");
    openFullscreen(block);
    const stops = Array.from(
      overlay()?.querySelectorAll<HTMLElement>('[tabindex="0"]') ?? []
    ).filter((el) => el.style.display !== "none");
    stops.at(-1)?.focus();

    key("Tab");

    expect(document.activeElement).toBe(stops[0]);
    key("Tab", true);
    expect(document.activeElement).toBe(stops.at(-1));
  });

  it("shows a picture the vault lacks as its alt text, not a broken image", () => {
    const block = render("![Gone](missing.png)\n![b](b.png)");
    openFullscreen(block);

    const img = overlay()?.querySelector<HTMLImageElement>(".schreibstube-slideshow-fs-img");
    const missing = overlay()?.querySelector<HTMLElement>(".schreibstube-slideshow-fs-missing");

    expect(img?.style.display).toBe("none");
    expect(img?.hasAttribute("src")).toBe(false);
    expect(missing?.style.display).toBe("");
    expect(missing?.textContent).toBe("Gone");
  });
});

describe("the picture buttons", () => {
  it("star a picture in the header when it was starred in fullscreen", async () => {
    const starred = new Set<TFile>();
    const actions: SlideshowPictureActions = {
      stateFor: (file) => ({ describe: null, favorite: starred.has(file) }),
      describeOrOpenPicture: () => Promise.resolve(true),
      toggleFavoriteOf: (file) => {
        if (starred.has(file)) starred.delete(file);
        else starred.add(file);
        return Promise.resolve(starred.has(file));
      }
    };
    const block = render("![a](a.png)\n![b](b.png)", actions);
    const headerStar = block.querySelector(".schreibstube-slideshow-picture-action[aria-pressed]");
    openFullscreen(block);

    press(overlay()?.querySelector(".schreibstube-slideshow-picture-action[aria-pressed]") ?? null);
    await Promise.resolve();

    expect(headerStar?.classList.contains("is-favorite")).toBe(true);
    expect(headerStar?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("a gallery's pictures", () => {
  it("wait to be fetched and decoded until they near the screen", () => {
    const block = render("layout: masonry\n![a](a.png)\n![b](b.png)\n![c](c.png)");
    const images = Array.from(block.querySelectorAll("img"));

    expect(images).toHaveLength(3);
    for (const img of images) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
    }
  });
});
