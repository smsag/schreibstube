// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, TFile } from "../testing/obsidian-stub";
import { createReviewFollowExtension } from "./review-follow";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function editor(file: TFile | null) {
  const calls: Array<{ path: string; dom: HTMLElement; mapped: number }> = [];
  const view = new EditorView({
    state: EditorState.create({
      doc: "Die Immobilie steht.",
      extensions: [
        ...(file ? [editorInfoField.init(() => ({ file }))] : []),
        createReviewFollowExtension((path, dom, map) =>
          calls.push({ path, dom, mapped: map(4, 1) })
        )
      ]
    })
  });
  views.push(view);
  return { view, calls };
}

describe("createReviewFollowExtension", () => {
  it("hands an edit over with the note, the editor and the position map", () => {
    const { view, calls } = editor(new TFile("Note.md"));
    view.dispatch({ changes: { from: 0, insert: "Heute: " } });
    expect(calls).toEqual([{ path: "Note.md", dom: view.dom, mapped: 11 }]);
  });

  it("says nothing for a move of the cursor", () => {
    const { view, calls } = editor(new TFile("Note.md"));
    view.dispatch({ selection: EditorSelection.cursor(3) });
    expect(calls).toEqual([]);
  });

  it("says nothing for an editor that shows no note", () => {
    const { view, calls } = editor(null);
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(calls).toEqual([]);
  });
});
