/**
 * Finds glossary terms in text and turns each hit into a reviewable change.
 *
 * This is the tier of the review queue that needs no API call: matching is
 * deterministic, runs offline, and costs nothing, so the panel is useful before
 * an API key is configured at all.
 *
 * Rule shapes follow Vale's vocabulary rather than inventing one. A deprecated
 * term whose concept has a preferred term is a *substitution*; one without is
 * an *existence* rule that flags and leaves the decision to the author; a
 * preferred term written in the wrong case is a *capitalization* rule.
 */

import {
  preferredTerm,
  type Glossary,
  type GlossaryTerm,
  type Severity,
  type TermStatus
} from "./glossary-parser";
import { overlapsAny, type TextRange } from "./markdown-segments";

export type HitKind = "substitution" | "existence" | "capitalization";

export interface GlossaryHit {
  from: number;
  to: number;
  matchedText: string;
  /** Proposed text, or null when the rule only flags. */
  replacement: string | null;
  kind: HitKind;
  severity: Severity;
  status: TermStatus;
  conceptId: string;
  glossaryPath: string;
  note: string;
  /** The hit matched an inflected form, so the base replacement may need the
   *  author to fix the ending. Surfaced on the card rather than guessed at. */
  inflected: boolean;
}

/** Inflectional endings tolerated after a term in `word` mode. German drives
 *  the default because the plugin's own vocabulary is German; the list is
 *  deliberately a closed set rather than a stemmer, which would overreach. */
const SUFFIXES: Record<string, string[]> = {
  de: ["e", "en", "er", "es", "em", "n", "s", "ns", "nen"],
  en: ["s", "es", "ed", "ing", "'s"]
};

const FALLBACK_SUFFIXES = ["s"];

/** Unicode-aware word edges. JavaScript's \b is ASCII-only and would split
 *  every umlaut, so lookarounds over letter and number classes stand in. */
const LEFT_EDGE = "(?<![\\p{L}\\p{N}_])";
const RIGHT_EDGE = "(?![\\p{L}\\p{N}_])";

interface CompiledTerm {
  pattern: RegExp;
  term: GlossaryTerm;
  conceptId: string;
  glossaryPath: string;
  glossaryOrder: number;
  severity: Severity;
  replacement: string | null;
}

export interface GlossaryMatcher {
  findHits(text: string, protectedRanges?: TextRange[]): GlossaryHit[];
  /** Every term that can produce a card, for the prompt constraint block. */
  constraints(): TermConstraint[];
  isEmpty(): boolean;
}

export interface TermConstraint {
  avoid: string;
  use: string | null;
  note: string;
}

/** Compile a selection of glossaries into one matcher. Earlier glossaries in
 *  the list win when two of them claim the same span. */
export function compileGlossaries(glossaries: Glossary[]): GlossaryMatcher {
  const compiled: CompiledTerm[] = [];

  glossaries.forEach((glossary, glossaryOrder) => {
    const suffixes = SUFFIXES[glossary.language] ?? FALLBACK_SUFFIXES;

    for (const concept of glossary.concepts) {
      const preferred = preferredTerm(concept);

      for (const term of concept.terms) {
        // An admitted term is acceptable usage: never flagged, never proposed.
        if (term.status === "admitted") continue;
        // A preferred term is only checked for how it is written.
        if (term.status === "preferred" && term.match === "prefix") continue;

        compiled.push({
          pattern: buildPattern(term, suffixes),
          term,
          conceptId: concept.id,
          glossaryPath: glossary.path,
          glossaryOrder,
          severity: severityFor(term.status, glossary.defaultSeverity),
          // A superseded term is historical: flag it, but never auto-fix, because
          // whether the newer term really applies is a judgement call.
          replacement: term.status === "deprecated" ? preferred : null
        });
      }
    }
  });

  return {
    isEmpty: () => compiled.length === 0,

    constraints: () =>
      compiled
        .filter((entry) => entry.term.status !== "preferred")
        .map((entry) => ({
          avoid: entry.term.text,
          use: entry.replacement,
          note: entry.term.note
        })),

    findHits(text, protectedRanges = []) {
      const hits: GlossaryHit[] = [];

      for (const entry of compiled) {
        entry.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = entry.pattern.exec(text)) !== null) {
          if (match[0].length === 0) {
            entry.pattern.lastIndex += 1;
            continue;
          }

          const from = match.index;
          const to = from + match[0].length;
          if (overlapsAny(protectedRanges, from, to)) continue;

          const hit = buildHit(entry, match[0], from, to);
          if (hit) hits.push(hit);
        }
      }

      return resolveOverlaps(hits, compiled);
    }
  };
}

function buildHit(
  entry: CompiledTerm,
  matchedText: string,
  from: number,
  to: number
): GlossaryHit | null {
  const base: Omit<GlossaryHit, "kind" | "replacement" | "severity"> = {
    from,
    to,
    matchedText,
    status: entry.term.status,
    conceptId: entry.conceptId,
    glossaryPath: entry.glossaryPath,
    note: entry.term.note,
    inflected: matchedText.length !== entry.term.text.length
  };

  if (entry.term.status === "preferred") {
    // Same word, different case: the only thing worth saying about a term that
    // is already the right one. An inflected form is left alone, since its
    // ending legitimately differs from the base form.
    if (matchedText === entry.term.text || base.inflected) return null;
    return {
      ...base,
      kind: "capitalization",
      replacement: entry.term.text,
      severity: "suggestion",
      inflected: false
    };
  }

  const replacement = entry.replacement ? matchCase(entry.replacement, matchedText) : null;

  return {
    ...base,
    kind: replacement ? "substitution" : "existence",
    replacement,
    severity: entry.severity
  };
}

/** Deprecated terms inherit the glossary's severity; a superseded term is a
 *  weaker signal about history, so it never escalates past a warning. */
function severityFor(status: TermStatus, defaultSeverity: Severity): Severity {
  if (status === "superseded") {
    return defaultSeverity === "error" ? "warning" : defaultSeverity;
  }
  return defaultSeverity;
}

function buildPattern(term: GlossaryTerm, suffixes: string[]): RegExp {
  const body = escapeRegExp(term.text);

  if (term.match === "exact") {
    return new RegExp(`${LEFT_EDGE}${body}${RIGHT_EDGE}`, "gu");
  }

  if (term.match === "prefix") {
    return new RegExp(`${LEFT_EDGE}${body}[\\p{L}\\p{N}]*${RIGHT_EDGE}`, "giu");
  }

  const tail = suffixes
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join("|");
  return new RegExp(`${LEFT_EDGE}${body}(?:${tail})?${RIGHT_EDGE}`, "giu");
}

/** Carry the casing of the text being replaced onto the replacement, so a term
 *  at the start of a sentence does not come back lowercased. */
function matchCase(replacement: string, matched: string): string {
  if (matched.length > 1 && matched === matched.toUpperCase() && /\p{L}/u.test(matched)) {
    return replacement.toUpperCase();
  }
  const first = matched[0] ?? "";
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** One span, one card. Ties break towards the earlier glossary in the selected
 *  set, then the longer match, so a specific multi-word term beats a generic
 *  single-word one. */
function resolveOverlaps(hits: GlossaryHit[], compiled: CompiledTerm[]): GlossaryHit[] {
  const order = new Map<string, number>();
  for (const entry of compiled) {
    if (!order.has(entry.glossaryPath)) {
      order.set(entry.glossaryPath, entry.glossaryOrder);
    }
  }

  const ranked = [...hits].sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    const orderA = order.get(a.glossaryPath) ?? 0;
    const orderB = order.get(b.glossaryPath) ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return b.to - a.to;
  });

  const kept: GlossaryHit[] = [];
  for (const hit of ranked) {
    if (kept.some((other) => hit.from < other.to && hit.to > other.from)) continue;
    kept.push(hit);
  }

  return kept;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
