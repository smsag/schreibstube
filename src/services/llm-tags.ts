/**
 * Asking a model which tags a note should carry, and reading its answer.
 *
 * The model is given the vault's tags with the note, so that it answers in
 * the vault's words first and invents a tag only for what none of them
 * covers. What comes back is a proposal like any other: `tag-suggestions`
 * still maps it onto the vault's spellings and marks what is new.
 */

/** Room for a list of tags and the JSON around it, with margin. */
export const TAGS_MAX_TOKENS = 256;

/**
 * How much of the note is sent. A paper's subject is in its title and
 * abstract; the rest costs tokens and says the same again.
 */
export const TAGS_MAX_INPUT_CHARS = 12_000;

/** The vault's tags given to the model, most used first. */
export const MAX_PROMPT_TAGS = 300;

/** How many tags the model is asked for. */
export const MODEL_TAG_COUNT = 8;

/** Read at most this many from an answer, whatever it holds. */
const MAX_MODEL_TAGS = 15;
const MAX_MODEL_TAG_CHARS = 100;

/** The instruction, with the vault's tags to prefer. */
export function tagsSystemPrompt(vocabulary: readonly string[]): string {
  const known = vocabulary.slice(0, MAX_PROMPT_TAGS);
  return (
    `You suggest tags for a note in a personal knowledge base. Rules:\n` +
    `- Suggest at most ${MODEL_TAG_COUNT} tags for what the note is about, most important first\n` +
    `- Prefer a tag from the existing list when it fits, spelt exactly as listed\n` +
    `- Suggest a new tag only for a central topic no existing tag covers\n` +
    `- A tag names one concept: a word or a short phrase, words joined by hyphens, no #\n` +
    `- Write new tags in the language of the note\n` +
    `- Respond with JSON only: {"tags": string[]}\n\n` +
    (known.length > 0
      ? `Existing tags:\n${known.join("\n")}`
      : `The knowledge base has no tags yet.`)
  );
}

/** What is sent as the note: its beginning, where its subject is stated. */
export function tagsUserMessage(content: string): string {
  return content.slice(0, TAGS_MAX_INPUT_CHARS);
}

/**
 * The tags in a model's answer, or an empty list when it holds none.
 *
 * Models wrap JSON in a code fence or a sentence, and some answer with a bare
 * array; both are read. Anything but strings is dropped, and the count and
 * length are bounded whatever the answer claims.
 */
export function parseTagsResponse(raw: string): string[] {
  const text = typeof raw === "string" ? raw : "";
  const parsed = parseJsonIn(text, "{", "}") ?? parseJsonIn(text, "[", "]");
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? (parsed as { tags?: unknown }).tags
      : undefined;
  if (!Array.isArray(list)) return [];

  const tags: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const tag = item.trim();
    if (tag.length === 0 || tag.length > MAX_MODEL_TAG_CHARS) continue;
    tags.push(tag);
    if (tags.length >= MAX_MODEL_TAGS) break;
  }
  return tags;
}

function parseJsonIn(text: string, open: string, close: string): unknown {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}
