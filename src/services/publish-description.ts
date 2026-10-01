/**
 * A published note's description, written by the model when the note has none.
 *
 * The description is the line under a page's title in the site's index and in
 * a search result, and it is the field most often left empty: a title can
 * fall back to the first heading and a date to the file's, but nothing in a
 * note says what it is about in one sentence. The model writes that sentence
 * at publish time, and the publish writes it into the note, where it can be
 * edited and from where every later publish takes it as the person's own.
 *
 * The person decides by leaving the field empty, and only then: a description
 * holding anything at all, a single space included, is theirs and is never
 * sent for. A space is how a note says "no description, and do not write one".
 */

import type { PublishKeyMap } from "./publish-index";

/** A description is a sentence or two; this leaves room for the language. */
export const DESCRIPTION_MAX_TOKENS = 200;

/**
 * How much of the note is sent. What a note is about is said at its
 * beginning; the rest costs tokens and waiting, at publish time, per note.
 */
export const DESCRIPTION_MAX_INPUT_CHARS = 8_000;

/**
 * How long one note's description may take. The publish waits for it, so a
 * slow answer delays the site; past this, the note goes out without one and
 * the next publish asks again.
 */
export const DESCRIPTION_TIMEOUT_MS = 20_000;

/** Descriptions asked for at once: few, since a provider limits a key's rate. */
export const DESCRIPTION_CONCURRENCY = 3;

/** What the prompt asks for, and a bound on what an answer may bring. */
const TARGET_CHARS = 160;
export const MAX_DESCRIPTION_CHARS = 300;

export const DESCRIPTION_SYSTEM_PROMPT =
  `You write the description of a page on a personal website: the line shown under its ` +
  `title in the site's index and in search results. Rules:\n` +
  `- One or two sentences, at most ${TARGET_CHARS} characters\n` +
  `- Say what the text is about, in the language the text is written in\n` +
  `- Plain text: no Markdown, no quotation marks around it, no heading, no label\n` +
  `- Do not begin with "This text", "This article" or the like\n` +
  `- Respond with the description only`;

/**
 * Whether the note leaves its description to the model: the key absent, or
 * present with nothing in it at all. Any character, whitespace included, and
 * any other kind of value is something the person put there.
 */
export function leavesDescriptionToModel(frontmatter: unknown, keys: PublishKeyMap): boolean {
  const record =
    typeof frontmatter === "object" && frontmatter !== null && !Array.isArray(frontmatter)
      ? (frontmatter as Record<string, unknown>)
      : {};
  const value = record[keys.description];
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** What is sent as the note: its title, then the beginning of its text. */
export function descriptionUserMessage(title: string, body: string): string {
  const text = body.trim().slice(0, DESCRIPTION_MAX_INPUT_CHARS);
  return title ? `Title: ${title}\n\n${text}` : text;
}

/**
 * The description in a model's answer, or null when it holds none.
 *
 * Models wrap a sentence in quotation marks, label it, or break it over lines
 * despite being told not to; each is undone. The length is bounded whatever
 * the answer, cut at a word, because the bridge renders it into every page
 * head and the index as it is.
 */
export function parseDescriptionResponse(raw: string): string | null {
  let text = (typeof raw === "string" ? raw : "")
    .replace(/[*`]/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/^(description|beschreibung)\s*:\s*/i, "");
  text = unquote(text).trim();
  if (text.length === 0) return null;
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;

  const cut = text.slice(0, MAX_DESCRIPTION_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

const QUOTES: readonly [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["„", "“"],
  ["«", "»"],
  ["»", "«"]
];

function unquote(text: string): string {
  for (const [open, close] of QUOTES) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length);
    }
  }
  return text;
}
