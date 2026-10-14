// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { type DecorationSet, EditorView } from "@codemirror/view";
import type { DoneTaskVisibility } from "../services/done-task-visibility";
import { createDoneTaskVisibilityExtension, DONE_TASK_DIM_CLASS } from "./done-task-visibility";

/**
 * The field is asked for its mode on every transaction; the tests switch it
 * the way the plugin does, by changing what the callback answers and sending
 * a transaction.
 */

const NOTE = [
  "- [ ] open", // 0
  "- [x] done", // 11
  "  its note", // 22
  "- [-] cancelled", // 33
  "- [x] parent", // 49
  "  - [ ] child", // 62
  "Paragraph" // 76
].join("\n");

let mode: DoneTaskVisibility = "hide";
const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  mode = "hide";
});

function create(doc = NOTE, cursor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: createDoneTaskVisibilityExtension(() => mode)
  });
}

function decorations(state: EditorState): DecorationSet[] {
  return state
    .facet(EditorView.decorations)
    .filter((source): source is DecorationSet => typeof source !== "function");
}

interface Drawn {
  from: number;
  to: number;
  kind: "hide" | "dim";
}

function drawn(state: EditorState): Drawn[] {
  const out: Drawn[] = [];
  for (const set of decorations(state)) {
    set.between(0, state.doc.length, (from, to, deco) => {
      const cls = (deco.spec as { class?: string }).class;
      out.push({ from, to, kind: cls === DONE_TASK_DIM_CLASS ? "dim" : "hide" });
    });
  }
  return out;
}

describe("done tasks in Live Preview", () => {
  it("hides finished tasks with their bodies as one block per run of lines", () => {
    // Lines 1-3 are one run; the parent with an open child stays.
    expect(drawn(create())).toEqual([{ from: 11, to: 48, kind: "hide" }]);
  });

  it("dims each line of a finished task instead when asked to", () => {
    mode = "dim";
    expect(drawn(create())).toEqual([
      { from: 11, to: 11, kind: "dim" },
      { from: 22, to: 22, kind: "dim" },
      { from: 33, to: 33, kind: "dim" }
    ]);
  });

  it("draws nothing when off", () => {
    mode = "off";
    expect(drawn(create())).toEqual([]);
  });

  it("shows the task the cursor is in, whole, and only that one", () => {
    mode = "dim";
    const state = create(NOTE, 25);
    expect(drawn(state)).toEqual([{ from: 33, to: 33, kind: "dim" }]);
  });

  it("shows a task again when the cursor moves into it, and hides it when it leaves", () => {
    const start = create();
    const inside = start.update({ selection: EditorSelection.cursor(35) }).state;
    expect(drawn(inside)).toEqual([{ from: 11, to: 32, kind: "hide" }]);
    const away = inside.update({ selection: EditorSelection.cursor(80) }).state;
    expect(drawn(away)).toEqual([{ from: 11, to: 48, kind: "hide" }]);
  });

  it("keeps the same decorations for a cursor move that enters nothing", () => {
    const start = create();
    const moved = start.update({ selection: EditorSelection.cursor(3) }).state;
    expect(decorations(moved)[0]).toBe(decorations(start)[0]);
  });

  it("reads the note again after an edit, such as a tick", () => {
    const start = create("- [ ] task\nText", 14);
    expect(drawn(start)).toEqual([]);
    const ticked = start.update({ changes: { from: 3, to: 4, insert: "x" } }).state;
    expect(drawn(ticked)).toEqual([{ from: 0, to: 10, kind: "hide" }]);
  });

  it("follows a change of mode on the next transaction", () => {
    const start = create();
    mode = "off";
    const off = start.update({ effects: StateEffect.appendConfig.of([]) }).state;
    expect(drawn(off)).toEqual([]);
    mode = "dim";
    const dim = off.update({}).state;
    expect(drawn(dim).every((d) => d.kind === "dim")).toBe(true);
  });

  it("leaves a note above the live limit alone", () => {
    const long = "- [x] done\n" + "a".repeat(200_001);
    expect(drawn(create(long, long.length))).toEqual([]);
  });

  it("draws in a real editor, where block replacements must come from a field", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state: create(), parent });
    views.push(view);
    const lines = Array.from(view.contentDOM.querySelectorAll(".cm-line"), (el) => el.textContent);
    expect(lines).toEqual(["- [ ] open", "- [x] parent", "  - [ ] child", "Paragraph"]);
  });
});
