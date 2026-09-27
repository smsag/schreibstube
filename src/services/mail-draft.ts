/**
 * What one send is made of, taken from one reading of the note.
 *
 * The recipients used to come from Obsidian's metadata cache, read when the
 * command started, and the body from the file itself. A property typed just
 * before sending was saved and parsed only after that moment — the dialogue
 * then showed an empty "To", the send went out to the Cc alone, and the note,
 * written back a second later, carried the address as if it had been used.
 * A draft is now built from the file's own text, once for the dialogue and
 * again when Send is pressed, and a send goes out only if the two agree.
 */

import { BridgeError } from "./bridge-protocol";
import { markdownToPlainText } from "./mail-body";
import { readMailFields, type MailFields } from "./mail-frontmatter";

export interface MailDraft {
  fields: MailFields;
  /** The sender the mail will carry: the note's, else the setting's, else
   *  empty for the bridge's own. */
  from: string;
  /** Plain text, as the recipient will read it. */
  body: string;
}

export function buildMailDraft(
  frontmatter: unknown,
  markdownBody: string,
  settingsFrom: string
): MailDraft {
  const fields = readMailFields(frontmatter);
  return {
    fields,
    from: fields.from || settingsFrom.trim(),
    body: markdownToPlainText(markdownBody)
  };
}

/** Whether pressing Send would send what the dialogue showed. */
export function sameDraft(shown: MailDraft, now: MailDraft): boolean {
  const a = shown.fields;
  const b = now.fields;
  return (
    sameList(a.to, b.to) &&
    sameList(a.cc, b.cc) &&
    shown.from === now.from &&
    a.subject === b.subject &&
    a.messageId === b.messageId &&
    a.unconfirmedAt === b.unconfirmedAt &&
    shown.body === now.body
  );
}

/**
 * What the dialogue has to say before Send, most serious first.
 *
 * `noTo`: a note with only a Cc is sendable, and was sent that way without
 * anyone noticing the small dash where the recipient should have been.
 */
export type SendWarning = "unconfirmed" | "alreadySent" | "noTo";

export function sendWarnings(fields: MailFields): SendWarning[] {
  const warnings: SendWarning[] = [];
  if (fields.unconfirmedAt) warnings.push("unconfirmed");
  if (fields.messageId) warnings.push("alreadySent");
  if (fields.to.length === 0) warnings.push("noTo");
  return warnings;
}

/**
 * Whether a failed send may have been delivered all the same.
 *
 * Only a refusal the bridge answered is a certain failure. A deadline the
 * bridge ran out of, the plugin's own deadline, a dropped connection: in each
 * the mail server may have taken the message, and reporting "failed" is what
 * made a person send it a second time.
 */
export function isUnconfirmedSend(err: unknown): boolean {
  if (!(err instanceof BridgeError)) return true;
  return err.code === "send_unconfirmed" || err.status === 504;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
