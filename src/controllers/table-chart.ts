/**
 * Charting a table, wired to the editor.
 *
 * What the table offers is decided in services/table-chart; which chart is
 * the dialog's question; this reads the note, asks, and writes the chart in
 * as one undo step.
 */
import { Notice, type App, type Editor } from "obsidian";
import { obsidianLanguageTag, t } from "../i18n";
import { numberFormatFor, type NumberStyle } from "../services/amounts";
import {
  MAX_CHART_ROWS,
  chartOffer,
  mayChart,
  placeChart,
  type ChartOffer,
  type ChartRefusal,
  type ChartSuggestion
} from "../services/table-chart";
import { TableChartModal } from "../ui/table-chart-modal";

/**
 * The note, the selected lines, and the number format the sums use, as the
 * chart decisions take them; the catalogue's chart section is their labels.
 */
function selection(editor: Editor, style: NumberStyle) {
  return [
    editor.getValue().split("\n"),
    editor.getCursor("from").line,
    editor.getCursor("to").line,
    numberFormatFor(style, obsidianLanguageTag()),
    t().chart
  ] as const;
}

/** What the selection offers. */
export function selectionChartOffer(editor: Editor, style: NumberStyle): ChartOffer {
  return chartOffer(...selection(editor, style));
}

/** Whether the menu offers a chart for the selection: cheap enough for every right-click. */
export function selectionMayChart(editor: Editor, style: NumberStyle): boolean {
  return mayChart(...selection(editor, style));
}

export function refusalText(reason: ChartRefusal): string {
  const refused = t().chart.refused;
  switch (reason) {
    case "no-table":
      return refused.noTable;
    case "too-long":
      return refused.tooLong(MAX_CHART_ROWS);
    case "no-amounts":
      return refused.noAmounts;
    case "no-groups":
      return refused.noGroups;
    case "mixed-currencies":
      return refused.mixedCurrencies;
  }
}

/** Show the charts the selected table offers, or say why it offers none. */
export function chartSelectedTable(
  app: App,
  editor: Editor,
  sourcePath: string,
  style: NumberStyle
): void {
  const offer = selectionChartOffer(editor, style);
  if (!offer.ok) {
    new Notice(t().common.notice(refusalText(offer.reason)));
    return;
  }
  new TableChartModal(app, sourcePath, offer.suggestions, offer.replaces !== null, (suggestion) =>
    insertChart(editor, offer, suggestion)
  ).open();
}

/** The chart above its table, or in place of the one made before, in one undo step. */
export function insertChart(
  editor: Editor,
  offer: Extract<ChartOffer, { ok: true }>,
  suggestion: ChartSuggestion
): void {
  const edit = placeChart(editor.getValue().split("\n"), offer, suggestion);
  if (!edit) {
    new Notice(t().common.notice(t().chart.changed));
    return;
  }
  const from = { line: edit.from, ch: 0 };
  const to = edit.to === null ? from : { line: edit.to, ch: editor.getLine(edit.to).length };
  editor.replaceRange(edit.text, from, to);
}
