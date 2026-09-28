/**
 * The total of the selected text: one amount per line, added up.
 *
 * Table rows are lines too, so selecting part of a table gives its total
 * without a formula. A formula cell in the selection is not an amount — it is
 * a total already, and counting it would count its column twice.
 */
import { amountsInText } from "./amounts";
import { compute, outcomeText, type FormulaContext, type Outcome } from "./formulas";

/**
 * Past this, a selection is read as "everything" rather than as figures to
 * add, and is not read at all: reading a whole book on every cursor move is
 * the one way this could be felt while typing.
 */
export const MAX_SELECTION_CHARS = 200_000;

export interface SelectionTotal {
  /** How many amounts were added. */
  count: number;
  outcome: Outcome;
  /** The total as text, or null when it has no number (mixed currencies). */
  text: string | null;
}

/**
 * The total of a selection, or null when there is nothing to add: fewer than
 * `minimum` amounts, or a selection too long to read. The status bar asks for
 * two — one amount is not a sum anyone needs shown — and the command for one.
 * `figuresOnly` leaves out numbers in running prose; see `amountsInText`.
 */
export function selectionTotal(
  text: string,
  ctx: FormulaContext,
  minimum = 2,
  figuresOnly = false
): SelectionTotal | null {
  if (text.length === 0 || text.length > MAX_SELECTION_CHARS) return null;
  const amounts = amountsInText(text, ctx.format, figuresOnly);
  if (amounts.length < minimum) return null;
  const outcome = compute("sum", amounts, ctx);
  return { count: amounts.length, outcome, text: outcomeText(outcome, ctx.format) };
}
