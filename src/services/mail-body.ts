/**
 * A note's text as the body of a plain-text email.
 *
 * The body used to be the note's Markdown as written, so a recipient read
 * `**1. Wasserschaden**` with its asterisks, `[[Protokoll 2025]]` with its
 * brackets — and every `%% note to self %%`, which Obsidian hides and the mail
 * did not. Here the note becomes what a reader of the rendered note would see,
 * written the way plain-text mail writes it: emphasis without its marks, a
 * link as its text with the address after it, a task as a box.
 *
 * Comments go first and entirely, before anything else is read, because they
 * are the one part a person never meant anyone to see. Code is kept as it was
 * written, without its fences or backticks: inside it an asterisk is code.
 */

import { fenceMarker } from "./markdown-fence";
import { type TaskState, taskState } from "./task-state";
import { stripComments } from "./markdown-typst";

/** A box ticked with a cross reads as "no" beside one ticked with a check. */
const TASK_BOX: Record<TaskState, string> = {
  open: "☐",
  progress: "◧",
  done: "☑",
  cancelled: "☒"
};

/** Stand-in for a piece already final, so the inline rules cannot touch it. */
const HOLD = "\uE000";
const HELD = /\uE000(\d+)\uE000/g;

export function markdownToPlainText(markdown: string): string {
  const source = stripComments(markdown.replace(/\r\n?/g, "\n"));

  // Only the block's own two fence lines are dropped. A line inside a block
  // that merely looks like a fence — `~~~` quoted in a Markdown sample, or a
  // shorter run of backticks — is content, and used to vanish from the mail.
  const out: string[] = [];
  let open: string | null = null;
  for (const line of source.split("\n")) {
    const marker = fenceMarker(line);
    if (open === null) {
      if (marker) open = marker;
      else out.push(convertLine(line));
    } else if (marker && marker[0] === open[0] && marker.length >= open.length) {
      open = null;
    } else {
      out.push(line);
    }
  }

  return out
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function convertLine(line: string): string {
  // A rule before emphasis: `***` is a line, not two stars around one.
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return "————————";

  const quote = /^(\s*(?:>\s?)*)(.*)$/.exec(line);
  const prefix = quote?.[1] ?? "";
  let text = quote?.[2] ?? line;

  // `> [!warning] Frist` reads as its title; a callout without one, as its kind.
  const callout = /^\[!([^\]]+)\][+-]?\s*(.*)$/.exec(text);
  if (prefix.includes(">") && callout) {
    text = callout[2] || capitalise(callout[1] ?? "");
  }

  // A closing run of hashes is set off by a space; one glued to the text, as
  // in `# C#`, is the text.
  text = text.replace(/^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/, "$1");
  // The four boxes a mail client can show: open, started, done, cancelled.
  text = text.replace(/^(\s*)[-*+]\s+\[(.)\]\s+/, (_, indent: string, mark: string) => {
    return `${indent}${TASK_BOX[taskState(mark)]} `;
  });
  text = text.replace(/^(\s*)[*+]\s+/, "$1- ");
  // A block id is Obsidian's anchor for a link, not part of the sentence.
  text = text.replace(/\s+\^[A-Za-z0-9-]+$/, "");

  const depth = (prefix.match(/>/g) ?? []).length;
  return (depth > 0 ? "> ".repeat(depth) : prefix) + convertInline(text);
}

function convertInline(text: string): string {
  const held: string[] = [];
  const hold = (value: string): string => `${HOLD}${held.push(value) - 1}${HOLD}`;

  let result = text
    // Inline code first: nothing inside it is Markdown.
    .replace(/(`+)(.+?)\1/g, (_, __, code: string) => hold(code.trim()))
    // An escaped character is the character, and no rule below may pair it.
    .replace(/\\([\\`*_{}[\]()#+\-.!|~=<>])/g, (_, char: string) => hold(char))
    // An embed cannot travel in a text mail; its name says what was there.
    .replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (_, target: string) =>
      hold(`[${basename(target)}]`)
    )
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt: string, url: string) =>
      hold(isExternal(url) ? (alt ? `${alt} (${url})` : url) : alt || `[${basename(url)}]`)
    )
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) =>
      hold(alias ?? wikiTarget(target))
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label: string, url: string) =>
      hold(linkText(label, url))
    )
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, (_, url: string) => hold(url))
    // A bare address keeps its underscores and stars.
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/g, (url) => hold(url));

  result = result
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(?<![\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?=[^\s_])([^_]*?[^\s_])_(?![\w_])/g, "$1")
    .replace(/~~(?=\S)(.+?)~~/g, "$1")
    .replace(/==(?=\S)(.+?)==/g, "$1");

  // Nested holds — a link inside inline code — unwind from the outside in.
  let previous: string;
  do {
    previous = result;
    result = result.replace(HELD, (_, n: string) => held[Number(n)] ?? "");
  } while (result !== previous && result.includes(HOLD));
  return result;
}

/** The label, and the address after it unless the label already is one. */
function linkText(label: string, url: string): string {
  const plainLabel = convertInline(label);
  if (!isExternal(url)) return plainLabel;
  const shown = url.replace(/^mailto:/, "");
  return plainLabel === url || plainLabel === shown ? shown : `${plainLabel} (${shown})`;
}

/** `Folder/Note#Heading` as a reader would name it: `Note › Heading`. */
function wikiTarget(target: string): string {
  const [path = "", ...rest] = target.split("#");
  const heading = rest.filter((part) => part && !part.startsWith("^")).join(" › ");
  const note = basename(path);
  return heading ? (note ? `${note} › ${heading}` : heading) : note;
}

function basename(path: string): string {
  const name = decodeSafely(path.trim()).split("/").pop() ?? "";
  return name.replace(/\.md$/i, "");
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isExternal(url: string): boolean {
  return /^(?:https?:|mailto:|www\.)/i.test(url);
}

function capitalise(word: string): string {
  const trimmed = word.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}
