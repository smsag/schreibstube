import { Notice, type Editor, type EditorPosition } from "obsidian";
import { t } from "../i18n";
import {
  padForInsertion,
  renderMarkdownTable,
  textToTable,
  type MarkdownTable
} from "../services/text-to-table";

export interface LineRange {
  from: EditorPosition;
  to: EditorPosition;
}

/**
 * The selection widened to whole lines, since a table cannot start or end
 * mid-line. Null unless the selection spans more than one line.
 */
export function selectedLineRange(editor: Editor): LineRange | null {
  if (!editor.somethingSelected()) return null;
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  // A selection ending at the start of a line does not include that line.
  const lastLine = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
  if (lastLine <= from.line) return null;
  return {
    from: { line: from.line, ch: 0 },
    to: { line: lastLine, ch: editor.getLine(lastLine).length }
  };
}

/** The selected lines as a table, if they have columns a plain split can find. */
export function localTable(editor: Editor, range: LineRange): MarkdownTable | null {
  return textToTable(editor.getRange(range.from, range.to), {
    name: t().ai.tableHeaderName,
    value: t().ai.tableHeaderValue
  });
}

/** Replace the lines with the table, one undo step, with the blank lines it needs to render. */
export function insertTable(editor: Editor, range: LineRange, table: MarkdownTable): void {
  const lineBefore = range.from.line > 0 ? editor.getLine(range.from.line - 1) : null;
  const lineAfter = range.to.line < editor.lastLine() ? editor.getLine(range.to.line + 1) : null;
  editor.replaceRange(
    padForInsertion(renderMarkdownTable(table), lineBefore, lineAfter),
    range.from,
    range.to
  );
}

/** The command without AI: convert, or say why nothing happened. */
export function convertSelectionToTable(editor: Editor): void {
  const range = selectedLineRange(editor);
  if (!range) {
    new Notice(t().common.notice(t().ai.tableSelectLines));
    return;
  }
  const table = localTable(editor, range);
  if (!table) {
    new Notice(t().common.notice(t().ai.tableNoColumns));
    return;
  }
  insertTable(editor, range, table);
}
