import { describe, expect, it } from "vitest";
import { codeFolding, foldedRanges } from "@codemirror/language";
import { EditorState, type Transaction } from "@codemirror/state";
import { createTaskFoldExtension } from "./task-fold";

/**
 * The transaction extender is the part that runs on every keystroke, so the
 * note is read only when a task line was edited. The folds it makes are
 * ordinary CodeMirror folds, read back here from the state.
 */

const NOTE = ["- [ ] task", "  body", "", "paragraph"].join("\n");

function open(doc = NOTE): EditorState {
  return EditorState.create({ doc, extensions: [codeFolding(), createTaskFoldExtension()] });
}

function folds(state: EditorState): [number, number][] {
  const ranges: [number, number][] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    ranges.push([from, to]);
  });
  return ranges;
}

function type(state: EditorState, from: number, to: number, insert: string): Transaction {
  return state.update({ changes: { from, to, insert } });
}

describe("folding a task when it is ticked", () => {
  it("folds the body of a task in the same transaction as the tick", () => {
    const ticked = type(open(), 3, 4, "x");
    // From the end of the task line to the end of its body.
    expect(folds(ticked.state)).toEqual([[10, 17]]);
  });

  it("unfolds it again when the tick is taken back", () => {
    const ticked = type(open(), 3, 4, "x").state;
    const unticked = type(ticked, 3, 4, " ");
    expect(folds(unticked.state)).toEqual([]);
  });

  it("leaves the folds alone for an edit that touches no task line", () => {
    const ticked = type(open(), 3, 4, "x").state;
    const typed = type(ticked, ticked.doc.length, ticked.doc.length, " more");
    expect(folds(typed.state)).toEqual([[10, 17]]);
    expect(typed.effects).toEqual([]);
  });

  it("follows a task through an edit above it", () => {
    const ticked = type(open(), 3, 4, "x").state;
    const shifted = type(ticked, 0, 0, "# Heading\n");
    // The fold moves with the task rather than being made again.
    expect(folds(shifted.state)).toEqual([[20, 27]]);
    expect(shifted.effects).toEqual([]);
  });
});
