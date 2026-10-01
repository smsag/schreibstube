import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Platform, TFile } from "../testing/obsidian-stub";
import { pictureCards } from "../services/picture-cards";
import { PictureCardsController, type PictureCardsHooks } from "./picture-cards";

const PICTURE = "Anhänge/harness.png";
const DESCRIPTION = "Bildbeschreibungen/harness.png – 1a2b3c4d.md";
const ARTICLE = "Artikel/How a Harness Works.md";

/**
 * The parts of the app the cards reach for: the link table, the files, and a
 * leaf that remembers how it was asked to open one.
 */
function setup(options: { resolvedLinks?: Record<string, Record<string, number>> } = {}) {
  const files = new Map(
    [PICTURE, DESCRIPTION, ARTICLE].map((path, index) => {
      const file = new TFile(path);
      file.stat.mtime = 1000 + index;
      return [path, file] as const;
    })
  );
  const leaf = { openFile: vi.fn(async (_file: TFile, _state?: unknown) => {}) };
  const getLeaf = vi.fn((_where?: unknown) => leaf);
  const app = {
    vault: {
      getFileByPath: (path: string) => files.get(path) ?? null,
      getResourcePath: (file: TFile) => `app://local/${file.path}`
    },
    metadataCache: {
      resolvedLinks: options.resolvedLinks ?? {
        [DESCRIPTION]: { [PICTURE]: 2 },
        [ARTICLE]: { [PICTURE]: 1 }
      }
    },
    workspace: { getLeaf }
  };
  const hooks: PictureCardsHooks = {
    imageDescribedBy: (path) => (path === DESCRIPTION ? PICTURE : null),
    isDescriptionNote: (path) => path === DESCRIPTION,
    displayTitle: (path) => (path === ARTICLE ? "How a Harness Works" : null)
  };
  const controller = new PictureCardsController(app as unknown as App, hooks);
  return { controller, files, leaf, getLeaf };
}

describe("PictureCardsController", () => {
  it("finds the article through the link table, leaving the description out", () => {
    const { controller } = setup();
    const { cards } = pictureCards([DESCRIPTION], controller.sources());
    expect(cards).toEqual([{ picture: PICTURE, entry: DESCRIPTION, articles: [ARTICLE] }]);
  });

  it("has no article for a picture only its description refers to", () => {
    const { controller } = setup({ resolvedLinks: { [DESCRIPTION]: { [PICTURE]: 2 } } });
    const { cards } = pictureCards([DESCRIPTION], controller.sources());
    expect(cards[0]?.articles).toEqual([]);
  });

  it("takes a picture by its extension, not by a dot in a folder's name", () => {
    const sources = setup().controller.sources();
    expect(sources.isPicture(PICTURE)).toBe(true);
    expect(sources.isPicture("Archiv.png/Notiz.md")).toBe(false);
  });

  it("reads when a file last changed, and nothing for one that is gone", () => {
    const sources = setup().controller.sources();
    expect(sources.modifiedAt(ARTICLE)).toBe(1002);
    expect(sources.modifiedAt("Weg.md")).toBe(0);
  });

  it("opens an article in Reading view", async () => {
    const { controller, files, leaf, getLeaf } = setup();
    await controller.openArticle(ARTICLE, false, true);
    expect(getLeaf).toHaveBeenCalledWith(false);
    expect(leaf.openFile).toHaveBeenCalledWith(files.get(ARTICLE), {
      state: { mode: "preview" }
    });
  });

  it("opens an article as Obsidian would when the base switched Reading view off", async () => {
    const { controller, files, leaf } = setup();
    await controller.openArticle(ARTICLE, false, false);
    expect(leaf.openFile).toHaveBeenCalledWith(files.get(ARTICLE), {});
  });

  it("opens a picture the way Obsidian would", async () => {
    const { controller, files, leaf } = setup();
    await controller.openFile(PICTURE, "tab");
    expect(leaf.openFile).toHaveBeenCalledWith(files.get(PICTURE), {});
  });

  it("asks a phone for a tab where a desktop would open a window", async () => {
    const { controller, getLeaf } = setup();
    const desktop = Platform.isDesktopApp;
    Platform.isDesktopApp = false;
    try {
      await controller.openArticle(ARTICLE, "window", true);
    } finally {
      Platform.isDesktopApp = desktop;
    }
    expect(getLeaf).toHaveBeenCalledWith("tab");
  });

  it("opens nothing for a note that is gone", async () => {
    const { controller, getLeaf } = setup();
    await controller.openArticle("Weg.md", false, true);
    expect(getLeaf).not.toHaveBeenCalled();
  });

  it("calls a note by its title, else by its name without the extension", () => {
    const { controller } = setup();
    expect(controller.title(ARTICLE)).toBe("How a Harness Works");
    expect(controller.title("Notizen/Ohne Titel.md")).toBe("Ohne Titel");
  });

  it("serves a picture's URL, and none for a file that is gone", () => {
    const { controller } = setup();
    expect(controller.resourceUrl(PICTURE)).toBe(`app://local/${PICTURE}`);
    expect(controller.resourceUrl("Weg.png")).toBeNull();
  });
});
