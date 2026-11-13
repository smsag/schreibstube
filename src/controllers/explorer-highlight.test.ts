import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { MarkdownView, TFile } from "../testing/obsidian-stub";
import { ExplorerController } from "./explorer-controller";
import { NULL_LOGGER } from "../services/logger";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";

/** A controller over a workspace whose active view is whatever `view` returns. */
function setup(view: () => unknown) {
  const openFile = vi.fn(async () => {});
  const app = {
    vault: { getAbstractFileByPath: () => null },
    workspace: {
      getLeaf: () => ({ openFile }),
      getActiveViewOfType: () => view()
    }
  } as unknown as App;
  const controller = new ExplorerController(
    app,
    () => DEFAULT_SETTINGS,
    {
      checkFile: async () => ({ checked: 0, changed: 0, failed: 0 }) as never,
      checkFolder: async () => ({ checked: 0, changed: 0, failed: 0 }) as never,
      forget: async () => {}
    },
    NULL_LOGGER,
    { read: async () => null, write: async () => {}, mtime: async () => null },
    { setTimer: () => 0, clearTimer: () => {} }
  );
  return { controller, openFile };
}

function editorView(path: string, text: string, mode = "source") {
  const scrollIntoView = vi.fn();
  const view = Object.assign(new MarkdownView(), {
    file: { path },
    getMode: () => mode,
    contentEl: { querySelector: () => null },
    editor: {
      getValue: () => text,
      offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
      scrollIntoView
    }
  });
  return { view, scrollIntoView };
}

describe("ExplorerController.openHighlight", () => {
  const file = new TFile("a.md") as never;
  const span = { line: 1, start: 4, end: 13, text: "Kaution" };

  it("opens the note at the highlight's line and scrolls to where it is now", async () => {
    const { view, scrollIntoView } = editorView("a.md", "Kopf\nneu\nDie ==Kaution==");
    const { controller, openFile } = setup(() => view);
    await controller.openHighlight(file, span, false);
    expect(openFile).toHaveBeenCalledWith(file, { eState: { line: 1 } });
    const from = "Kopf\nneu\nDie ".length;
    expect(scrollIntoView).toHaveBeenCalledWith(
      { from: { line: 0, ch: from }, to: { line: 0, ch: from + 11 } },
      true
    );
  });

  it("leaves Reading view, another note and a vanished highlight at the line", async () => {
    for (const { view, scrollIntoView } of [
      editorView("a.md", "Kopf\nDie ==Kaution==", "preview"),
      editorView("b.md", "Kopf\nDie ==Kaution=="),
      editorView("a.md", "Kopf\nDie Kaution")
    ]) {
      const { controller, openFile } = setup(() => view);
      await controller.openHighlight(file, span, "tab");
      expect(openFile).toHaveBeenCalledOnce();
      expect(scrollIntoView).not.toHaveBeenCalled();
    }
    const { controller, openFile } = setup(() => null);
    await controller.openHighlight(file, span, false);
    expect(openFile).toHaveBeenCalledOnce();
  });
});
