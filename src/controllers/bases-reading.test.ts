// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { TFile as StubFile } from "../testing/obsidian-stub";
import { createLogger } from "../services/logger";
import { BASE_PRESS_WINDOW_MS } from "../services/bases-reading";
import { BasesReadingView } from "./bases-reading";

const ARTICLE = "Artikel/How a Harness Works.md";
const BASE = "Bases/Favoriten.base";
const HOST = "Bewerbung.md";

type Where = "tab" | "embed" | "block";

/**
 * A base's results as Obsidian draws them, with a card and a link in it, its
 * toolbar beside them and a note's text elsewhere on the page — in a tab of
 * its own, embedded in a note by link, or as a code block in a note.
 */
function page(where: Where = "tab") {
  const results = `
    <div class="bases-header"><div class="bases-toolbar"><span class="sort">Sort</span></div></div>
    <div class="bases-view">
      <div class="bases-cards-item"><a class="internal-link" href="${ARTICLE}">Artikel</a></div>
    </div>`;
  const inNote = (wrapper: string) => `
    <div class="leaf" data-file="${HOST}">
      <div class="markdown-preview-view"><p>Text</p>${wrapper.replace("RESULTS", results)}</div>
    </div>`;
  document.body.innerHTML =
    where === "tab"
      ? `<div class="leaf" data-file="${BASE}">${results}</div>
         <div class="leaf" data-file="${HOST}"><div class="markdown-preview-view"><p>Text</p></div></div>`
      : where === "embed"
        ? inNote(
            `<div class="internal-embed bases-embed" src="Favoriten.base#Karten">RESULTS</div>`
          )
        : inNote(`<div class="block-language-base bases-embed">RESULTS</div>`);
  const find = (selector: string) => document.querySelector(selector) as HTMLElement;
  return {
    card: find(".bases-cards-item"),
    link: find(".internal-link"),
    toolbar: find(".sort"),
    text: find(".markdown-preview-view p")
  };
}

/** The note Obsidian shows in the active tab once something opened, and which bases read. */
function setup(options: { reading?: string[]; mode?: string; shownPath?: string } = {}) {
  let now = 10_000;
  const state = { file: options.shownPath ?? ARTICLE, mode: options.mode ?? "source" };
  const view = {
    file: { path: options.shownPath ?? ARTICLE },
    getMode: () => state.mode,
    getState: () => ({ ...state }),
    setState: vi.fn(async (next: { mode: string }, _result: unknown) => {
      state.mode = next.mode;
    })
  };
  const fileAt = (path: string) => new StubFile(path) as unknown as TFile;
  const app = {
    workspace: {
      getActiveViewOfType: () => view,
      // Each tab drawn by `page`, showing the file it says.
      iterateAllLeaves: (visit: (leaf: unknown) => void) => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".leaf"))) {
          visit({ containerEl: el, view: { file: fileAt(el.dataset.file ?? "") } });
        }
      },
      getActiveFile: () => null
    },
    metadataCache: {
      getFirstLinkpathDest: (link: string, from: string) =>
        link === "Favoriten.base" && from === HOST ? fileAt(BASE) : null
    }
  };
  const reading = new Set(options.reading ?? [BASE]);
  const view$ = new BasesReadingView(
    app as unknown as App,
    { reads: (file) => reading.has(file.path) },
    createLogger(() => false),
    () => now
  );
  view$.attach(window, (doc, type, handler) =>
    doc.addEventListener(type, handler, { capture: true })
  );
  return {
    reading: view$,
    view,
    later: (ms: number) => {
      now += ms;
    }
  };
}

const press = (el: Element) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
const note = (path = ARTICLE) => new StubFile(path) as unknown as TFile;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("BasesReadingView", () => {
  it("opens a note pressed in a base in Reading view, without a step in the history", async () => {
    const { card } = page();
    const { reading, view } = setup();
    press(card);
    await reading.opened(note());
    expect(view.setState).toHaveBeenCalledWith(
      { file: ARTICLE, mode: "preview" },
      { history: false }
    );
  });

  it("leaves the notes of a base that does not ask for it as they open", async () => {
    const { card } = page();
    const { reading, view } = setup({ reading: [] });
    press(card);
    await reading.opened(note());
    expect(view.setState).not.toHaveBeenCalled();
  });

  it("asks the base an embed links to, not the note it is embedded in", async () => {
    const { card } = page("embed");
    const asked = setup();
    press(card);
    await asked.reading.opened(note());
    expect(asked.view.setState).toHaveBeenCalledTimes(1);

    const hostOnly = setup({ reading: [HOST] });
    press(card);
    await hostOnly.reading.opened(note());
    expect(hostOnly.view.setState).not.toHaveBeenCalled();
  });

  it("leaves a press in the callouts layout to the layout's own option", async () => {
    const { card } = page();
    card.classList.add("schreibstube-passages");
    const { reading, view } = setup();
    press(card);
    await reading.opened(note());
    expect(view.setState).not.toHaveBeenCalled();
  });

  it("leaves a base written as a code block alone, which has no file to say it", async () => {
    const { card } = page("block");
    const { reading, view } = setup({ reading: [BASE, HOST] });
    press(card);
    await reading.opened(note());
    expect(view.setState).not.toHaveBeenCalled();
  });

  it("does the same for a link inside a card", async () => {
    const { link } = page();
    const { reading, view } = setup();
    press(link);
    await reading.opened(note());
    expect(view.setState).toHaveBeenCalledTimes(1);
  });

  it("answers Enter on a focused card as a press", async () => {
    const { card } = page();
    const { reading, view } = setup();
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await reading.opened(note());
    expect(view.setState).toHaveBeenCalledTimes(1);
  });

  it("leaves a note alone that was opened after a press outside the results", async () => {
    const { card, toolbar, text } = page();
    const { reading, view } = setup();
    for (const elsewhere of [toolbar, text]) {
      press(card);
      press(elsewhere);
      await reading.opened(note());
    }
    expect(view.setState).not.toHaveBeenCalled();
  });

  it("answers one press with one note", async () => {
    const { card } = page();
    const { reading, view } = setup();
    press(card);
    await reading.opened(note());
    view.setState.mockClear();
    await reading.opened(note());
    expect(view.setState).not.toHaveBeenCalled();
  });

  it("does not take a note opened long after the press for its answer", async () => {
    const { card } = page();
    const { reading, view, later } = setup();
    press(card);
    later(BASE_PRESS_WINDOW_MS + 1);
    await reading.opened(note());
    expect(view.setState).not.toHaveBeenCalled();
  });

  it("leaves a note already in Reading view, and one the active tab does not show", async () => {
    const { card } = page();
    const shown = setup({ mode: "preview" });
    press(card);
    await shown.reading.opened(note());
    expect(shown.view.setState).not.toHaveBeenCalled();

    const other = setup({ shownPath: "Anderswo.md" });
    press(card);
    await other.reading.opened(note());
    expect(other.view.setState).not.toHaveBeenCalled();
  });
});
