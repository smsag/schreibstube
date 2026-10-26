// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile } from "../testing/obsidian-stub";
import { DRAFT_BARE_CLASS, DRAFT_BARE_WINDOW_CLASS, DraftFocus } from "./draft-focus";
import { TYPEWRITER_CLASS } from "../processors/typewriter";

type Handler = (arg?: unknown) => void;

/** A workspace that hands out its events by name so a test can fire them. */
function fakeWorkspace() {
  const handlers = new Map<object, { name: string; handler: Handler }>();
  return {
    handlers,
    fire: (name: string, arg?: unknown) => {
      for (const entry of [...handlers.values()]) if (entry.name === name) entry.handler(arg);
    },
    app: {
      workspace: {
        on: (name: string, handler: Handler) => {
          const ref = {};
          handlers.set(ref, { name, handler });
          return ref;
        },
        offref: (ref: object) => handlers.delete(ref)
      }
    } as unknown as App
  };
}

function noteIn(file: TFile) {
  const containerEl = document.body.appendChild(document.createElement("div"));
  const editor = { getCursor: () => ({ line: 0, ch: 0 }), scrollIntoView: vi.fn() };
  const view = Object.assign(new MarkdownView(), {
    containerEl,
    editor,
    file: file as TFile | null
  });
  return { view, editor, leaf: { view } as unknown as WorkspaceLeaf, el: containerEl };
}

function bare(el: HTMLElement): boolean {
  return (
    el.classList.contains(DRAFT_BARE_CLASS) &&
    document.body.classList.contains(DRAFT_BARE_WINDOW_CLASS)
  );
}

describe("DraftFocus", () => {
  const file = new TFile("Untitled.md");

  beforeEach(() => {
    document.body.replaceChildren();
    document.body.className = "";
  });

  it("clears the note's view and window, without typewriter mode unless asked", () => {
    const { app } = fakeWorkspace();
    const { leaf, el, editor } = noteIn(file);

    new DraftFocus(app).follow(leaf, file as never, { typewriter: false });

    expect(bare(el)).toBe(true);
    expect(el.classList.contains(TYPEWRITER_CLASS)).toBe(false);
    expect(editor.scrollIntoView).not.toHaveBeenCalled();
  });

  it("starts typewriter mode with the cursor's line already in the middle", () => {
    const { app } = fakeWorkspace();
    const { leaf, el, editor } = noteIn(file);

    new DraftFocus(app).follow(leaf, file as never, { typewriter: true });

    expect(el.classList.contains(TYPEWRITER_CLASS)).toBe(true);
    expect(editor.scrollIntoView).toHaveBeenCalledWith(
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
      true
    );
  });

  it("gives everything back once the view shows another note, and stays ended", () => {
    const workspace = fakeWorkspace();
    const { view, leaf, el } = noteIn(file);

    new DraftFocus(workspace.app).follow(leaf, file as never, { typewriter: true });
    view.file = new TFile("Other.md");
    workspace.fire("file-open");

    expect(bare(el)).toBe(false);
    expect(el.classList.contains(TYPEWRITER_CLASS)).toBe(false);
    expect(document.body.classList.contains(DRAFT_BARE_WINDOW_CLASS)).toBe(false);
    expect(workspace.handlers.size).toBe(0);
  });

  it("ends when the window closes and its view is gone", () => {
    const workspace = fakeWorkspace();
    const { leaf, el } = noteIn(file);

    new DraftFocus(workspace.app).follow(leaf, file as never, { typewriter: false });
    el.remove();
    workspace.fire("layout-change");

    expect(workspace.handlers.size).toBe(0);
  });

  it("ends for another tab in the same window, not for another window", () => {
    const workspace = fakeWorkspace();
    const { leaf, el } = noteIn(file);
    new DraftFocus(workspace.app).follow(leaf, file as never, { typewriter: false });

    workspace.fire("active-leaf-change", leaf);
    workspace.fire("active-leaf-change", null);
    const otherDocument = document.implementation.createHTMLDocument("main window");
    const elsewhere = { view: { containerEl: otherDocument.createElement("div") } };
    workspace.fire("active-leaf-change", elsewhere);
    expect(bare(el)).toBe(true);

    const sameWindow = { view: { containerEl: document.createElement("div") } };
    workspace.fire("active-leaf-change", sameWindow);
    expect(bare(el)).toBe(false);
    expect(workspace.handlers.size).toBe(0);
  });

  it("gives everything back when the plugin stops", () => {
    const workspace = fakeWorkspace();
    const { leaf, el } = noteIn(file);
    const focus = new DraftFocus(workspace.app);

    focus.follow(leaf, file as never, { typewriter: true });
    focus.stop();

    expect(bare(el)).toBe(false);
    expect(el.classList.contains(TYPEWRITER_CLASS)).toBe(false);
    expect(workspace.handlers.size).toBe(0);
  });

  it("does nothing for a leaf without a Markdown view", () => {
    const workspace = fakeWorkspace();

    new DraftFocus(workspace.app).follow({ view: {} } as unknown as WorkspaceLeaf, file as never, {
      typewriter: true
    });

    expect(workspace.handlers.size).toBe(0);
    expect(document.body.classList.contains(DRAFT_BARE_WINDOW_CLASS)).toBe(false);
  });
});
