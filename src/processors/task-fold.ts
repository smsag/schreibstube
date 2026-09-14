import { foldEffect, foldable, foldedRanges, unfoldEffect } from "@codemirror/language";
import {
  EditorState,
  type Extension,
  type StateEffect,
  type Transaction,
  type TransactionSpec
} from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { foldTransitions, taskBodyRange } from "../services/task-fold";
import { listTasks } from "../services/task-summary";

interface FoldRange {
  from: number;
  to: number;
}

/**
 * Folds a task's body when it is ticked and unfolds it when it is unticked,
 * in the editor.
 *
 * Two parts. A transaction extender watches every change to the document and
 * attaches the fold or unfold to the same transaction as the tick, so the two
 * are one undo step and never out of step with each other. A view plugin
 * folds the tasks that are already done when the editor is created, since no
 * transaction announces a note that arrives with its state.
 *
 * The folds are ordinary CodeMirror folds, the same ones Obsidian's fold
 * indicator drives, so a person can open a done task by hand and it stays
 * open until its state changes again.
 */
export function createTaskFoldExtension(): Extension {
  return [EditorState.transactionExtender.of(extendWithTaskFolds), initialFoldPlugin];
}

function extendWithTaskFolds(tr: Transaction): Pick<TransactionSpec, "effects"> | null {
  if (!tr.docChanged) return null;

  // Old tasks, keyed by the line they occupy after the change, so that a task
  // is followed through an edit above it rather than matched by position.
  const before = new Map<number, boolean>();
  const oldDoc = tr.startState.doc;
  for (const task of listTasks(oldDoc.toString())) {
    const mapped = tr.changes.mapPos(oldDoc.line(task.line + 1).from, 1);
    before.set(tr.state.doc.lineAt(mapped).number - 1, task.open);
  }

  const content = tr.state.doc.toString();
  const { fold, unfold } = foldTransitions(before, listTasks(content));
  if (fold.length === 0 && unfold.length === 0) return null;

  const lines = content.split(/\r?\n/);
  const effects: StateEffect<unknown>[] = [];
  for (const line of fold) {
    const range = foldRangeFor(tr.state, lines, line);
    if (range && !isFolded(tr.state, range)) effects.push(foldEffect.of(range));
  }
  for (const line of unfold) {
    for (const range of foldedRangesAtLine(tr.state, line)) effects.push(unfoldEffect.of(range));
  }

  return effects.length > 0 ? { effects } : null;
}

/** Every done task's body, for a note that has just been opened. */
function initialFolds(state: EditorState): StateEffect<unknown>[] {
  const content = state.doc.toString();
  const lines = content.split(/\r?\n/);
  const effects: StateEffect<unknown>[] = [];
  for (const task of listTasks(content)) {
    if (task.open) continue;
    const range = foldRangeFor(state, lines, task.line);
    if (range && !isFolded(state, range)) effects.push(foldEffect.of(range));
  }
  return effects;
}

const initialFoldPlugin = ViewPlugin.fromClass(
  class {
    private timer: number | null;

    constructor(view: EditorView) {
      // A plugin may not dispatch while it is being constructed; the next
      // turn of the event loop is soon enough and nobody sees the gap.
      this.timer = window.setTimeout(() => {
        this.timer = null;
        if (!view.dom.isConnected) return;
        const effects = initialFolds(view.state);
        if (effects.length > 0) view.dispatch({ effects });
      }, 0);
    }

    destroy(): void {
      if (this.timer !== null) window.clearTimeout(this.timer);
    }
  }
);

/**
 * The range to fold for a task on `line`. Obsidian's own fold service is
 * asked first, so the fold is exactly the one its indicator would make and
 * the two agree about what "open" means; the plain text rule stands in when
 * the service has no answer for the line.
 */
function foldRangeFor(
  state: EditorState,
  lines: readonly string[],
  line: number
): FoldRange | null {
  const docLine = state.doc.line(line + 1);
  const own = foldable(state, docLine.from, docLine.to);
  if (own) return own;

  const body = taskBodyRange(lines, line);
  if (!body) return null;
  return { from: docLine.to, to: state.doc.line(body.end + 1).to };
}

function isFolded(state: EditorState, range: FoldRange): boolean {
  let found = false;
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) found = true;
  });
  return found;
}

/** The folds that begin on `line`, whatever made them. */
function foldedRangesAtLine(state: EditorState, line: number): FoldRange[] {
  const docLine = state.doc.line(line + 1);
  const ranges: FoldRange[] = [];
  foldedRanges(state).between(docLine.from, docLine.to, (from, to) => {
    if (from >= docLine.from && from <= docLine.to) ranges.push({ from, to });
  });
  return ranges;
}
