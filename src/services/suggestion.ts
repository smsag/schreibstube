/**
 * The review queue's unit of work, and the rules for putting one back into the
 * document safely.
 *
 * An offset captured when the scan ran is a guess by the time the user clicks
 * Accept: they may have typed anywhere in the note while the queue was open. So
 * a suggestion carries its original text as well as its offsets, and is
 * re-anchored against the live document before it is applied. A suggestion that
 * can no longer be placed unambiguously goes stale rather than being applied to
 * the wrong words.
 */

import type { Severity } from "./glossary-parser";

export type SuggestionKind = "replace" | "insert" | "delete";
export type SuggestionSource = "glossary" | "llm" | "remote";
export type SuggestionStatus = "pending" | "accepted" | "rejected" | "stale";

export type SuggestionCategory =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "style"
  | "terminology"
  | "capitalization"
  /** A region changed at a remote source the note mirrors. */
  | "update";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  source: SuggestionSource;
  category: SuggestionCategory;
  severity: Severity;
  /** Offsets as observed when the scan ran. */
  from: number;
  to: number;
  /** Text that stood at `[from, to)` then. The anchor of last resort. */
  original: string;
  /** Text proposed in its place. Empty for a deletion. */
  replacement: string;
  /**
   * The text that stood immediately before `from` when the scan ran.
   *
   * Only a pure insertion carries one, and only a pure insertion needs one: it
   * has no `original` of its own, so without this there is nothing to find it
   * by once the document has moved under it.
   */
  context?: string;
  /** One short line explaining the change, shown on the card. */
  note: string;
  status: SuggestionStatus;
  /** True when the proposal may need the author to fix an inflected ending. */
  needsReview?: boolean;
}

/** How far from the recorded offset to look before searching the whole note. */
const NEARBY_WINDOW = 400;

/**
 * How much of the text before a pure insertion is remembered.
 *
 * Long enough to be unique in prose, short enough that an edit inside it does
 * not throw the card away when the point it names is still perfectly findable.
 */
export const INSERT_CONTEXT = 80;

/**
 * A suggestion's identity is its span and what it proposes there.
 *
 * The panel dispatches Accept, Reject and Reveal by id, and `mergeSuggestions`
 * decides what is the same card by span, so the two must be the same thing. A
 * producer-local counter is not: `glossary-0` names a different change on every
 * scan, and a re-run that keeps a decided card from the previous one leaves two
 * cards answering to one id, where a click reaches whichever comes first.
 */
export function suggestionId(fields: Pick<Suggestion, "from" | "to" | "replacement">): string {
  return `${fields.from}:${fields.to}:${fields.replacement}`;
}

/**
 * A card, with the anchor a pure insertion needs.
 *
 * `textBefore` is whatever stood before `from` in the text the producer
 * scanned, in that text's own coordinates; its tail is kept. A producer that
 * does not pass it makes an insertion that can only ever be placed while the
 * document has not moved — which is to say, one that goes stale on the first
 * edit rather than landing somewhere wrong.
 */
export function createSuggestion(
  fields: Omit<Suggestion, "id" | "status" | "context">,
  textBefore?: string
): Suggestion {
  const context =
    fields.original.length === 0 && textBefore !== undefined
      ? textBefore.slice(-INSERT_CONTEXT)
      : "";
  return {
    id: suggestionId(fields),
    status: "pending",
    ...fields,
    ...(context.length > 0 ? { context } : {})
  };
}

export interface ResolvedAnchor {
  from: number;
  to: number;
}

/**
 * Find where a suggestion belongs in the current document text.
 *
 * In order: the recorded offsets if the text there is unchanged, then the
 * nearest occurrence within a window around them, then a whole-document search
 * that only counts if the result is unique. Anything else is unplaceable.
 */
export function resolveAnchor(docText: string, suggestion: Suggestion): ResolvedAnchor | null {
  const { from, to, original } = suggestion;

  // A pure insertion first, because the test below cannot tell it anything:
  // the empty string is what every offset in every document holds, so an
  // insertion would answer "still here" from any offset at all — including one
  // the document has since moved out from under, which is how an accepted card
  // lands in the middle of a line.
  if (original.length === 0) return resolveInsertion(docText, suggestion);

  if (from >= 0 && to <= docText.length && docText.slice(from, to) === original) {
    return { from, to };
  }

  const windowStart = Math.max(0, from - NEARBY_WINDOW);
  const windowEnd = Math.min(docText.length, to + NEARBY_WINDOW);
  const nearby = nearestOccurrence(
    docText.slice(windowStart, windowEnd),
    original,
    from - windowStart
  );
  if (nearby !== -1) {
    return { from: windowStart + nearby, to: windowStart + nearby + original.length };
  }

  const first = docText.indexOf(original);
  if (first === -1 || docText.indexOf(original, first + 1) !== -1) {
    return null;
  }
  return { from: first, to: first + original.length };
}

/**
 * Where a pure insertion belongs: after the text it was recorded behind.
 *
 * The same three steps as any other card, read against that text instead of
 * against the words being replaced — unchanged where it was, then the nearest
 * copy in a window around it, then the whole document if it says so only once.
 */
function resolveInsertion(docText: string, suggestion: Suggestion): ResolvedAnchor | null {
  const { from, context } = suggestion;
  // Nothing was recorded to find it by — an insertion at the very start of a
  // document, or a card from a producer that passes no text. It is placeable
  // only while the document is untouched, and this is not that check, so it is
  // not placed at all rather than placed on a guess.
  if (context === undefined || context.length === 0) return null;

  if (from >= context.length && docText.slice(from - context.length, from) === context) {
    return { from, to: from };
  }

  const windowStart = Math.max(0, from - context.length - NEARBY_WINDOW);
  const windowEnd = Math.min(docText.length, from + NEARBY_WINDOW);
  const nearby = nearestOccurrence(
    docText.slice(windowStart, windowEnd),
    context,
    from - context.length - windowStart
  );
  if (nearby !== -1) {
    const at = windowStart + nearby + context.length;
    return { from: at, to: at };
  }

  const first = docText.indexOf(context);
  if (first === -1 || docText.indexOf(context, first + 1) !== -1) return null;
  return { from: first + context.length, to: first + context.length };
}

function nearestOccurrence(haystack: string, needle: string, target: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, index + 1)
  ) {
    const distance = Math.abs(index - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }

  return best;
}

export interface PlannedChange {
  id: string;
  from: number;
  to: number;
  text: string;
}

export interface ApplyPlan {
  /** Changes to apply, ordered last-first so earlier offsets stay valid. */
  changes: PlannedChange[];
  /** Suggestions that could no longer be placed. */
  stale: string[];
  /** Suggestions dropped because an accepted one already covers their span. */
  conflicted: string[];
}

/**
 * Work out the edits for a batch of accepted suggestions.
 *
 * Applying in descending offset order means each change lands before any
 * earlier offset is disturbed, so the whole batch can go in as one transaction
 * and one undo step.
 */
export function planApply(docText: string, suggestions: Suggestion[]): ApplyPlan {
  const changes: PlannedChange[] = [];
  const stale: string[] = [];
  const conflicted: string[] = [];

  const anchored: PlannedChange[] = [];
  for (const suggestion of suggestions) {
    const anchor = resolveAnchor(docText, suggestion);
    if (!anchor) {
      stale.push(suggestion.id);
      continue;
    }
    anchored.push({
      id: suggestion.id,
      from: anchor.from,
      to: anchor.to,
      text: suggestion.replacement
    });
  }

  // Conflicts are decided in queue order, not by position: the caller passes
  // suggestions in the order the user sees them, so the one they accepted or
  // read first keeps its span and the overlapping one stands down.
  const kept: PlannedChange[] = [];
  for (const change of anchored) {
    const overlaps = kept.some((other) => change.from < other.to && change.to > other.from);
    if (overlaps) {
      conflicted.push(change.id);
      continue;
    }
    kept.push(change);
  }

  // Last-first ordering is correct whichever way the editor reads a batch: if
  // changes are applied one after another, every earlier offset is still valid
  // when its turn comes; if they are all taken relative to the pre-edit
  // document, order does not matter. Ascending order would only be safe under
  // the second reading.
  changes.push(...kept.sort((a, b) => b.from - a.from || b.to - a.to));

  return { changes, stale, conflicted };
}

/** Apply a plan to a string. The editor path uses the same plan through
 *  Obsidian's transaction API; this keeps the logic testable without one. */
export function applyPlan(docText: string, plan: ApplyPlan): string {
  let result = docText;
  for (const change of plan.changes) {
    result = result.slice(0, change.from) + change.text + result.slice(change.to);
  }
  return result;
}

/** Mark suggestions after a batch was applied, so the panel reflects reality
 *  without rescanning. Untouched entries keep their current status. */
export function settleStatuses(
  suggestions: Suggestion[],
  plan: ApplyPlan,
  appliedIds: Set<string>
): Suggestion[] {
  const staleIds = new Set(plan.stale);
  const conflictedIds = new Set(plan.conflicted);

  return suggestions.map((suggestion) => {
    if (appliedIds.has(suggestion.id)) {
      return { ...suggestion, status: "accepted" as const };
    }
    if (staleIds.has(suggestion.id) || conflictedIds.has(suggestion.id)) {
      return { ...suggestion, status: "stale" as const };
    }
    return suggestion;
  });
}

/** Re-check every pending suggestion against the current text, so edits made
 *  while the queue is open surface as stale cards instead of silent surprises. */
export function refreshStaleness(docText: string, suggestions: Suggestion[]): Suggestion[] {
  return suggestions.map((suggestion) => {
    if (suggestion.status !== "pending" && suggestion.status !== "stale") {
      return suggestion;
    }
    const placeable = resolveAnchor(docText, suggestion) !== null;
    const status: SuggestionStatus = placeable ? "pending" : "stale";
    return status === suggestion.status ? suggestion : { ...suggestion, status };
  });
}

/**
 * Merge a fresh scan into an open queue.
 *
 * A re-run must not resurrect a card the user already rejected, nor re-propose
 * a change they already accepted, so decisions are keyed by span and replacement
 * and survive the merge. Anything genuinely new is added in document order.
 *
 * `replaces` names the producer whose *undecided* results this scan supersedes.
 * Without it, re-running after accepting some changes would leave the previous
 * run's cards behind at offsets that have since shifted, sitting alongside the
 * new ones for the same text.
 */
export function mergeSuggestions(
  existing: Suggestion[],
  incoming: Suggestion[],
  replaces?: SuggestionSource
): Suggestion[] {
  const decided = new Map<string, Suggestion>();
  for (const suggestion of existing) {
    if (suggestion.status === "accepted" || suggestion.status === "rejected") {
      decided.set(suggestion.id, suggestion);
    }
  }

  const kept = replaces
    ? existing.filter((suggestion) => suggestion.source !== replaces || isDecided(suggestion))
    : existing;

  const merged = new Map<string, Suggestion>();
  for (const suggestion of [...kept, ...incoming]) {
    const key = suggestion.id;
    merged.set(key, decided.get(key) ?? merged.get(key) ?? suggestion);
  }

  return [...merged.values()].sort((a, b) => a.from - b.from || a.to - b.to);
}

function isDecided(suggestion: Suggestion): boolean {
  return suggestion.status === "accepted" || suggestion.status === "rejected";
}
