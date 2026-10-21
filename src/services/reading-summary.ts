/**
 * The one-line summary under a reading entry, written from the reader's own
 * highlights.
 *
 * Instapaper keeps no summary of an article, and the article itself would cost
 * a page of tokens to say what the reader already marked as worth keeping. The
 * highlights are the shorter and the more personal source: what was summed up
 * is what the person found worth it.
 *
 * The answer is a model's, so it is held to the shape it was asked for — one
 * line, a short post's length — and escaped like any text from outside before
 * it stands in a note.
 */
import type { Locale } from "../i18n";
import { foreignLine } from "./foreign-text";
import type { Highlight } from "./instapaper-request";

/** A short post's length: read at a glance in a list. */
export const READING_SUMMARY_MAX_CHARS = 140;

/** What one request may carry. A long article marked heavily is summed up
 *  from its first passages rather than sent whole. */
export const MAX_SUMMARY_INPUT_CHARS = 8000;

/** Room for a sentence of 140 characters in any language, and no more. */
export const READING_SUMMARY_MAX_TOKENS = 120;

/** Summaries written per check; the rest are written on the checks after. */
export const MAX_SUMMARIES_PER_CHECK = 25;

const LANGUAGE: Record<Locale, string> = { de: "German", en: "English" };

export function readingSummaryPrompt(locale: Locale): string {
  return (
    "You are given passages a reader highlighted in an article, with any notes they " +
    "attached. Write one sentence that captures what the reader took from it, in the " +
    `style of a short social media post, at most ${String(READING_SUMMARY_MAX_CHARS)} ` +
    `characters, in ${LANGUAGE[locale]}. No hashtags, no emoji, no quotation marks, ` +
    "no preamble. Respond with the sentence only."
  );
}

/** The request's content, or null when there is nothing to summarize. */
export function readingSummaryInput(
  title: string,
  highlights: readonly Highlight[]
): string | null {
  const passages = highlights
    .map((highlight) => {
      const text = highlight.text.replace(/\s+/g, " ").trim();
      const note = highlight.note.replace(/\s+/g, " ").trim();
      return note.length > 0 ? `- ${text}\n  (note: ${note})` : `- ${text}`;
    })
    .filter((line) => line.length > 2);
  if (passages.length === 0) return null;

  const head = `Article: ${title.replace(/\s+/g, " ").trim()}\n\nHighlights:\n`;
  let body = "";
  for (const passage of passages) {
    if (head.length + body.length + passage.length + 1 > MAX_SUMMARY_INPUT_CHARS) break;
    body += `${passage}\n`;
  }
  // A single passage longer than the budget is cut rather than dropped:
  // dropping it would leave an article with highlights summarized from none.
  if (body.length === 0) body = passages[0]?.slice(0, MAX_SUMMARY_INPUT_CHARS - head.length) ?? "";
  return `${head}${body}`.trimEnd();
}

/**
 * The model's answer as the line under an entry, or null when it said nothing.
 *
 * A model asked for one sentence sometimes answers with a heading, a quote or
 * two lines; all of it is flattened to one line, its wrapping quotes and list
 * marks dropped, and cut at a word near the limit.
 */
export function cleanReadingSummary(raw: string): string | null {
  const flat = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[-*>#]+\s*)+/, "")
    .replace(/^["'„“”‚‘’«»]+|["'„“”‚‘’«»]+$/g, "")
    .trim();
  if (flat.length === 0) return null;

  const chars = [...flat];
  if (chars.length <= READING_SUMMARY_MAX_CHARS) return foreignLine(flat);

  const cut = chars.slice(0, READING_SUMMARY_MAX_CHARS - 1).join("");
  const atWord = cut.replace(/\s+\S*$/, "");
  return foreignLine(`${atWord.length > 0 ? atWord : cut}…`);
}
