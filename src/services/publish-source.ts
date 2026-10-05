/**
 * The copy of a note that is uploaded for publishing.
 *
 * The bridge keeps every source it is sent in its state directory, so a
 * template change can re-render the site without the vault. Whatever the
 * renderer drops is therefore still on the host: the frontmatter, and every
 * `%%comment%%` written for oneself. Neither ever reaches a page, so neither
 * needs to leave the vault. This module drops them before the upload, by the
 * renderer's own rules (`bridge/publish/render/markdown.mjs`, `prepare`),
 * which it repeats here because the plugin cannot import the bridge.
 *
 * The upload has to render exactly as the note would have. The bridge strips
 * again what it is sent, so what is uploaded must come through a second pass
 * unchanged; where it would not, the upload keeps what that pass needs
 * instead of rendering differently. `contracts/publish-source-cases.json`
 * holds the examples both sides are tested against.
 */

/** The renderer's frontmatter: `---` lines only, as the bridge reads it. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * An empty block the renderer takes as frontmatter and removes: put before a
 * text that begins like a frontmatter block, so the bridge removes this one
 * and leaves the text alone.
 */
const EMPTY_FRONTMATTER = "---\n\n---\n";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?\n?$/;

/** The note as it is uploaded: what the renderer reads, and nothing it drops. */
export function sourceForUpload(text: string): string {
  const match = FRONTMATTER.exec(text);
  const body = match ? text.slice(match[0].length) : text;
  const stripped = stripComments(body);
  // A second pass over the stripped text, as the bridge makes it, has to find
  // nothing more; in the rare text where it would — a comment whose removal
  // pairs two backticks anew — the comments travel, and the bridge drops them.
  const kept = stripComments(stripped) === stripped ? stripped : body;
  return FRONTMATTER.test(kept) ? `${EMPTY_FRONTMATTER}${kept}` : kept;
}

/** What the renderer reads of a text it is sent; exported for the tests. */
export function renderedSource(text: string): string {
  const match = FRONTMATTER.exec(text);
  return stripComments(match ? text.slice(match[0].length) : text);
}

/**
 * `%%…%%` removed, including across lines, and only outside code — the
 * bridge's `stripComments`, step for step. An unclosed `%%` is text; a closed
 * one runs to its partner wherever that is.
 */
export function stripComments(source: string): string {
  const code = codeRanges(source);
  let out = "";
  let at = 0;
  let range = 0;
  let open = -1;

  while (at < source.length) {
    while (range < code.length && (code[range]?.[1] ?? 0) <= at) range += 1;
    const current = code[range];
    if (current && current[0] <= at) {
      out += source.slice(at, current[1]);
      at = current[1];
      continue;
    }

    if (open < at) {
      const found = source.indexOf("%%", at);
      open = found === -1 ? source.length : found;
    }
    const nextCode = current ? current[0] : source.length;
    if (open >= nextCode) {
      out += source.slice(at, nextCode);
      at = nextCode;
      continue;
    }

    const close = source.indexOf("%%", open + 2);
    if (close === -1) {
      out += source.slice(at);
      break;
    }
    out += source.slice(at, open);
    at = close + 2;
  }
  return out;
}

/**
 * Where the code is, as sorted `[start, end)` offsets: fenced blocks, then
 * the inline spans between them — the bridge's `codeRanges`.
 */
function codeRanges(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  let fence: { char: string; length: number; start: number } | null = null;
  let offset = 0;

  for (const line of source.split(/(?<=\n)/)) {
    const marker = FENCE.exec(line);
    if (fence) {
      const closing = CLOSING_FENCE.exec(line);
      const run = closing?.[1];
      if (run && run[0] === fence.char && run.length >= fence.length) {
        ranges.push([fence.start, offset + line.length]);
        fence = null;
      }
    } else if (marker?.[1]) {
      fence = { char: marker[1].charAt(0), length: marker[1].length, start: offset };
    }
    offset += line.length;
  }
  if (fence) ranges.push([fence.start, source.length]);

  const spans: [number, number][] = [];
  let from = 0;
  for (const [start, end] of [...ranges, [source.length, source.length] as [number, number]]) {
    for (const span of inlineCode(source, from, start)) spans.push(span);
    from = end;
  }
  return [...ranges, ...spans].sort((a, b) => a[0] - b[0]);
}

function inlineCode(source: string, from: number, to: number): [number, number][] {
  const runs: { at: number; width: number }[] = [];
  const pattern = /`+/g;
  pattern.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) && match.index < to) {
    runs.push({ at: match.index, width: match[0].length });
  }

  const partner = new Array<number>(runs.length).fill(-1);
  const nextOfWidth = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (!run) continue;
    partner[i] = nextOfWidth.get(run.width) ?? -1;
    nextOfWidth.set(run.width, i);
  }

  const spans: [number, number][] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const j = partner[i] ?? -1;
    const start = runs[i];
    const end = runs[j];
    if (j === -1 || !start || !end) continue;
    spans.push([start.at, end.at + end.width]);
    i = j;
  }
  return spans;
}
