/**
 * The `==highlights==` of every note, kept so the Explorer filter can search
 * them alone and open a note at the one that answered.
 *
 * A highlight is what a writer marked as worth finding again, and the text
 * index cannot tell it from the sentence around it: `text: Vertrag` answers
 * every note that mentions a contract, `markiert: Vertrag` only the ones where
 * the mention was marked. So the highlights are held apart, each with the
 * place it stands, which is what lets a press land on it rather than on the
 * top of the note.
 *
 * Filled by the same reads as the text index (`BodyLoader`), so turning this
 * on costs no second pass over the vault. Nothing here knows what Obsidian is.
 */
import { forwardMatchStrength, tokenize, type HighlightMatcher } from "./file-search";
import { MAX_NOTE_CHARS } from "./note-text";
import { findHighlightSpans, type HighlightSpan } from "./passages";

/**
 * The most highlights one note contributes. A note with more has marked
 * everything, and its first ones are as good a guide as all of them; the bound
 * is what keeps a generated note from costing every keystroke its whole text.
 */
export const MAX_HIGHLIGHTS_PER_NOTE = 200;

/**
 * The most characters of one highlight that are kept and searched. A marked
 * passage is a phrase or a sentence; a highlight running for pages is a pair
 * of marks somebody forgot to close, and its first lines say what it is.
 */
export const MAX_HIGHLIGHT_CHARS = 500;

/** The most highlights shown under one note in the result list. */
export const MAX_SNIPPETS_PER_NOTE = 3;

interface HeldHighlight {
  span: HighlightSpan;
  tokens: string[];
}

/** What a result shows under its note: some highlights, and how many more answered. */
export interface HighlightSnippets {
  shown: HighlightSpan[];
  more: number;
}

export class HighlightIndex implements HighlightMatcher {
  /** Only notes that have highlights; a note without any is simply absent. */
  private readonly notes = new Map<string, HeldHighlight[]>();

  /** Read one note's highlights, replacing what it held before. */
  set(path: string, markdown: unknown): void {
    const text = typeof markdown === "string" ? markdown.slice(0, MAX_NOTE_CHARS) : "";
    // Most notes have none, and the scan for spans is not free.
    const spans = text.includes("==")
      ? findHighlightSpans(text).slice(0, MAX_HIGHLIGHTS_PER_NOTE)
      : [];
    if (spans.length === 0) {
      this.notes.delete(path);
      return;
    }
    this.notes.set(
      path,
      spans.map((span) => {
        const kept = span.text.slice(0, MAX_HIGHLIGHT_CHARS);
        return { span: { ...span, text: kept }, tokens: tokenize(kept) };
      })
    );
  }

  delete(path: string): void {
    this.notes.delete(path);
  }

  /** Everything under a folder: a folder deleted or moved arrives as one event. */
  deleteUnder(folderPath: string): void {
    const prefix = `${folderPath}/`;
    for (const path of [...this.notes.keys()]) {
      if (path.startsWith(prefix)) this.notes.delete(path);
    }
  }

  clear(): void {
    this.notes.clear();
  }

  /** How many notes have highlights. */
  get size(): number {
    return this.notes.size;
  }

  count(path: string): number {
    return this.notes.get(path)?.length ?? 0;
  }

  /**
   * The best strength, per note, with which a word of one of its highlights
   * answers `queryToken`. Forward matches only, as for a note's text: a
   * highlight is prose, and "jahr" should not answer every marked mention of
   * a year by the shorter-form rule names are allowed.
   */
  strengths(queryToken: string): ReadonlyMap<string, number> {
    const out = new Map<string, number>();
    if (!queryToken) return out;
    for (const [path, held] of this.notes) {
      let best = 0;
      for (const { tokens } of held) {
        for (const token of tokens) best = Math.max(best, forwardMatchStrength(token, queryToken));
        if (best === 1) break;
      }
      if (best > 0) out.set(path, best);
    }
    return out;
  }

  /**
   * The highlights to show under a note for `words`, the query's own words.
   *
   * With no words — the prefix alone, or a second prefix narrowing by folder
   * or tag — a note's first highlights, in the order they stand. With words,
   * the highlights that answer any of them, those answering more of the words
   * first and otherwise in the order they stand, so the one a person typed
   * their way to is the first one offered.
   */
  snippets(path: string, words: readonly string[], max = MAX_SNIPPETS_PER_NOTE): HighlightSnippets {
    const held = this.notes.get(path) ?? [];
    if (words.length === 0) {
      const shown = held.slice(0, max).map(({ span }) => span);
      return { shown, more: held.length - shown.length };
    }
    const answering = held
      .map(({ span, tokens }, order) => ({
        span,
        order,
        answered: words.filter((word) =>
          tokens.some((token) => forwardMatchStrength(token, word) > 0)
        ).length
      }))
      .filter((entry) => entry.answered > 0)
      .sort((a, b) => b.answered - a.answered || a.order - b.order);
    const shown = answering.slice(0, max).map(({ span }) => span);
    return { shown, more: answering.length - shown.length };
  }
}

/** Where a highlight is in the note's text now, as offsets. */
export interface HighlightRange {
  from: number;
  to: number;
}

/**
 * Find a highlight in the note's text as it is when the note opens.
 *
 * The index read the note a moment or an hour ago; a line typed above it since
 * moves it down. So the place it was read at is tried first and believed only
 * if the highlight is still there, and otherwise the same highlight is looked
 * for in the text, the occurrence nearest to where it was. A highlight that is
 * gone answers null, and the note opens at its line without a mark.
 */
export function locateHighlight(doc: string, span: HighlightSpan): HighlightRange | null {
  const opening = `==${span.text}`;
  const lineStart = offsetOfLine(doc, span.line);
  if (lineStart !== null) {
    const from = lineStart + span.start;
    const to = lineStart + span.end;
    if (doc.startsWith(opening, from) && doc.slice(to - 2, to) === "==" && to - from >= 4) {
      return { from, to };
    }
  }

  const expected = (lineStart ?? 0) + span.start;
  let best: HighlightRange | null = null;
  for (let at = doc.indexOf(opening); at !== -1; at = doc.indexOf(opening, at + 1)) {
    const close = doc.indexOf("==", at + opening.length);
    const lineEnd = doc.indexOf("\n", at);
    if (close === -1 || (lineEnd !== -1 && close > lineEnd)) continue;
    const range = { from: at, to: close + 2 };
    if (best === null || Math.abs(at - expected) < Math.abs(best.from - expected)) best = range;
  }
  return best;
}

/** The offset where zero-based `line` starts, or null past the end. */
function offsetOfLine(doc: string, line: number): number | null {
  let offset = 0;
  for (let n = 0; n < line; n++) {
    const next = doc.indexOf("\n", offset);
    if (next === -1) return null;
    offset = next + 1;
  }
  return offset;
}
