// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile } from "../testing/obsidian-stub";
import { DRAFT_WIDTH_CLASS, DraftWidth } from "./draft-width";

/** A workspace that hands out its events so a test can fire them. */
function fakeWorkspace() {
  const handlers = new Map<object, () => void>();
  return {
    handlers,
    fire: () => {
      for (const handler of [...handlers.values()]) handler();
    },
    app: {
      workspace: {
        on: (_name: string, handler: () => void) => {
          const ref = {};
          handlers.set(ref, handler);
          return ref;
        },
        offref: (ref: object) => handlers.delete(ref)
      }
    } as unknown as App
  };
}

function setWindow(width: number, height: number): void {
  Object.defineProperty(window, "outerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "outerHeight", { value: height, configurable: true });
  Object.defineProperty(window.screen, "availWidth", { value: 1512, configurable: true });
  Object.defineProperty(window.screen, "availHeight", { value: 944, configurable: true });
}

function noteIn(file: TFile) {
  const containerEl = document.body.appendChild(document.createElement("div"));
  const view = Object.assign(new MarkdownView(), { containerEl, file: file as TFile | null });
  return { view, leaf: { view } as unknown as WorkspaceLeaf, el: containerEl };
}

describe("DraftWidth", () => {
  const file = new TFile("Untitled.md");

  beforeEach(() => {
    document.body.replaceChildren();
    setWindow(1512, 944);
  });

  it("widens the new note while its window fills the screen, and follows a resize", () => {
    const { app } = fakeWorkspace();
    const { leaf, el } = noteIn(file);

    new DraftWidth(app).follow(leaf, file as never);
    expect(el.classList.contains(DRAFT_WIDTH_CLASS)).toBe(true);

    setWindow(900, 700);
    window.dispatchEvent(new Event("resize"));
    expect(el.classList.contains(DRAFT_WIDTH_CLASS)).toBe(false);

    setWindow(1512, 982);
    window.dispatchEvent(new Event("resize"));
    expect(el.classList.contains(DRAFT_WIDTH_CLASS)).toBe(true);
  });

  it("leaves a window that does not fill the screen at its usual width", () => {
    setWindow(900, 700);
    const { app } = fakeWorkspace();
    const { leaf, el } = noteIn(file);

    new DraftWidth(app).follow(leaf, file as never);
    expect(el.classList.contains(DRAFT_WIDTH_CLASS)).toBe(false);
  });

  it("ends once the view shows another note, and stays ended", () => {
    const workspace = fakeWorkspace();
    const { view, leaf, el } = noteIn(file);

    new DraftWidth(workspace.app).follow(leaf, file as never);
    view.file = new TFile("Other.md");
    workspace.fire();
    expect(el.classList.contains(DRAFT_WIDTH_CLASS)).toBe(false);
    expect(workspace.handlers.size).toBe(0);

    view.file = file;
    window.dispatchEvent(new Event("resize"));
    expect(el.classList.contains(DRAFT_WIDTH_CLASS)).toBe(false);
  });

  it("ends when the window closes and its view is gone", () => {
    const workspace = fakeWorkspace();
    const { leaf, el } = noteIn(file);

    new DraftWidth(workspace.app).follow(leaf, file as never);
    el.remove();
    workspace.fire();
    expect(workspace.handlers.size).toBe(0);
  });

  it("gives every width back when the plugin stops", () => {
    const workspace = fakeWorkspace();
    const { leaf, el } = noteIn(file);
    const widths = new DraftWidth(workspace.app);

    widths.follow(leaf, file as never);
    widths.stop();
    expect(el.classList.contains(DRAFT_WIDTH_CLASS)).toBe(false);
    expect(workspace.handlers.size).toBe(0);
  });

  it("does nothing for a leaf without a Markdown view", () => {
    const workspace = fakeWorkspace();

    new DraftWidth(workspace.app).follow({ view: {} } as unknown as WorkspaceLeaf, file as never);
    expect(workspace.handlers.size).toBe(0);
  });
});
