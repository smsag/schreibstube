/**
 * The Markdown pipeline.
 *
 * Rendering lives on the bridge rather than in the plugin so that it is a pure
 * function of the source and the site index: the same note produces the same
 * bytes from a phone, from a laptop, and from a re-render months later with no
 * vault in reach. That is also what makes it testable.
 */
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import taskLists from "markdown-it-task-lists";
import katexModule from "@vscode/markdown-it-katex";
import { obsidian } from "./obsidian.mjs";
import { slugify } from "../path.mjs";

/** Bumped when the output of a given source would change. A changed version
 *  re-renders every page on the next commit, without re-uploading anything. */
export const RENDER_VERSION = 4;

const katex = katexModule.default ?? katexModule;

export function createRenderer({ allowHtml = true, allowDiagrams = true } = {}) {
  return new MarkdownIt({
    // A personal site is the author's own HTML, exactly as it is inside
    // Obsidian. A vault with more than one author is a different question, so
    // the target decides.
    html: allowHtml,
    linkify: true,
    breaks: false,
    typographer: false
  })
    .use(footnote)
    .use(deflist)
    .use(mark)
    .use(sub)
    .use(sup)
    .use(taskLists, { label: false })
    .use(anchor, { slugify, tabIndex: false })
    .use(katex, { throwOnError: false })
    .use(obsidian, { allowDiagrams });
}

/**
 * Render one note.
 *
 * `site` carries the lookup tables the Obsidian rules need. The returned flags
 * say which generator assets the page has to load, so a site without diagrams
 * never ships a diagram bundle. `sourcePath` is the note's place in the vault,
 * which a relative image path is read against.
 */
export function renderMarkdown(md, source, site, { sourcePath = "" } = {}) {
  const env = { site, sourcePath, usedMermaid: false, usedSlideshow: false };
  const html = md.render(prepare(source), env);
  return {
    html,
    usedMermaid: env.usedMermaid === true,
    usedSlideshow: env.usedSlideshow === true,
    usedMath: html.includes('class="katex')
  };
}

/** Frontmatter is metadata and never reaches the page; comments never render. */
export function prepare(source) {
  return stripComments(stripFrontmatter(String(source)));
}

export function stripFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  return match ? source.slice(match[0].length) : source;
}

/**
 * `%%…%%` disappears, including across lines.
 *
 * Hiding it with CSS would leave it in the served HTML, where a comment written
 * for oneself is one "view source" away from being published.
 *
 * Only outside code, as in Obsidian. A `%%` in a code sample — a format
 * string, a SQL pattern — is code; read as a comment, it paired with the next
 * one anywhere in the note and took everything between them off the page,
 * prose included, without a word.
 */
export function stripComments(source) {
  const code = codeRanges(source);
  let out = "";
  let at = 0;
  let range = 0;
  // Remembered between turns: searching afresh from every code span would
  // walk the rest of the note once per span.
  let open = -1;

  while (at < source.length) {
    while (range < code.length && code[range][1] <= at) range += 1;
    const inside = range < code.length && code[range][0] <= at;
    if (inside) {
      out += source.slice(at, code[range][1]);
      at = code[range][1];
      continue;
    }

    if (open < at) {
      const found = source.indexOf("%%", at);
      open = found === -1 ? source.length : found;
    }
    const nextCode = range < code.length ? code[range][0] : source.length;
    if (open >= nextCode) {
      out += source.slice(at, nextCode);
      at = nextCode;
      continue;
    }

    // An unclosed `%%` is text, as it always was. A closed one runs to its
    // partner wherever that is: a comment opened in prose hides what it spans.
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

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Where the code is, as sorted `[start, end)` offsets: fenced blocks, then the
 * inline spans in the text between them.
 *
 * A fence closes on a line of at least as many of the same character, and an
 * unclosed one runs to the end, which is how CommonMark reads both. An inline
 * span needs a closing run of exactly its own length; a backtick without one
 * is only a backtick.
 */
export function codeRanges(source) {
  const ranges = [];
  let fence = null;
  let offset = 0;

  for (const line of source.split(/(?<=\n)/)) {
    const marker = FENCE.exec(line);
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?\n?$/.exec(line);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
        ranges.push([fence.start, offset + line.length]);
        fence = null;
      }
    } else if (marker) {
      fence = { char: marker[1][0], length: marker[1].length, start: offset };
    }
    offset += line.length;
  }
  if (fence) ranges.push([fence.start, source.length]);

  const spans = [];
  let from = 0;
  for (const [start, end] of [...ranges, [source.length, source.length]]) {
    for (const span of inlineCode(source, from, start)) spans.push(span);
    from = end;
  }
  return [...ranges, ...spans].sort((a, b) => a[0] - b[0]);
}

function inlineCode(source, from, to) {
  const runs = [];
  const pattern = /`+/g;
  pattern.lastIndex = from;
  let match;
  while ((match = pattern.exec(source)) && match.index < to) {
    runs.push({ at: match.index, width: match[0].length });
  }

  // The partner of each run is the next one of the same width. Found in one
  // pass from the end, so a note full of stray backticks stays linear.
  const partner = new Array(runs.length).fill(-1);
  const nextOfWidth = new Map();
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    partner[i] = nextOfWidth.get(runs[i].width) ?? -1;
    nextOfWidth.set(runs[i].width, i);
  }

  const spans = [];
  for (let i = 0; i < runs.length; i += 1) {
    const j = partner[i];
    if (j === -1) continue; // No partner: this run is only backticks.
    spans.push([runs[i].at, runs[j].at + runs[j].width]);
    i = j;
  }
  return spans;
}
