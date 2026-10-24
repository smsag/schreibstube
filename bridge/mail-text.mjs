/**
 * The text of a mail that came as HTML only. Pure, and linear in the length
 * of what it reads: the HTML is the sender's, and anyone may send it.
 *
 * It used to be a chain of regular expressions, two of which scanned to the
 * end of the text from every `<` that had no partner: a mail of nothing but
 * `<a<a<a…` took seconds per message to read, and a search reads fifty.
 */

/** How much HTML is worth reading for `maxTextChars` of text: tags and
 *  entities take room, a message is mostly them, and beyond a few times the
 *  limit nothing kept can come from it. */
export const HTML_TEXT_RATIO = 4;

/** The elements whose content is never text. */
const HIDDEN_ELEMENTS = ["script", "style"];

/** The entities an HTML mail spells its text with, each read once. */
const ENTITIES = new Map([
  ["nbsp", " "],
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["#39", "'"]
]);

/** Last-resort plain text for HTML-only mail. Deliberately crude: block-level
 *  tags become line breaks, everything else is dropped. Good enough to read in
 *  a note; anything richer belongs in a proper converter. */
export function htmlToText(html, maxTextChars) {
  const blocks = withoutElements(String(html).slice(0, HTML_TEXT_RATIO * maxTextChars))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n");
  // One pass over the entities, so `&amp;lt;` is the `&lt;` it spells
  // rather than a `<` read out of a decoded `&`.
  return withoutTags(blocks)
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_whole, name) => ENTITIES.get(name))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * `<script>…</script>` and `<style>…</style>` taken out with what they hold,
 * matched without regard to case. One that never closes stays, and loses only
 * its tag later, as it always did. Each kind's next opening is remembered, so
 * the text is walked once however the two interleave.
 */
function withoutElements(html) {
  // ASCII only, so an index into the copy is the same index into the text.
  const lower = html.replace(/[A-Z]+/g, (run) => run.toLowerCase());
  const next = new Map(HIDDEN_ELEMENTS.map((name) => [name, -1]));
  let out = "";
  let at = 0;
  for (;;) {
    let start = -1;
    let name = null;
    for (const [candidate, known] of next) {
      const found = known >= at ? known : lower.indexOf(`<${candidate}`, at);
      if (found === -1) {
        next.delete(candidate);
        continue;
      }
      next.set(candidate, found);
      if (start === -1 || found < start) {
        start = found;
        name = candidate;
      }
    }
    if (name === null) break;
    const close = lower.indexOf(`</${name}>`, start + name.length + 1);
    // Unclosed here is unclosed further on as well.
    if (close === -1) {
      next.delete(name);
      continue;
    }
    out += html.slice(at, start);
    at = close + name.length + 3;
  }
  return out + html.slice(at);
}

/**
 * Every `<…>` with something between its brackets taken out. A `<` with no
 * `>` after it is text, and so is everything after it, since no later `<`
 * can close either.
 */
function withoutTags(html) {
  let out = "";
  let at = 0;
  let from = 0;
  for (;;) {
    const open = html.indexOf("<", from);
    if (open === -1) break;
    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    from = close + 1;
    // `<>` holds nothing and is not a tag.
    if (close === open + 1) continue;
    out += html.slice(at, open);
    at = from;
  }
  return out + html.slice(at);
}
