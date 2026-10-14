import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateField,
  type Transaction
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
  type DoneTaskVisibility,
  finishedTaskRanges,
  mergeAdjacentRanges,
  rangesAwayFrom
} from "../services/done-task-visibility";
import type { LineRange } from "../services/task-fold";
import { MAX_LIVE_CHARS } from "./live-limits";

export const DONE_TASK_DIM_CLASS = "schreibstube-done-task-dim";

interface Visibility {
  mode: DoneTaskVisibility;
  /** Every finished task with its body, as zero-based line ranges. */
  ranges: LineRange[];
  /** The lines the selection touched when the decorations were drawn. */
  selected: LineRange[];
  decorations: DecorationSet;
}

const DIM = Decoration.line({ class: DONE_TASK_DIM_CLASS });

/**
 * A replaced block, not a class with `display: none` on the line.
 *
 * CodeMirror keeps a height for every line, measured where it is drawn and
 * estimated from its length everywhere else. A line hidden by CSS measures as
 * nothing on screen and is still estimated as a full line off screen, so the
 * scrollbar lies and the page jumps each time a stretch of hidden lines
 * scrolls into view; a click can also land on a position inside a line that
 * is not there. A block replacement is part of the height map from the start
 * — without a widget it is estimated at zero — and the editor draws nothing
 * for it, so the rest of the note scrolls as if the lines were gone. Block
 * decorations may only come from a state field, which is why this is one.
 */
const HIDE = Decoration.replace({ block: true });

/**
 * Finished tasks dimmed or hidden in Live Preview.
 *
 * `modeFor` says what the note in this editor shows — the setting, its
 * frontmatter, and "off" in Source mode — and is asked on every transaction,
 * since it reads state outside the editor. The plugin makes every editor ask
 * again, through a reconfiguration, when the answer may have changed.
 *
 * The note is read again only when it changed or the mode did; a cursor move
 * only redraws the ranges it entered or left.
 */
export function createDoneTaskVisibilityExtension(
  modeFor: (state: EditorState) => DoneTaskVisibility
): Extension {
  const field = StateField.define<Visibility>({
    create(state) {
      return draw(state, modeFor(state), null);
    },
    update(value, tr) {
      return draw(tr.state, modeFor(tr.state), { value, tr });
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations)
  });
  return field;
}

function draw(
  state: EditorState,
  mode: DoneTaskVisibility,
  previous: { value: Visibility; tr: Transaction } | null
): Visibility {
  if (mode === "off" || state.doc.length > MAX_LIVE_CHARS) {
    if (previous?.value.mode === "off") return previous.value;
    return { mode: "off", ranges: [], selected: [], decorations: Decoration.none };
  }

  const reread = !previous || previous.tr.docChanged || previous.value.mode !== mode;
  const ranges = reread ? finishedTaskRanges(state.doc.toString()) : previous.value.ranges;
  const selected = selectedLines(state);
  if (!reread && sameRanges(selected, previous.value.selected)) return previous.value;

  return { mode, ranges, selected, decorations: decorate(state, mode, ranges, selected) };
}

function selectedLines(state: EditorState): LineRange[] {
  return state.selection.ranges.map((range) => ({
    start: state.doc.lineAt(range.from).number - 1,
    end: state.doc.lineAt(range.to).number - 1
  }));
}

function sameRanges(a: readonly LineRange[], b: readonly LineRange[]): boolean {
  return (
    a.length === b.length &&
    a.every((range, index) => {
      const other = b[index];
      return other !== undefined && range.start === other.start && range.end === other.end;
    })
  );
}

function decorate(
  state: EditorState,
  mode: DoneTaskVisibility,
  ranges: readonly LineRange[],
  selected: readonly LineRange[]
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const shown = rangesAwayFrom(ranges, selected);

  if (mode === "dim") {
    for (const range of shown) {
      for (let line = range.start; line <= range.end; line += 1) {
        const from = doc.line(line + 1).from;
        builder.add(from, from, DIM);
      }
    }
    return builder.finish();
  }

  for (const range of mergeAdjacentRanges(shown)) {
    builder.add(doc.line(range.start + 1).from, doc.line(range.end + 1).to, HIDE);
  }
  return builder.finish();
}
