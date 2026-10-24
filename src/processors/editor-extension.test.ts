// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorState, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { installObsidianDom } from "../testing/obsidian-dom";
import type { SchreibstubeSettings } from "../types";
import { createEditorExtension } from "./editor-extension";

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
