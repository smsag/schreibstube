/**
 * Reads a folder of one note per term — the glossary Pythia writes — as a
 * glossary.
 *
 * Pythia records what a term means; it never says which word to avoid, and it
 * should not: a rule that flags someone's writing has to be a person's choice,
 * not a model's guess. So each note is a concept whose preferred term is the
 * note's term, and the only rules are the words a person listed under
 * `schreibstubeAvoid` on that note. A note with no such list checks nothing.
 *
 * The keys read from the other plugin's format are exactly `type`, `term` and
 * `language`, plus the first paragraph of the body as the definition. Each is
 * validated here, because the note is written by another plugin and edited by
 * hand.
 */

import {
  DEFAULT_GLOSSARY_LANGUAGE,
  type Glossary,
  type GlossaryConcept,
  type Severity
} from "./glossary-parser";

/** The one key this plugin writes on a term note. Prefixed like every other. */
export const TERM_AVOID_KEY = "schreibstubeAvoid";

/** Bounds on what a hand-edited list can make the matcher compile. */
export const MAX_AVOID_PER_TERM = 20;
export const MAX_AVOID_CHARS = 80;
/** A card note is a reminder of the sense, not the whole entry. */
export const MAX_DEFINITION_CHARS = 280;

export interface TermNote {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown> | null | undefined;
}

export interface TermRule {
  path: string;
  term: string;
  avoid: string[];
  /** ISO 639 code from the note, or null to use the glossary default. */
  language: string | null;
  /** The definition was written by a model, not a person. */
  byModel: boolean;
}

export type AvoidError = "empty" | "same" | "duplicate" | "tooLong" | "tooMany" | "multiline";

/** A folder path as a setting holds it: trimmed, no leading or trailing slash. */
export function normalizeTermFolder(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\/+|\/+$/g, "");
}

export function isInTermFolder(path: string, folder: string): boolean {
  return folder.length > 0 && path.startsWith(`${folder}/`);
}

/**
 * A note in the folder is a term unless it says it is something else. Pythia
 * keeps people and themes beside its terms, and a person's name is not
 * terminology; a hand-written note with no `type` is taken as a term, as
 * Pythia itself reads it.
 */
export function isTermNote(frontmatter: Record<string, unknown> | null | undefined): boolean {
  const type = frontmatter?.type;
  if (type === undefined || type === null) return true;
  return typeof type === "string" && type.trim().toLowerCase() === "term";
}

/** The term a note stands for: its `term` property when the term holds a
 *  character no file name can, otherwise the file name. */
export function termOf(note: TermNote): string {
  const term = note.frontmatter?.term;
  return typeof term === "string" && term.trim() ? term.trim() : note.basename;
}

/** The words a note lists to avoid, as untrusted input: strings only, trimmed,
 *  one line each, bounded, deduplicated ignoring case, and capped in number. */
export function readAvoidList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const word = entry.trim();
    if (!word || word.length > MAX_AVOID_CHARS || /[\r\n]/.test(word)) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length === MAX_AVOID_PER_TERM) break;
  }
  return out;
}

export function readTermRule(note: TermNote): TermRule | null {
  if (!isTermNote(note.frontmatter)) return null;
  const term = termOf(note);
  const language = note.frontmatter?.language;
  return {
    path: note.path,
    term,
    // Avoiding the term itself would flag every correct use of it.
    avoid: readAvoidList(note.frontmatter?.[TERM_AVOID_KEY]).filter(
      (word) => word.toLowerCase() !== term.toLowerCase()
    ),
    language:
      typeof language === "string" && /^[a-z]{2,3}$/i.test(language.trim())
        ? language.trim().toLowerCase()
        : null,
    byModel: note.frontmatter?.source === "model"
  };
}

/** The list after adding `word`, or why it cannot be added. */
export function addAvoid(
  current: unknown,
  word: string,
  term: string
): { list: string[] } | { error: AvoidError } {
  const clean = word.trim();
  if (!clean) return { error: "empty" };
  if (/[\r\n]/.test(clean)) return { error: "multiline" };
  if (clean.length > MAX_AVOID_CHARS) return { error: "tooLong" };
  if (clean.toLowerCase() === term.trim().toLowerCase()) return { error: "same" };
  const list = readAvoidList(current);
  if (list.some((entry) => entry.toLowerCase() === clean.toLowerCase())) {
    return { error: "duplicate" };
  }
  if (list.length >= MAX_AVOID_PER_TERM) return { error: "tooMany" };
  return { list: [...list, clean] };
}

/** The list without `word`, compared ignoring case. */
export function removeAvoid(current: unknown, word: string): string[] {
  const key = word.trim().toLowerCase();
  return readAvoidList(current).filter((entry) => entry.toLowerCase() !== key);
}

/**
 * The definition as a one-paragraph reminder: the first paragraph of the body
 * that is prose — not a context quote, not a heading — whitespace collapsed and
 * capped. Pythia writes the definition first, but a hand-edited note may not.
 */
export function definitionExcerpt(markdown: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  for (const paragraph of body.split(/\r?\n\s*\r?\n/)) {
    const text = paragraph.trim();
    if (!text || text.startsWith(">") || text.startsWith("#") || text.startsWith("```")) continue;
    const flat = text.replace(/\s+/g, " ");
    return flat.length > MAX_DEFINITION_CHARS
      ? `${flat.slice(0, MAX_DEFINITION_CHARS - 1).trimEnd()}…`
      : flat;
  }
  return "";
}

/**
 * The folder as glossaries: one per language, since the language decides which
 * inflection endings an avoided word tolerates and a glossary has one.
 *
 * The preferred term is compiled as `exact`, which the matcher does not check:
 * a folder of a few hundred model-written terms must not start flagging their
 * capitalisation at the start of every sentence. Only the listed words flag.
 */
export function buildTermFolderGlossaries(
  folder: string,
  rules: (TermRule & { note: string })[],
  fallbackLanguage: string = DEFAULT_GLOSSARY_LANGUAGE,
  defaultSeverity: Severity = "warning"
): Glossary[] {
  const byLanguage = new Map<string, GlossaryConcept[]>();
  for (const rule of rules) {
    if (rule.avoid.length === 0) continue;
    const language = rule.language ?? fallbackLanguage;
    const concepts = byLanguage.get(language) ?? [];
    concepts.push({
      id: rule.path,
      terms: [
        { text: rule.term, status: "preferred", match: "exact", note: rule.note },
        ...rule.avoid.map((word) => ({
          text: word,
          status: "deprecated" as const,
          match: "word" as const,
          note: rule.note
        }))
      ]
    });
    byLanguage.set(language, concepts);
  }
  return [...byLanguage].map(([language, concepts]) => ({
    path: folder,
    language,
    defaultSeverity,
    concepts
  }));
}

export interface TermOverlap {
  /** The word as the term note spells it. */
  text: string;
  /** The term note's term, the concept the word belongs to there. */
  term: string;
  /** The other glossary that also names the word. */
  glossaryPath: string;
}

/** How many overlaps are listed before the rest are only counted. */
export const MAX_LISTED_OVERLAPS = 5;

/**
 * Words both the term folder and another glossary name, among the glossaries
 * that apply to a note.
 *
 * Both apply, and where two claim the same words the one loaded first wins —
 * a rule nobody sees. A word defined in two places is the case where the
 * wrong one silently decides, so it is reported rather than resolved: which
 * place should keep it is the person's call.
 */
export function findTermOverlaps(glossaries: Glossary[], folder: string): TermOverlap[] {
  if (!folder) return [];
  const elsewhere = new Map<string, string>();
  for (const glossary of glossaries) {
    if (glossary.path === folder) continue;
    for (const concept of glossary.concepts) {
      for (const term of concept.terms) {
        const key = term.text.toLowerCase();
        if (!elsewhere.has(key)) elsewhere.set(key, glossary.path);
      }
    }
  }

  const overlaps: TermOverlap[] = [];
  const seen = new Set<string>();
  for (const glossary of glossaries) {
    if (glossary.path !== folder) continue;
    for (const concept of glossary.concepts) {
      const term = concept.terms.find((entry) => entry.status === "preferred")?.text ?? concept.id;
      for (const entry of concept.terms) {
        const key = entry.text.toLowerCase();
        const glossaryPath = elsewhere.get(key);
        if (glossaryPath === undefined || seen.has(key)) continue;
        seen.add(key);
        overlaps.push({ text: entry.text, term, glossaryPath });
      }
    }
  }
  return overlaps;
}

export interface TranslationSuggestion {
  /** ISO 639 code of the language the form belongs to, lowercase. */
  lang: string;
  text: string;
}

/** How many translations the rule dialog offers at most. */
export const MAX_TRANSLATION_SUGGESTIONS = 8;

/**
 * The term's recorded translations (`term_<lang>`, written by Pythia), offered
 * as words to avoid — a German text that says "cartel law" where the house
 * term is "Kartellrecht" is the common case.
 *
 * Offered, never applied: a translation is a model's answer to "what is this
 * called in English", not a decision that the English form is wrong in a
 * German text. Choosing one fills the field; the person still presses Add.
 * The note's own language is left out (that form is the term), and so is any
 * form already listed, the term itself, or one no rule could hold.
 */
export function translationSuggestions(
  frontmatter: Record<string, unknown> | null | undefined,
  term: string
): TranslationSuggestion[] {
  if (!frontmatter) return [];
  const own =
    typeof frontmatter.language === "string" ? frontmatter.language.trim().toLowerCase() : "";
  const listed = new Set(
    readAvoidList(frontmatter[TERM_AVOID_KEY]).map((word) => word.toLowerCase())
  );
  listed.add(term.trim().toLowerCase());

  const out: TranslationSuggestion[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    const lang = /^term_([a-z]{2,3})$/i.exec(key)?.[1]?.toLowerCase();
    if (!lang || lang === own || typeof value !== "string") continue;
    const text = value.trim();
    if (!text || text.length > MAX_AVOID_CHARS || /[\r\n]/.test(text)) continue;
    if (listed.has(text.toLowerCase())) continue;
    listed.add(text.toLowerCase());
    out.push({ lang, text });
  }
  return out
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.text.localeCompare(b.text))
    .slice(0, MAX_TRANSLATION_SUGGESTIONS);
}
