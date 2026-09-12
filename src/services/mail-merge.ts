import { formatIsoMinutes } from "../utils/format-date";
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
 * Render one message as Markdown.
 *
 * The body is quoted rather than inlined. That is not decoration: an email line
 * starting with `#` or `-` would otherwise be parsed as a heading or list and
 * pollute the note's own structure — including the heading-stack overlay this
 * plugin renders.
 */
export function formatMessage(message: MailMessage): string {
  const heading = message.subject.trim() || "(no subject)";
  const meta = [
    message.from ? `**From:** ${message.from}` : "",
    message.date ? `**Date:** ${formatIsoMinutes(message.date)}` : ""
  ]
    .filter(Boolean)
    .join(" · ");

  const body = message.text.trim() || "_(no text content)_";
  const quoted = body
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

  const start = lines.findIndex((line) => line.trim() === headingLine);
  if (start === -1) {
    const prefix = trimmedBody ? `${trimmedBody}\n\n` : "";
    return `${prefix}${headingLine}\n\n${addition}\n`;
  }

  // The section ends at the next heading of the same or a higher level.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
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
