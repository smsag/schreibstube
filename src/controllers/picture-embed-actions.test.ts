// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type { PaneTarget } from "../services/pane-target";
import { setIconIds } from "../testing/obsidian-stub";
import { fakeVault } from "../testing/fake-app";
import { createLogger } from "../services/logger";
import { DESCRIPTION_KEYS } from "../services/image-description";
import { setLanguage } from "../i18n";
import { PictureEmbedActions, type PictureEmbedHooks } from "./picture-embed-actions";

const PICTURE = "Bilder/kueche.png";
const NOTE = "Bildbeschreibungen/kueche.png – 1a2b3c4d.md";

/** Obsidian's markup for a picture in Live Preview, with the bar it draws over it. */
function pictureInEditor(src = "kueche.png"): { embed: HTMLElement; bar: HTMLElement } {
  const view = document.body.appendChild(document.createElement("div"));
  view.className = "markdown-source-view mod-cm6";
  const embed = view.appendChild(document.createElement("div"));
  embed.className = "internal-embed media-embed image-embed is-loaded";
  embed.setAttribute("src", src);
  embed.appendChild(document.createElement("img"));
  const bar = embed.appendChild(document.createElement("div"));
  bar.className = "embed-actions";
  for (const name of ["zoom", "edit-block-button"]) {
    bar.appendChild(document.createElement("div")).className = `embed-action ${name}`;
  }
  return { embed, bar };
}

function setup(options: { described?: boolean; favorite?: unknown; describing?: boolean } = {}) {
  const vault = fakeVault({
    notes: options.described
      ? [
          {
            path: NOTE,
            content: "",
            frontmatter: {
              [DESCRIPTION_KEYS.image]: `[[${PICTURE}]]`,
              ...(options.favorite !== undefined
                ? { [DESCRIPTION_KEYS.favorite]: options.favorite }
                : {})
            }
          }
        ]
      : [],
    binaries: [{ path: PICTURE, bytes: new Uint8Array([1]) }]
  });
  const app = {
    ...vault.app,
    vault: { ...vault.app.vault, getFileByPath: vault.app.vault.getAbstractFileByPath },
    workspace: { iterateAllLeaves: () => {} }
  };
  const described = { path: options.described ? NOTE : null };
  const hooks = {
    descriptionNoteOf: vi.fn((path: string) => (path === PICTURE ? described.path : null)),
    describe: vi.fn(async (_picture: TFile) => {
      described.path = NOTE;
    }),
    describingEnabled: vi.fn(() => options.describing ?? true),
    open: vi.fn(async (_note: TFile, _where: PaneTarget) => {})
  } satisfies PictureEmbedHooks;
  const actions = new PictureEmbedActions(
    app as unknown as App,
    hooks,
    createLogger(() => false)
  );
  // As the plugin registers them: on the document, before anything else sees the event.
  actions.attach(window, (doc, type, handler) =>
    doc.addEventListener(type, handler, { capture: true })
  );
  return { vault, hooks, actions };
}

const hover = (el: HTMLElement) => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
const press = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttons = (bar: HTMLElement) =>
  Array.from(bar.children).map((el) => (el as HTMLElement).className.split(" ").at(-1));

let actions: PictureEmbedActions | null = null;

beforeEach(() => {
  setLanguage("en");
  setIconIds(["sparkles", "wand-sparkles", "star"]);
});

afterEach(() => {
  actions?.stop();
  actions = null;
  document.body.innerHTML = "";
});

describe("the buttons on a picture's bar", () => {
  it("open a picture's description and star it, before Obsidian's own", () => {
    const setUp = setup({ described: true });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed.querySelector("img")!);

    expect(buttons(bar)).toEqual([
      "schreibstube-embed-describe",
      "schreibstube-embed-favorite",
      "zoom",
      "edit-block-button"
    ]);
    const describe = bar.querySelector(".schreibstube-embed-describe")!;
    expect(describe.getAttribute("aria-label")).toBe("Open description");
    expect(describe.querySelector("svg")?.getAttribute("data-icon")).toBe("sparkles");
    expect(describe.classList.contains("embed-action")).toBe(true);
  });

  it("offer to describe a picture without a description, and no star", () => {
    const setUp = setup();
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);

    expect(buttons(bar)).toEqual(["schreibstube-embed-describe", "zoom", "edit-block-button"]);
    expect(bar.querySelector(".schreibstube-embed-describe")?.getAttribute("aria-label")).toBe(
      "Describe picture"
    );
  });

  it("offer nothing to an undescribed picture while describing is off", () => {
    const setUp = setup({ describing: false });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);

    expect(buttons(bar)).toEqual(["zoom", "edit-block-button"]);
  });

  it("leave a picture from the web alone", () => {
    const setUp = setup({ described: true });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor("https://example.com/kueche.png");
    hover(embed);

    expect(buttons(bar)).toEqual(["zoom", "edit-block-button"]);
  });

  it("are not added outside Live Preview", () => {
    const setUp = setup({ described: true });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    embed.parentElement!.className = "markdown-reading-view";
    hover(embed);

    expect(buttons(bar)).toEqual(["zoom", "edit-block-button"]);
  });

  it("are added once, however often the pointer crosses the picture", () => {
    const setUp = setup({ described: true });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);
    hover(embed.querySelector("img")!);
    hover(bar);

    expect(bar.querySelectorAll(".schreibstube-embed-action")).toHaveLength(2);
  });
});

describe("pressing them", () => {
  it("opens the description note, in a new tab with the modifier", async () => {
    const setUp = setup({ described: true });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);
    press(bar.querySelector(".schreibstube-embed-describe")!);
    bar
      .querySelector(".schreibstube-embed-describe")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    await settle();

    expect(setUp.hooks.open.mock.calls.map(([note, where]) => [note.path, where])).toEqual([
      [NOTE, false],
      [NOTE, "tab"]
    ]);
    expect(setUp.hooks.describe).not.toHaveBeenCalled();
  });

  it("describes a picture without one, then offers to open it", async () => {
    const setUp = setup();
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);
    press(bar.querySelector(".schreibstube-embed-describe")!);
    await settle();

    expect(setUp.hooks.describe).toHaveBeenCalledTimes(1);
    expect(setUp.hooks.describe.mock.calls[0]?.[0]).toMatchObject({ path: PICTURE });
    expect(setUp.hooks.open).not.toHaveBeenCalled();
  });

  it("stars the picture in its description note, and takes the star off again", async () => {
    const setUp = setup({ described: true });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);
    const star = () => bar.querySelector(".schreibstube-embed-favorite")!;

    press(star());
    await settle();
    expect(setUp.vault.frontmatterOf(NOTE)[DESCRIPTION_KEYS.favorite]).toBe(true);
    expect(star().classList.contains("is-favorite")).toBe(true);
    expect(star().getAttribute("aria-label")).toBe("Remove from favourites");

    press(star());
    await settle();
    expect(setUp.vault.frontmatterOf(NOTE)[DESCRIPTION_KEYS.favorite]).toBe(false);
    expect(star().classList.contains("is-favorite")).toBe(false);
  });

  it("shows a star the note already has, written by hand", () => {
    const setUp = setup({ described: true, favorite: "true" });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);

    expect(bar.querySelector(".schreibstube-embed-favorite")?.getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("keeps the press from the editor", () => {
    const setUp = setup({ described: true });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);
    const reached = vi.fn();
    embed.addEventListener("click", reached);
    press(bar.querySelector(".schreibstube-embed-favorite")!);

    expect(reached).not.toHaveBeenCalled();
  });

  it("presses with Enter, as a button does", async () => {
    const setUp = setup({ described: true });
    actions = setUp.actions;
    const { embed, bar } = pictureInEditor();
    hover(embed);
    bar
      .querySelector(".schreibstube-embed-describe")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();

    expect(setUp.hooks.open).toHaveBeenCalledTimes(1);
  });
});

describe("for a surface that draws its own buttons, such as the slideshow", () => {
  const picture = (vault: ReturnType<typeof setup>["vault"]) =>
    vault.app.vault.getAbstractFileByPath(PICTURE) as TFile;

  it("says which buttons a picture gets, as the bar would", () => {
    const described = setup({ described: true, favorite: true });
    actions = described.actions;
    expect(described.actions.stateFor(picture(described.vault))).toEqual({
      describe: "open",
      favorite: true
    });
    actions.stop();
    const bare = setup({ described: false });
    actions = bare.actions;
    expect(bare.actions.stateFor(picture(bare.vault))).toEqual({
      describe: "describe",
      favorite: null
    });
  });

  it("opens the description, or writes one and says it did not open a note", async () => {
    const described = setup({ described: true });
    actions = described.actions;
    const event = new MouseEvent("click");
    expect(await described.actions.describeOrOpenPicture(picture(described.vault), event)).toBe(
      true
    );
    expect(described.hooks.open).toHaveBeenCalledTimes(1);
    actions.stop();

    const bare = setup({ described: false });
    actions = bare.actions;
    expect(await bare.actions.describeOrOpenPicture(picture(bare.vault), event)).toBe(false);
    expect(bare.hooks.describe).toHaveBeenCalledTimes(1);
  });

  it("turns the star over and answers how it stands, and nothing for a picture with no note", async () => {
    const described = setup({ described: true });
    actions = described.actions;
    expect(await described.actions.toggleFavoriteOf(picture(described.vault))).toBe(true);
    actions.stop();
    const bare = setup({ described: false });
    actions = bare.actions;
    expect(await bare.actions.toggleFavoriteOf(picture(bare.vault))).toBeNull();
  });
});

describe("stopping", () => {
  it("takes every button away again", () => {
    const setUp = setup({ described: true });
    const { embed, bar } = pictureInEditor();
    hover(embed);
    setUp.actions.stop();

    expect(buttons(bar)).toEqual(["zoom", "edit-block-button"]);
  });
});
