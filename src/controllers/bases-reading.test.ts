// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { TFile as StubFile } from "../testing/obsidian-stub";
import { createLogger } from "../services/logger";
import { BASE_PRESS_WINDOW_MS } from "../services/bases-reading";
import { BasesReadingView } from "./bases-reading";

const ARTICLE = "Artikel/How a Harness Works.md";

/**
 * A base's results as Obsidian draws them, with a card and a link in it,
 * its toolbar beside them, and a note's text elsewhere on the page.
 */
function page(): { card: HTMLElement; link: HTMLElement; toolbar: HTMLElement; text: HTMLElement } {
  document.body.innerHTML = `
    <div class="bases-header"><div class="bases-toolbar"><span class="sort">Sort</span></div></div>
    <div class="bases-view">
      <div class="bases-cards-item"><a class="internal-link" href="${ARTICLE}">Artikel</a></div>
    </div>
    <div class="markdown-preview-view"><p>Text</p></div>`;
  const find = (selector: string) => document.querySelector(selector) as HTMLElement;
  return {
    card: find(".bases-cards-item"),
    link: find(".internal-link"),
    toolbar: find(".sort"),
    text: find(".markdown-preview-view p")
  };
}

/** The note Obsidian shows in the active tab once something opened. */
function setup(options: { enabled?: boolean; mode?: string; shownPath?: string } = {}) {
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
  const app = { workspace: { getActiveViewOfType: () => view } };
  const reading = new BasesReadingView(
    app as unknown as App,
    () => options.enabled ?? true,
    createLogger(() => false),
    () => now
  );
  reading.attach(window, (doc, type, handler) =>
    doc.addEventListener(type, handler, { capture: true })
  );
  return {
    reading,
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

  it("does nothing while the setting is off", async () => {
    const { card } = page();
    const { reading, view } = setup({ enabled: false });
    press(card);
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
