// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "../testing/obsidian-stub";
import { installObsidianDom } from "../testing/obsidian-dom";
import { createLogger } from "../services/logger";
import { MAX_THUMBNAIL_BYTES } from "../services/link-suggest-image";
import { LinkSuggestThumbnails } from "./link-suggest-thumbnails";

beforeAll(() => installObsidianDom());

type Render = (item: unknown, row: HTMLElement) => void;

/** Obsidian's own drawing of a row: the text to the left, a slot for marks to the right. */
function obsidianRow(this: unknown, _item: unknown, row: HTMLElement): void {
  row.createDiv({ cls: "suggestion-content" });
  row.createDiv({ cls: "suggestion-aux" });
}

/** The suggester behind `[[`, drawing as its class does, and one of another plugin's beside it. */
function setup(files: string[] = ["Bilder/Foto.jpg", "Logo.svg", "Notiz.md"]) {
  class LinkSuggest {
    suggestManager = { global: false };
    renderSuggestion(item: unknown, row: HTMLElement): void {
      obsidianRow.call(this, item, row);
    }
  }
  const linkSuggest = new LinkSuggest() as LinkSuggest & { renderSuggestion: Render };
  const other = { renderSuggestion: vi.fn<Render>() };
  const vault = new Map(files.map((path) => [path, new TFile(path)]));
  const app = {
    workspace: { editorSuggest: { suggests: [other, linkSuggest] } },
    vault: {
      getAbstractFileByPath: (path: string) => vault.get(path) ?? null,
      getResourcePath: (file: TFile) => `app://vault/${file.path}`
    }
  } as unknown as App;
  const warn = vi.fn();
  const logger = { ...createLogger(() => false), warn };
  const thumbnails = new LinkSuggestThumbnails(app, logger);

  const render = (item: unknown): HTMLElement => {
    const row = document.body.createDiv();
    linkSuggest.renderSuggestion(item, row);
    return row;
  };
  const fileRow = (path: string, size = 1000) => ({
    type: "file",
    path,
    file: { path, extension: path.slice(path.lastIndexOf(".") + 1), stat: { size } }
  });
  return { thumbnails, linkSuggest, LinkSuggest, other, app, warn, render, fileRow };
}

describe("LinkSuggestThumbnails", () => {
  it("draws a photo into the row's right-hand slot", () => {
    const { thumbnails, render, fileRow } = setup();
    thumbnails.start();
    const row = render(fileRow("Bilder/Foto.jpg"));
    const img = row.querySelector<HTMLImageElement>(".suggestion-aux > img");
    expect(img?.getAttribute("src")).toBe("app://vault/Bilder/Foto.jpg");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.className).toBe("schreibstube-link-suggest-thumb");
    expect(img?.loading).toBe("lazy");
    expect(row.querySelector(".suggestion-content")).not.toBeNull();
  });

  it("shows a drawing whole", () => {
    const { thumbnails, render, fileRow } = setup();
    thumbnails.start();
    const img = render(fileRow("Logo.svg")).querySelector("img");
    expect(img?.classList.contains("schreibstube-link-suggest-thumb-contain")).toBe(true);
  });

  it("leaves a note, an alias and an oversized picture as Obsidian drew them", () => {
    const { thumbnails, render, fileRow } = setup();
    thumbnails.start();
    expect(render(fileRow("Notiz.md")).querySelector("img")).toBeNull();
    expect(render({ ...fileRow("Logo.svg"), type: "alias" }).querySelector("img")).toBeNull();
    expect(
      render(fileRow("Bilder/Foto.jpg", MAX_THUMBNAIL_BYTES + 1)).querySelector("img")
    ).toBeNull();
  });

  it("draws nothing for a picture the vault does not hold", () => {
    const { thumbnails, render, fileRow } = setup();
    thumbnails.start();
    expect(render(fileRow("Weg/Fort.png")).querySelector("img")).toBeNull();
  });

  it("draws into the row itself when a build has no slot", () => {
    const { thumbnails, linkSuggest, fileRow } = setup();
    Object.getPrototypeOf(linkSuggest).renderSuggestion = () => undefined;
    thumbnails.start();
    const row = document.body.createDiv();
    linkSuggest.renderSuggestion(fileRow("Logo.svg"), row);
    expect(row.querySelector(":scope > img")).not.toBeNull();
  });

  it("takes a picture the browser cannot draw out of the row again", () => {
    const { thumbnails, render, fileRow } = setup();
    thumbnails.start();
    const row = render(fileRow("Bilder/Foto.jpg"));
    row.querySelector("img")?.dispatchEvent(new Event("error"));
    expect(row.querySelector("img")).toBeNull();
  });

  it("touches no suggester but the one for links", () => {
    const { thumbnails, other } = setup();
    const before = other.renderSuggestion;
    thumbnails.start();
    expect(other.renderSuggestion).toBe(before);
  });

  it("hands the suggester back as it was", () => {
    const { thumbnails, linkSuggest, LinkSuggest, render, fileRow } = setup();
    thumbnails.start();
    thumbnails.start();
    thumbnails.stop();
    expect(Object.prototype.hasOwnProperty.call(linkSuggest, "renderSuggestion")).toBe(false);
    expect(linkSuggest.renderSuggestion).toBe(LinkSuggest.prototype.renderSuggestion);
    expect(render(fileRow("Logo.svg")).querySelector("img")).toBeNull();
  });

  it("puts back a renderer the suggester carried itself", () => {
    const { thumbnails, linkSuggest } = setup();
    const own: Render = (item, row) => obsidianRow(item, row);
    linkSuggest.renderSuggestion = own;
    thumbnails.start();
    thumbnails.stop();
    expect(linkSuggest.renderSuggestion).toBe(own);
  });

  it("goes quiet rather than break a wrapper another plugin put on top", () => {
    const { thumbnails, linkSuggest, render, fileRow } = setup();
    thumbnails.start();
    const ours = linkSuggest.renderSuggestion;
    const theirs = vi.fn<Render>((item, row) => ours.call(linkSuggest, item, row));
    linkSuggest.renderSuggestion = theirs;
    thumbnails.stop();
    expect(linkSuggest.renderSuggestion).toBe(theirs);
    const row = render(fileRow("Logo.svg"));
    expect(theirs).toHaveBeenCalledOnce();
    expect(row.querySelector(".suggestion-aux")).not.toBeNull();
    expect(row.querySelector("img")).toBeNull();
  });

  it("keeps the row when drawing fails, and says so once", () => {
    const { thumbnails, app, warn, render, fileRow } = setup();
    (app.vault as unknown as { getResourcePath: () => string }).getResourcePath = () => {
      throw new Error("no resource");
    };
    thumbnails.start();
    const row = render(fileRow("Logo.svg"));
    render(fileRow("Bilder/Foto.jpg"));
    expect(row.querySelector(".suggestion-content")).not.toBeNull();
    expect(row.querySelector("img")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns and changes nothing when Obsidian has no link suggester to offer", () => {
    for (const editorSuggest of [undefined, {}, { suggests: "none" }, { suggests: [{}, null] }]) {
      const { app, warn } = setup();
      (app.workspace as unknown as { editorSuggest: unknown }).editorSuggest = editorSuggest;
      const thumbnails = new LinkSuggestThumbnails(app, { ...createLogger(() => false), warn });
      thumbnails.start();
      thumbnails.stop();
      expect(warn).toHaveBeenCalledOnce();
    }
  });
});
