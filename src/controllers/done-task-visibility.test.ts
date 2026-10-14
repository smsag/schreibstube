// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App, MarkdownPostProcessor, MarkdownPostProcessorContext, Plugin } from "obsidian";
import {
  editorInfoField,
  editorLivePreviewField,
  MarkdownView,
  TFile
} from "../testing/obsidian-stub";
import type { DoneTaskVisibility } from "../services/done-task-visibility";
import {
  DONE_TASK_OPACITY_VAR,
  DONE_TASKS_ATTRIBUTE,
  DoneTaskVisibilityController
} from "./done-task-visibility";
import { DONE_TASK_HIDDEN_CLASS } from "../processors/done-task-visibility-reading";

type Changed = (file: TFile, data: string, cache: { frontmatter?: unknown }) => void;

function setup(initial: DoneTaskVisibility = "hide") {
  const state = {
    setting: initial,
    frontmatter: {} as Record<string, unknown>
  };
  let changed: Changed = () => undefined;
  const rerender = vi.fn();
  const view = Object.assign(new MarkdownView(), {
    file: new TFile("Note.md"),
    previewMode: { rerender }
  });
  const other = Object.assign(new MarkdownView(), {
    file: new TFile("Other.md"),
    previewMode: { rerender: vi.fn() }
  });
  const app = {
    workspace: {
      updateOptions: vi.fn(),
      getLeavesOfType: () => [{ view }, { view: other }, { view: {} }]
    },
    metadataCache: {
      getCache: (path: string) =>
        path in state.frontmatter ? { frontmatter: state.frontmatter[path] } : null,
      on: (_name: string, callback: Changed) => {
        changed = callback;
        return {};
      }
    }
  } as unknown as App;

  const extensions: Extension[] = [];
  const processors: MarkdownPostProcessor[] = [];
  const cleanups: (() => void)[] = [];
  const plugin = {
    registerEditorExtension: (ext: Extension) => extensions.push(ext),
    registerMarkdownPostProcessor: (processor: MarkdownPostProcessor) => processors.push(processor),
    registerEvent: () => undefined,
    register: (cleanup: () => void) => cleanups.push(cleanup)
  } as unknown as Plugin;

  const controller = new DoneTaskVisibilityController(
    app,
    () => state.setting,
    () => 0.3
  );
  controller.start(plugin);

  const editor = (path: string | null, livePreview = true): EditorState =>
    EditorState.create({
      doc: "- [x] done\nText",
      // Away from the task, which the cursor would otherwise bring back.
      selection: { anchor: 15 },
      extensions: [
        editorInfoField.init(() => ({ file: path === null ? null : new TFile(path) })),
        ...(livePreview ? [editorLivePreviewField] : []),
        ...extensions
      ]
    });

  const read = (path: string, frontmatter?: unknown): boolean => {
    const el = document.createElement("div");
    el.innerHTML = `<ul><li class="task-list-item is-checked" data-task="x">done</li></ul>`;
    const ctx = { sourcePath: path, frontmatter } as unknown as MarkdownPostProcessorContext;
    void processors[0]?.(el, ctx);
    return el.querySelector(`.${DONE_TASK_HIDDEN_CLASS}`) !== null;
  };

  return {
    state,
    app,
    controller,
    editor,
    read,
    rerender,
    other,
    changed: (path: string, frontmatter: unknown) => changed(new TFile(path), "", { frontmatter }),
    unload: () => cleanups.forEach((cleanup) => cleanup())
  };
}

/** How many stretches the editor would hide or dim. */
function drawn(state: EditorState): number {
  let count = 0;
  for (const set of state.facet(EditorView.decorations)) {
    if (typeof set === "function") continue;
    set.between(0, state.doc.length, () => {
      count += 1;
    });
  }
  return count;
}

afterEach(() => {
  document.body.removeAttribute(DONE_TASKS_ATTRIBUTE);
  document.body.style.removeProperty(DONE_TASK_OPACITY_VAR);
});

describe("the done tasks controller", () => {
  it("marks the body as managed while the setting is on, with the dim strength", () => {
    const { state, controller, unload } = setup("dim");
    expect(document.body.getAttribute(DONE_TASKS_ATTRIBUTE)).toBe("managed");
    expect(document.body.style.getPropertyValue(DONE_TASK_OPACITY_VAR)).toBe("0.3");

    state.setting = "off";
    controller.settingChanged();
    expect(document.body.hasAttribute(DONE_TASKS_ATTRIBUTE)).toBe(false);
    expect(document.body.style.getPropertyValue(DONE_TASK_OPACITY_VAR)).toBe("");

    state.setting = "hide";
    controller.settingChanged();
    expect(document.body.getAttribute(DONE_TASKS_ATTRIBUTE)).toBe("managed");
    unload();
    expect(document.body.hasAttribute(DONE_TASKS_ATTRIBUTE)).toBe(false);
  });

  it("never sets the attribute while the setting is off", () => {
    const { unload } = setup("off");
    expect(document.body.hasAttribute(DONE_TASKS_ATTRIBUTE)).toBe(false);
    unload();
  });

  it("follows the dim strength when focus mode's setting changes", () => {
    const { unload } = setup("dim");
    document.body.style.removeProperty(DONE_TASK_OPACITY_VAR);
    window.dispatchEvent(new Event("schreibstube-focus-settings-changed"));
    expect(document.body.style.getPropertyValue(DONE_TASK_OPACITY_VAR)).toBe("0.3");
    unload();
  });

  it("hides in Live Preview, not in Source mode, and not in a note that says false", () => {
    const { state, editor, unload } = setup("hide");
    expect(drawn(editor("Note.md"))).toBe(1);
    expect(drawn(editor("Note.md", false))).toBe(0);
    expect(drawn(editor(null))).toBe(1);
    state.frontmatter["Note.md"] = { schreibstubeHideDoneTasks: false };
    expect(drawn(editor("Note.md"))).toBe(0);
    state.frontmatter["Note.md"] = { schreibstubeHideDoneTasks: "maybe" };
    expect(drawn(editor("Note.md"))).toBe(1);
    unload();
  });

  it("reads Reading view's frontmatter from the render, or else from the cache", () => {
    const { state, read, unload } = setup("hide");
    expect(read("Note.md")).toBe(true);
    expect(read("Note.md", { schreibstubeHideDoneTasks: false })).toBe(false);
    state.frontmatter["Note.md"] = { schreibstubeHideDoneTasks: false };
    expect(read("Note.md")).toBe(false);
    expect(read("Note.md", { schreibstubeHideDoneTasks: true })).toBe(true);
    state.setting = "off";
    expect(read("Note.md")).toBe(false);
    unload();
  });

  it("redraws every view when the setting changes", () => {
    const { app, controller, rerender, other, unload } = setup("hide");
    controller.settingChanged();
    expect(app.workspace.updateOptions).toHaveBeenCalledTimes(1);
    expect(rerender).toHaveBeenCalledWith(true);
    expect(other.previewMode.rerender).toHaveBeenCalledWith(true);
    unload();
  });

  it("redraws a note only when the override it was drawn with changed", () => {
    const { app, read, changed, rerender, other, unload } = setup("hide");
    // Never drawn: nothing to redraw.
    changed("Note.md", { schreibstubeHideDoneTasks: false });
    expect(app.workspace.updateOptions).not.toHaveBeenCalled();

    read("Note.md");
    changed("Note.md", { title: "an ordinary save" });
    expect(rerender).not.toHaveBeenCalled();

    changed("Note.md", { schreibstubeHideDoneTasks: false });
    expect(app.workspace.updateOptions).toHaveBeenCalledTimes(1);
    expect(rerender).toHaveBeenCalledTimes(1);
    expect(other.previewMode.rerender).not.toHaveBeenCalled();

    changed("Note.md", { schreibstubeHideDoneTasks: "false" });
    expect(rerender).toHaveBeenCalledTimes(1);
    unload();
  });
});
