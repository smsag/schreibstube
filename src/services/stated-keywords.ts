/**
 * The keywords a note states about itself.
 *
 * A scientific paper names its own subject: a `Keywords:` line under the
 * abstract, an "Index Terms" paragraph, a `keywords` key a reference manager
 * wrote into the frontmatter. Those are the author's words for what the text
 * is about, which beats any guess, and reading them needs neither a model nor
 * the network.
 *
 * Only the first such passage is read, and only near the top: the keywords of
 * a paper stand under its abstract, and a "Keywords:" further down is more
 * likely a paper being quoted than this one being described.
 */
import { splitFrontmatter } from "./frontmatter-block";

/** How far into the note a keyword line is looked for. */
export const KEYWORD_SCAN_CHARS = 20_000;

/** The most keywords read; a paper names a handful, never dozens. */
export const MAX_STATED_KEYWORDS = 20;

/** Longer than this, a "keyword" is a sentence that happened to follow a comma. */
const MAX_KEYWORD_CHARS = 60;
const MAX_KEYWORD_WORDS = 6;

/** A keyword passage ends here even without a blank line, so prose never follows it in. */
const MAX_PASSAGE_CHARS = 1_000;

/**
 * More words than this per item on average, and a passage is prose. A paper's
 * keywords run to two words, now and then four; clauses cut at commas run
 * longer.
 */
const MAX_MEAN_KEYWORD_WORDS = 3.5;

/** Words that join clauses. A keyword never starts with one; a clause cut at a comma often does. */
const JOINING_WORDS = new Set([
  "and",
  "or",
  "but",
  "then",
  "so",
  "which",
  "that",
  "while",
  "und",
  "oder",
  "aber",
  "dann",
  "sowie",
  "wobei",
  "sodass"
]);

/** Frontmatter keys a reference manager or a person uses for keywords. */
const KEYWORD_KEY =
  /^(?:keywords?|key[\s_-]?words|schlagw(?:ö|oe)rter|schlüsselw(?:ö|oe)rter|stichw(?:ö|oe)rter|schlagworte|stichworte)$/iu;

/**
 * A line that introduces keywords: the label, perhaps as a heading, a list
 * item, a quote or in bold, then perhaps a colon or a dash, then perhaps the
 * keywords themselves.
 */
const KEYWORD_LINE =
  /^\s*(?:>\s*)*(?:[-*+]\s+)?(?:#{1,6}\s+)?(\*\*|__|\*|_)?(?:keywords?|key\s+words|index\s+terms|schlagw(?:ö|oe)rter|schlüsselw(?:ö|oe)rter|stichw(?:ö|oe)rter|schlagworte|stichworte)(?:\*\*|__|\*|_)?\s*([:：.—–]|-{1,2})?\s*(?:\*\*|__|\*|_)?\s*(.*)$/iu;

/** The keywords stated in the frontmatter and, failing that, in the text. */
export function statedKeywords(frontmatter: unknown, text: string): string[] {
  const fromFrontmatter = keywordsInFrontmatter(frontmatter);
  if (fromFrontmatter.length > 0) return fromFrontmatter;
  return keywordsInText(typeof text === "string" ? text : "");
}

function keywordsInFrontmatter(frontmatter: unknown): string[] {
  if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) {
    return [];
  }
  for (const [key, value] of Object.entries(frontmatter as Record<string, unknown>)) {
    if (!KEYWORD_KEY.test(key)) continue;
    const items = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string"
        ? [value]
        : [];
    const keywords = cleanKeywords(items.flatMap(splitKeywords));
    if (keywords.length > 0) return keywords;
  }
  return [];
}

function keywordsInText(text: string): string[] {
  const lines = splitFrontmatter(text.slice(0, KEYWORD_SCAN_CHARS)).body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = KEYWORD_LINE.exec(lines[index] ?? "");
    if (!match) continue;
    // "Keywords are what a search engine reads" is a sentence about keywords.
    // A label is set apart — by a colon or dash, by emphasis, by standing
    // alone on its line — or, the way Springer prints it, followed straight
    // by a list separated with middle dots or semicolons.
    const rest = (match[3] ?? "").trim();
    const setApart = match[1] !== undefined || match[2] !== undefined || /[;·•]/u.test(rest);
    if (rest.length > 0 && !setApart) continue;

    // The keywords follow on the same line, or — under a heading or a label
    // standing alone — in the paragraph after it. A PDF's text often wraps
    // them onto the next lines either way, so the passage runs to a blank line.
    const passage: string[] = [];
    if (rest.length > 0) passage.push(rest);
    let next = index + 1;
    if (passage.length === 0) {
      while (next < lines.length && (lines[next] ?? "").trim().length === 0) next += 1;
    }
    for (; next < lines.length; next += 1) {
      const line = (lines[next] ?? "").trim();
      if (line.length === 0 || line.startsWith("#") || KEYWORD_LINE.test(line)) break;
      passage.push(line);
      if (passage.join(" ").length > MAX_PASSAGE_CHARS) break;
    }

    // A frontmatter value is a list somebody made; a passage in the text may
    // be a paragraph that happens to follow a "Keywords" heading. Cut at its
    // commas, a paragraph leaves short clauses that each look like a keyword,
    // so a passage is judged whole: prose gives nothing, not its fragments.
    const items = splitKeywords(passage.join(" ").slice(0, MAX_PASSAGE_CHARS));
    if (readsAsProse(items)) continue;
    const keywords = cleanKeywords(items);
    if (keywords.length > 0) return keywords;
  }
  return [];
}

/** Keywords are separated by semicolons, commas, middle dots, bullets or bars. */
function splitKeywords(passage: string): string[] {
  // A linked keyword's alias is behind a bar, which also separates keywords.
  return passage
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .split(/\s*(?:[;,·•|]|\s[–—]\s)\s*/u);
}

function readsAsProse(items: readonly string[]): boolean {
  const words = items
    .map((item) =>
      item
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0)
    )
    .filter((item) => item.length > 0);
  if (words.length === 0) return false;
  let total = 0;
  for (const item of words) {
    if (item.length > MAX_KEYWORD_WORDS || item.join(" ").length > MAX_KEYWORD_CHARS) return true;
    if (JOINING_WORDS.has((item[0] ?? "").toLowerCase())) return true;
    total += item.length;
  }
  return total / words.length > MAX_MEAN_KEYWORD_WORDS;
}

function cleanKeywords(items: readonly string[]): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const keyword = item
      .replace(/[*_`"'“”„‚‘’]/g, "")
      .replace(/^[\s\-–—(]+|[\s.;:)]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (keyword.length === 0 || keyword.length > MAX_KEYWORD_CHARS) continue;
    if (keyword.split(" ").length > MAX_KEYWORD_WORDS) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length >= MAX_STATED_KEYWORDS) break;
  }
  return keywords;
}
