// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryController } from "obsidian";
import { installObsidianDom } from "../testing/obsidian-dom";
import { shownMenus } from "../testing/obsidian-stub";
import { setLanguage } from "../i18n";
import type { PictureCardSources } from "../services/picture-cards";
import { PictureCardsView, type PictureCardsHost } from "./picture-cards-view";

beforeAll(() => installObsidianDom());
beforeEach(() => {
  setLanguage("en");
  shownMenus.length = 0;
});

const PICTURE = "Anhänge/harness.png";
const DESCRIPTION = "Bildbeschreibungen/harness.png – 1a2b3c4d.md";
const ARTICLE = "Artikel/How a Harness Works.md";

/** A group of rows as a query hands it over; a key makes it a named group. */
const group = (paths: string[], key?: string) => ({
  hasKey: () => key !== undefined,
  key: key === undefined ? undefined : { toString: () => key },
  entries: paths.map((path) => ({ file: { path } }))
});

function setup(articles: Record<string, string[]>, groups = [group([DESCRIPTION])]) {
  const describes: Record<string, string> = {
    [DESCRIPTION]: PICTURE,
    "Bildbeschreibungen/kurve.png – 2b3c4d5e.md": "Anhänge/kurve.png"
  };
  const sources: PictureCardSources = {
    imageDescribedBy: (path) => describes[path] ?? null,
    isPicture: (path) => path.endsWith(".png"),
    isDescriptionNote: (path) => path in describes,
    referrers: (path) => articles[path] ?? [],
    modifiedAt: () => 0
  };
  const host = {
    sources: () => sources,
    title: (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/, ""),
    resourceUrl: (path: string) => `app://local/${path}`,
    openArticle: vi.fn(async () => {}),
    openFile: vi.fn(async () => {})
  } satisfies PictureCardsHost;

  const root = document.body.appendChild(document.createElement("div"));
  const view = new PictureCardsView({} as QueryController, root, host);
  (view as unknown as { data: unknown }).data = { groupedData: groups };
  view.onDataUpdated();
  return { root, host };
}

const cards = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(".schreibstube-picture-card"));
const press = (el: Element, init: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));

describe("PictureCardsView", () => {
  it("draws the picture and names the article it appears in", () => {
    const { root } = setup({ [PICTURE]: [ARTICLE] });
    const [card] = cards(root);
    expect(card?.querySelector("img")?.getAttribute("src")).toBe(`app://local/${PICTURE}`);
    expect(card?.querySelector(".schreibstube-picture-card-caption")?.textContent).toBe(
      "How a Harness Works"
    );
  });

  it("opens the article, not the description note behind the card", () => {
    const { root, host } = setup({ [PICTURE]: [ARTICLE] });
    press(cards(root)[0] as HTMLElement);
    expect(host.openArticle).toHaveBeenCalledWith(ARTICLE, false);
    expect(host.openFile).not.toHaveBeenCalled();
  });

  it("opens it in a new tab on a modifier press", () => {
    const { root, host } = setup({ [PICTURE]: [ARTICLE] });
    press(cards(root)[0] as HTMLElement, { metaKey: true });
    expect(host.openArticle).toHaveBeenCalledWith(ARTICLE, "tab");
  });

  it("names no article for a picture in none, and opens the picture", () => {
    const { root, host } = setup({});
    const [card] = cards(root);
    expect(card?.querySelector(".schreibstube-picture-card-caption")).toBeNull();
    press(card as HTMLElement);
    expect(host.openFile).toHaveBeenCalledWith(PICTURE, false);
    expect(host.openArticle).not.toHaveBeenCalled();
  });

  it("offers the articles when the picture is in several", () => {
    const { root, host } = setup({ [PICTURE]: [ARTICLE, "Artikel/Nachtrag.md"] });
    const [card] = cards(root);
    expect(card?.querySelector(".schreibstube-picture-card-more")?.textContent).toBe("+1");
    press(card as HTMLElement);
    expect(host.openArticle).not.toHaveBeenCalled();
    const menu = shownMenus.at(-1);
    expect(menu?.items.map((item) => item.title)).toEqual(["How a Harness Works", "Nachtrag"]);
    menu?.items[1]?.click?.(new MouseEvent("click"));
    expect(host.openArticle).toHaveBeenCalledWith("Artikel/Nachtrag.md", false);
  });

  it("offers the picture and its description from the card's menu", () => {
    const { root, host } = setup({ [PICTURE]: [ARTICLE] });
    (cards(root)[0] as HTMLElement).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    );
    const menu = shownMenus.at(-1);
    expect(menu?.items.map((item) => item.title)).toEqual([
      "How a Harness Works",
      "Open picture",
      "Open description"
    ]);
    menu?.items[2]?.click?.(new MouseEvent("click"));
    expect(host.openFile).toHaveBeenCalledWith(DESCRIPTION, false);
  });

  it("answers Enter as a press", () => {
    const { root, host } = setup({ [PICTURE]: [ARTICLE] });
    (cards(root)[0] as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    expect(host.openArticle).toHaveBeenCalledWith(ARTICLE, false);
  });

  it("keeps the base's groups and says what it left out", () => {
    const { root } = setup({}, [
      group([DESCRIPTION], "2026"),
      group(["Bildbeschreibungen/kurve.png – 2b3c4d5e.md", "Notizen/Einkauf.md"], "2025")
    ]);
    const headers = Array.from(root.querySelectorAll(".schreibstube-picture-cards-group"));
    expect(headers.map((el) => el.textContent)).toEqual(["2026", "2025"]);
    expect(cards(root)).toHaveLength(2);
    expect(root.querySelector(".schreibstube-picture-cards-note")?.textContent).toBe(
      "1 row is not a picture and is not shown."
    );
  });

  it("says so when the base holds no pictures", () => {
    const { root } = setup({}, [group(["Notizen/Einkauf.md"])]);
    expect(cards(root)).toHaveLength(0);
    const notes = Array.from(root.querySelectorAll(".schreibstube-picture-cards-note"));
    expect(notes[0]?.textContent).toMatch(/^No pictures here/);
  });
});
