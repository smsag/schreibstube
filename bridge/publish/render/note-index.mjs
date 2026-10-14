/**
 * The plugin's ```schreibstube-index``` block, on the published site: the
 * page's headings as a list of links to them, read by the plugin's rules so
 * the note and its page list the same sections. The block's text is note
 * text, so it is bounded and every value is escaped.
 *
 * On the site the block is a `<details>`: open unless the block says
 * `collapsed: true`, and a reader may open or fold it there. A block that
 * would list nothing, or too much, shows nothing: its notice is for the
 * author, who sees it in the note, and a reader can do nothing about it.
 */
import { escapeAttribute, escapeHtml } from "./html.mjs";

export const NOTE_INDEX_LANGUAGE = "schreibstube-index";

export const DEFAULT_INDEX_DEPTH = 2;
export const MAX_INDEX_DEPTH = 6;
export const MAX_INDEX_ENTRIES = 150;

const MAX_OPTION_LINES = 20;

const DEPTH_PATTERN = /^depth\s*:\s*(.*)$/i;
const COLLAPSED_PATTERN = /^collapsed\s*:\s*(.*)$/i;

/** What a reader of the site reads, in German, the site's language. */
export const LABELS = {
  summary: (count) => `Inhalt · ${count} ${count === 1 ? "Abschnitt" : "Abschnitte"}`
};

/**
 * Reads the block as the plugin does: `depth:` 1 to 6, `collapsed:` true or
 * false, blank lines and `//` comments ignored. A line it cannot read keeps
 * the default and is named.
 */
export function parseNoteIndexOptions(source) {
  const options = { depth: DEFAULT_INDEX_DEPTH, collapsed: false, unreadableLine: null };
  const lines = String(source).split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;
    const understood = index < MAX_OPTION_LINES && readOption(line, options);
    if (!understood && options.unreadableLine === null) options.unreadableLine = index + 1;
  }
  return options;
}

function readOption(line, options) {
  const depth = DEPTH_PATTERN.exec(line);
  if (depth) {
    const value = depth[1].trim();
    if (!/^\d$/.test(value)) return false;
    const level = Number(value);
    if (level < 1 || level > MAX_INDEX_DEPTH) return false;
    options.depth = level;
    return true;
  }

  const collapsed = COLLAPSED_PATTERN.exec(line);
  if (collapsed) {
    const value = collapsed[1].trim().toLowerCase();
    if (value !== "true" && value !== "false") return false;
    options.collapsed = value === "true";
    return true;
  }

  return false;
}

/**
 * The entries an index of `depth` shows, from `{ level }` headings in page
 * order; each entry keeps its heading and gains an indent that follows the
 * outline, as in the plugin.
 */
export function planNoteIndex(headings, depth) {
  const shown = headings.filter((heading) => heading.level <= depth);
  if (shown.length === 0) return { kind: "empty" };
  if (shown.length > MAX_INDEX_ENTRIES) {
    return { kind: "too-long", count: shown.length, fits: deepestThatFits(headings, depth) };
  }

  const open = [];
  const entries = shown.map((heading) => {
    while (open.length > 0 && open[open.length - 1] >= heading.level) open.pop();
    const indent = open.length;
    open.push(heading.level);
    return { ...heading, indent };
  });
  return { kind: "entries", entries };
}

function deepestThatFits(headings, depth) {
  for (let level = depth - 1; level >= 1; level -= 1) {
    const count = headings.filter((heading) => heading.level <= level).length;
    if (count > 0 && count <= MAX_INDEX_ENTRIES) return level;
  }
  return null;
}

/**
 * The page's own headings, from the parsed tokens: none of a callout or a
 * quote, as in the vault, with the id the anchor rule gave each one. Its words
 * are the anchor rule's reading, a line break a space; a heading of an icon
 * alone has no words left, and is named by its source, as the vault names it.
 */
export function pageHeadings(tokens) {
  const headings = [];
  let quoted = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "blockquote_open") quoted += 1;
    if (token.type === "blockquote_close") quoted -= 1;
    if (token.type !== "heading_open" || quoted > 0) continue;
    const id = token.attrGet("id");
    const inline = tokens[i + 1];
    const words = (inline?.children ?? [])
      .map((child) => {
        if (child.type === "text" || child.type === "code_inline") return child.content;
        return child.type === "softbreak" || child.type === "hardbreak" ? " " : "";
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    const text = words || String(inline?.content ?? "").trim();
    if (!id || text === "") continue;
    headings.push({ level: Number(token.tag.slice(1)), id, text });
  }
  return headings;
}

/** The block as HTML, or nothing when there is no list to show. */
export function renderNoteIndex(source, tokens) {
  const options = parseNoteIndexOptions(source);
  const plan = planNoteIndex(pageHeadings(tokens), options.depth);
  if (plan.kind !== "entries") return "";

  const open = options.collapsed ? "" : " open";
  const summary = escapeHtml(LABELS.summary(plan.entries.length)).replace(
    /(\d+)/g,
    "<strong>$1</strong>"
  );
  return (
    `<details class="schreibstube-index"${open}>\n<summary>${summary}</summary>\n` +
    `${nestedList(plan.entries)}</details>\n`
  );
}

/**
 * Nested lists from the indents, which step in by one at most, so a heading
 * a level deeper is a list inside its parent's item, as a screen reader
 * expects an outline to be.
 */
function nestedList(entries) {
  let html = "<ul>\n";
  let depth = 0;
  for (const [index, entry] of entries.entries()) {
    if (index > 0 && entry.indent > depth) {
      html += "\n<ul>\n";
      depth += 1;
    } else if (index > 0) {
      html += "</li>\n";
      for (; depth > entry.indent; depth -= 1) html += "</ul>\n</li>\n";
    }
    html += `<li><a href="#${escapeAttribute(entry.id)}">${escapeHtml(entry.text)}</a>`;
  }
  html += "</li>\n";
  for (; depth > 0; depth -= 1) html += "</ul>\n</li>\n";
  return `${html}</ul>\n`;
}
