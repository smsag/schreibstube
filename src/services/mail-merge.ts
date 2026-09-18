import { formatIsoMinutes } from "../utils/format-date";
import { fencedLines } from "./markdown-fence";
import type { MailMessage } from "./mail-protocol";

/**
 * Merging fetched messages into a note.
 *
 * The merge is idempotent: every message that lands in a note has its
 * Message-ID recorded in the note's `merged_ids` frontmatter, and a later fetch
 * drops anything already listed. Running "Fetch replies" repeatedly is
 * therefore safe — it only ever appends what is genuinely new.
 */

/** Fallback key for a message the server returned without a Message-ID. UIDs
 *  are stable within a mailbox, which is enough to keep the dedupe working for
 *  the mailbox the thread lives in. */
export function mergeKey(message: MailMessage): string {
  return message.messageId ?? `uid:${message.uid}`;
}

export function selectUnmerged(messages: MailMessage[], mergedIds: string[]): MailMessage[] {
  const seen = new Set(mergedIds);
  const fresh: MailMessage[] = [];

  for (const message of messages) {
    const key = mergeKey(message);
    if (seen.has(key)) {
      continue;
    }
    // Guard against the same message appearing twice in one response.
    seen.add(key);
    fresh.push(message);
  }

  return fresh;
}

/**
 * Everything an email brings with it is written by whoever sent it.
 *
 * Quoting the body stops a line that begins with `#` or `-` becoming a heading
 * or a list, which is what the quoting was for. It does not stop an embed: a
 * `![[…]]` renders inside a quote as happily as anywhere else, and it renders
 * whatever it names — a private note, a scan, a contract. Merge such a reply
 * into a note and publish that note, which are two things this plugin is for,
 * and the file it names is uploaded to a website by a stranger's choosing.
 *
 * So the sequences that make a link or an embed are escaped wherever mail text
 * is written into a note. They are escaped rather than stripped, because the
 * point is to show what the sender wrote, not to quietly edit it.
 *
 * A wikilink embed was escaped and a Markdown one was not, though they do the
 * same thing: `![](Privat/Gehalt.png)` renders the vault file it names, and a
 * remote one is a tracking pixel that reports when the note is read.
 */
function escapeMailMarkdown(text: string): string {
  return text.replace(/!?\[\[|!\[/g, (match) => match.replace(/\[/g, "\\["));
}

/**
 * A single line of somebody else's text.
 *
 * A subject may hold newlines, and a subject written into a heading takes the
 * rest of the note's structure with it: everything after the first line lands
 * outside the heading as Markdown of the sender's choosing.
 */
function oneLine(text: string): string {
  return escapeMailMarkdown(text.replace(/\s+/g, " ").trim());
}

/**
 * Render one message as Markdown.
 *
 * The body is quoted rather than inlined. That is not decoration: an email line
 * starting with `#` or `-` would otherwise be parsed as a heading or list and
 * pollute the note's own structure — including the heading-stack overlay this
 * plugin renders.
 */
export function formatMessage(message: MailMessage): string {
  const heading = oneLine(message.subject) || "(no subject)";
  const from = oneLine(message.from);
  const meta = [
    from ? `**From:** ${from}` : "",
    message.date ? `**Date:** ${formatIsoMinutes(message.date)}` : ""
  ]
    .filter(Boolean)
    .join(" · ");

  const body = message.text.trim() || "_(no text content)_";
  const quoted = escapeMailMarkdown(body)
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");

  const truncationNote = message.truncated ? "\n>\n> _[message truncated by the bridge]_" : "";

  return [`### ${heading}`, meta, "", quoted + truncationNote].filter(Boolean).join("\n");
}

export function formatMessages(messages: MailMessage[]): string {
  return messages.map(formatMessage).join("\n\n");
}

/**
 * Append `addition` to the `## <heading>` section, creating that section at the
 * end of the note if it does not exist yet. Content that follows the section
 * (a later `##` or `#` heading) is preserved — the addition goes at the end of
 * the section, not the end of the file.
 */
export function appendToSection(body: string, heading: string, addition: string): string {
  const trimmedBody = body.replace(/\s+$/, "");
  // The heading is trimmed on both sides of the comparison: a configured value
  // with stray whitespace would otherwise never match the heading it wrote
  // last time, and every run would append another section.
  const headingLine = `## ${heading.trim()}`;
  const lines = trimmedBody.split("\n");

  // A heading is only a heading outside a code block. Without this the section
  // ended at a "## " inside a fence and the reply was appended into the middle
  // of somebody's code sample.
  const fenced = fencedLines(lines);
  const start = lines.findIndex((line, index) => !fenced[index] && line.trim() === headingLine);
  if (start === -1) {
    const prefix = trimmedBody ? `${trimmedBody}\n\n` : "";
    return `${prefix}${headingLine}\n\n${addition}\n`;
  }

  // The section ends at the next heading of the same or a higher level.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!fenced[i] && /^#{1,2}\s/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }

  const section = lines.slice(start, end).join("\n").replace(/\s+$/, "");
  const rest = lines.slice(end);
  const merged = [`${section}\n\n${addition}`, ...(rest.length > 0 ? ["", ...rest] : [])].join(
    "\n"
  );

  return `${[...lines.slice(0, start), merged].join("\n").replace(/\s+$/, "")}\n`;
}
