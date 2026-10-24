// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { resolveFocusRange } from "../services/focus-range";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { installObsidianDom } from "../testing/obsidian-dom";
import type { SchreibstubeSettings } from "../types";
import { createEditorExtension } from "./editor-extension";

/** The range is the decision; counted here, to see how often the editor asks for it. */
vi.mock("../services/focus-range", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/focus-range")>();
  return { ...actual, resolveFocusRange: vi.fn(actual.resolveFocusRange) };
});

beforeAll(() => installObsidianDom());

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * A long stretch of a line drawn as something else, the way Live Preview
 * draws inline maths or a long link: CodeMirror splits its visible ranges
 * around such a stretch, so one line is in two of them.
 */
function hiddenStretch(from: number, to: number) {
  return StateField.define({
    create: () => Decoration.set([Decoration.replace({}).range(from, to)]),
    update: (value) => value,
    provide: (field) => EditorView.decorations.from(field)
  });
}

function editor(
  doc: string,
  cursor: number,
  settings: Partial<SchreibstubeSettings>,
  hide?: [number, number]
) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        ...(hide ? [hiddenStretch(hide[0], hide[1])] : []),
        createEditorExtension({
          onViewportUpdate: () => undefined,
          getSettings: () => ({ ...DEFAULT_SETTINGS, ...settings })
        })
      ]
    }),
    parent: document.body.createDiv()
  });
  view.focus();
  view.dispatch({});
  return view;
}

describe("focus mode on a line CodeMirror shows in two parts", () => {
  it("still draws the sentence", () => {
    const line = "Vorher. Die Formel $" + "x".repeat(40) + "$ steht hier. Danach.";
    const start = line.indexOf("$");
    const view = editor(line, line.indexOf("steht"), { focusMode: "sentence" }, [
      start,
      start + 42
    ]);
    expect(view.visibleRanges.length).toBeGreaterThan(1);
    expect(view.dom.querySelectorAll(".schreibstube-focus-sentence").length).toBeGreaterThan(0);
  });
});

describe("focus mode on a transaction that changes nothing it draws", () => {
  it("does not read the note again", () => {
    const view = editor("Ein Absatz.\n\nNoch einer.", 3, { focusMode: "paragraph" });
    const asked = vi.mocked(resolveFocusRange);
    asked.mockClear();

    // An effect of some other extension's: no edit, no cursor move, no focus change.
    view.dispatch({ effects: StateEffect.define<null>().of(null) });
    expect(asked).not.toHaveBeenCalled();

    view.dispatch({ selection: { anchor: 15 } });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(view.dom.querySelectorAll(".schreibstube-focus-active")).toHaveLength(1);
  });

  it("follows a change of the settings, which arrives without one", () => {
    let opacity = 0.3;
    const view = new EditorView({
      state: EditorState.create({
        doc: "Ein Absatz.",
        extensions: createEditorExtension({
          onViewportUpdate: () => undefined,
          getSettings: () => ({
            ...DEFAULT_SETTINGS,
            focusMode: "paragraph",
            focusDimOpacity: opacity
          })
        })
      }),
      parent: document.body.createDiv()
    });
    view.focus();
    view.dispatch({});
    opacity = 0.6;
    window.dispatchEvent(new Event("schreibstube-focus-settings-changed"));
    expect(view.dom.style.getPropertyValue("--schreibstube-focus-dim-opacity")).toBe("0.6");
    view.destroy();
  });
});
