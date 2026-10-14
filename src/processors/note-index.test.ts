// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownPostProcessorContext, Plugin } from "obsidian";
import { MarkdownRenderChild, MarkdownView, TFile } from "../testing/obsidian-stub";
import { setLanguage } from "../i18n";
import { installObsidianDom } from "../testing/obsidian-dom";
import { MAX_LIVE_CHARS } from "./live-limits";
import { registerNoteIndex } from "./note-index";

/**
 * The index block's wiring: where it reads the note from, which pane a fold
 * is written into, where a press on an entry goes, and that a note too slow
 * to scan is not scanned again on every keystroke. The decisions themselves
 * are tested in `services/note-index.test.ts`.
 */

type Handler = (...args: unknown[]) => void;

/** Obsidian's event emitter, as far as a block uses it: `on`, `offref`, and a trigger for the test. */
class Emitter {
  readonly refs = new Set<{ e: Emitter; name: string; handler: Handler }>();
  on(name: string, handler: Handler) {
    const ref = { e: this, name, handler };
    this.refs.add(ref);
    return ref;
  }
  offref(ref: { e: Emitter; name: string; handler: Handler }): void {
    this.refs.delete(ref);
  }
  trigger(name: string, ...args: unknown[]): void {
    for (const ref of this.refs) if (ref.name === name) ref.handler(...args);
  }
}

/** An editor over a string, with CodeMirror's line-and-column ranges. */
function fakeEditor(initial: string) {
  let value = initial;
  return {
    getValue: () => value,
    replaceRange(text: string, from: { line: number }, to: { line: number }) {
      const lines = value.split("\n");
      const inserted = text === "" ? [] : text.replace(/\n$/, "").split("\n");
      value = [...lines.slice(0, from.line), ...inserted, ...lines.slice(to.line)].join("\n");
    },
    setCursor: vi.fn(),
    scrollIntoView: vi.fn(),
    focus: vi.fn()
  };
}

type Mode = "source" | "preview";

function fakeView(path: string, mode: Mode, buffer: string) {
  return Object.assign(new MarkdownView(), {
    file: new TFile(path),
    getMode: () => mode,
    containerEl: document.createElement("div"),
    editor: fakeEditor(buffer),
    previewMode: { applyScroll: vi.fn() }
  });
}

interface Setup {
  /** The note on disk. */
  file?: string;
  /** Open panes, in the order the workspace lists them. */
  views?: ReturnType<typeof fakeView>[];
  /** The pane the block is drawn in, if any. */
  host?: ReturnType<typeof fakeView>;
  source?: string;
  section?: { lineStart: number; lineEnd: number };
}

function mount(setup: Setup) {
  const workspace = Object.assign(new Emitter(), {
    getLeavesOfType: () => (setup.views ?? []).map((view) => ({ view })),
    openLinkText: vi.fn(async () => undefined)
  });
  const metadataCache = new Emitter();
  const note = new TFile("Note.md");
  const disk = { content: setup.file ?? "" };
  const vault = {
    getAbstractFileByPath: (path: string) => (path === note.path ? note : null),
    cachedRead: async () => disk.content,
    process: vi.fn(async (_file: TFile, change: (content: string) => string) => {
      disk.content = change(disk.content);
      return disk.content;
    })
  };
  const app = { workspace, metadataCache, vault };

  let processor: (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) => void = () => undefined;
  const plugin = {
    app,
    registerMarkdownCodeBlockProcessor: (
      _language: string,
      handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
    ) => {
      processor = handler;
    }
  } as unknown as Plugin;
  registerNoteIndex(plugin);

  const el = (setup.host?.containerEl ?? document.body).createDiv();
  const children: MarkdownRenderChild[] = [];
  const ctx = {
    sourcePath: note.path,
    getSectionInfo: () => (setup.section ? { ...setup.section, text: "" } : null),
    addChild: (child: MarkdownRenderChild) => {
      children.push(child);
      child.load();
    }
  } as unknown as MarkdownPostProcessorContext;
  processor(setup.source ?? "", el, ctx);

  const head = () => el.querySelector<HTMLElement>(".schreibstube-note-index-line")!;
  const entries = () => Array.from(el.querySelectorAll<HTMLElement>("a"));
  return { el, workspace, metadataCache, vault, disk, children, head, entries };
}

const settle = () => vi.advanceTimersByTimeAsync(100);

beforeAll(() => {
  installObsidianDom();
  setLanguage("en");
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the index block, kept current", () => {
  it("reads an open editor's buffer, so a heading not yet saved is listed", async () => {
    const view = fakeView("Note.md", "source", "```schreibstube-index\n```\n## Neu");
    const { entries } = mount({ file: "## Alt", views: [view], host: view });
    await settle();
    expect(entries().map((a) => a.textContent)).toEqual(["Neu"]);
  });

  it("reads the file when no editor holds the note", async () => {
    const { entries } = mount({ file: "## Lage\n## Preis" });
    await settle();
    expect(entries().map((a) => a.textContent)).toEqual(["Lage", "Preis"]);
  });

  it("redraws after a change to its own note, and only its own", async () => {
    const view = fakeView("Note.md", "source", "## A");
    const { workspace, entries } = mount({ views: [view], host: view });
    await settle();

    view.editor.replaceRange("## A\n## B\n", { line: 0 }, { line: 1 });
    workspace.trigger("editor-change", view.editor, { file: new TFile("Other.md") });
    await settle();
    expect(entries()).toHaveLength(1);

    workspace.trigger("editor-change", view.editor, { file: view.file });
    await settle();
    expect(entries().map((a) => a.textContent)).toEqual(["A", "B"]);
  });

  it("lets go of its events and its pending redraw when it is unloaded", async () => {
    const view = fakeView("Note.md", "source", "## A");
    const { workspace, metadataCache, children, entries } = mount({ views: [view], host: view });
    await settle();

    workspace.trigger("editor-change", view.editor, { file: view.file });
    view.editor.replaceRange("## A\n## B\n", { line: 0 }, { line: 1 });
    children[0]!.unload();
    await settle();

    expect(workspace.refs.size).toBe(0);
    expect(metadataCache.refs.size).toBe(0);
    expect(entries()).toHaveLength(1);
  });
});

describe("folding the index", () => {
  const note = "- Objekt\n\n  ```schreibstube-index\n  depth: 3\n  ```\n\n## Lage";

  it("writes the fold into the editor, inside the list item the block stands in", async () => {
    const view = fakeView("Note.md", "source", note);
    const { head, vault } = mount({
      views: [view],
      host: view,
      source: "depth: 3",
      section: { lineStart: 0, lineEnd: 4 }
    });
    await settle();

    head().click();
    expect(view.editor.getValue()).toBe(
      "- Objekt\n\n  ```schreibstube-index\n  depth: 3\n  collapsed: true\n  ```\n\n## Lage"
    );
    expect(vault.process).not.toHaveBeenCalled();
  });

  it("writes into the pane being edited, not a Reading pane listed before it", async () => {
    const reading = fakeView("Note.md", "preview", note);
    const editing = fakeView("Note.md", "source", note);
    const { head, vault } = mount({
      file: note,
      views: [reading, editing],
      host: reading,
      source: "depth: 3",
      section: { lineStart: 0, lineEnd: 4 }
    });
    await settle();

    head().click();
    expect(editing.editor.getValue()).toContain("  collapsed: true\n");
    expect(vault.process).not.toHaveBeenCalled();
  });

  it("writes into the file when no editor holds the note", async () => {
    const reading = fakeView("Note.md", "preview", note);
    const { head, disk } = mount({
      file: note,
      views: [reading],
      host: reading,
      source: "depth: 3",
      section: { lineStart: 2, lineEnd: 4 }
    });
    await settle();

    head().click();
    await settle();
    expect(disk.content).toContain("  depth: 3\n  collapsed: true\n  ```");
  });

  it("finds its block again on a second press, before the note has redrawn it", async () => {
    const view = fakeView("Note.md", "source", "```schreibstube-index\n```\n## A");
    const { head } = mount({
      views: [view],
      host: view,
      section: { lineStart: 0, lineEnd: 1 }
    });
    await settle();

    head().click();
    expect(view.editor.getValue()).toBe("```schreibstube-index\ncollapsed: true\n```\n## A");
    head().click();
    expect(view.editor.getValue()).toBe("```schreibstube-index\n```\n## A");
  });

  it("writes nothing when Obsidian cannot say where the block is", async () => {
    const view = fakeView("Note.md", "source", "```schreibstube-index\n```\n## A");
    const { head } = mount({ views: [view], host: view });
    await settle();

    head().click();
    expect(view.editor.getValue()).toBe("```schreibstube-index\n```\n## A");
  });
});

describe("pressing an entry", () => {
  const text = "```schreibstube-index\n```\n\n## Lage\n\n## Preis";

  it("puts the cursor on the heading in Live Preview", async () => {
    const view = fakeView("Note.md", "source", text);
    const { entries } = mount({ views: [view], host: view });
    await settle();

    entries()[1]!.click();
    expect(view.editor.setCursor).toHaveBeenCalledWith(5, 0);
    expect(view.editor.scrollIntoView).toHaveBeenCalled();
  });

  it("scrolls Reading view to the heading", async () => {
    const view = fakeView("Note.md", "preview", text);
    const { entries } = mount({ views: [view], host: view });
    await settle();

    entries()[0]!.click();
    expect(view.previewMode.applyScroll).toHaveBeenCalledWith(3);
  });

  it("opens the note at the heading when the block is embedded in another", async () => {
    const host = fakeView("Host.md", "source", "![[Note]]");
    const { entries, workspace } = mount({ file: text, views: [host], host });
    await settle();

    entries()[1]!.click();
    expect(workspace.openLinkText).toHaveBeenCalledWith("Note.md", "", false, {
      eState: { line: 5 }
    });
  });
});

describe("a note too slow to index", () => {
  it("is not scanned at all past the live limit", async () => {
    const clock = vi.spyOn(performance, "now");
    const { el } = mount({ file: `## A\n${"x".repeat(MAX_LIVE_CHARS)}` });
    await settle();
    expect(el.textContent).toContain("took too long");
    expect(clock).not.toHaveBeenCalled();
  });

  it("is not scanned again on every keystroke once a scan ran out of time", async () => {
    const note = Array.from({ length: 2000 }, (_, i) => `## H${i}`).join("\n");
    const view = fakeView("Note.md", "source", note);
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => (now += 1000));
    const { el, workspace } = mount({ views: [view], host: view });
    await settle();
    expect(el.textContent).toContain("took too long");

    const scans = clock.mock.calls.length;
    view.editor.replaceRange(`${note}\n## Mehr\n`, { line: 0 }, { line: 2000 });
    workspace.trigger("editor-change", view.editor, { file: view.file });
    await settle();
    expect(clock.mock.calls.length).toBe(scans);

    // Shorter than the note that was too slow: worth another try.
    clock.mockImplementation(() => 0);
    view.editor.replaceRange("## Kurz\n", { line: 0 }, { line: 2001 });
    workspace.trigger("editor-change", view.editor, { file: view.file });
    await settle();
    expect(el.textContent).toContain("Kurz");
  });
});
