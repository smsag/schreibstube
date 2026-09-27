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
import type { MailAttachmentDraft } from "./mail-figures";
import { readMailFields, type MailFields } from "./mail-frontmatter";

export interface MailDraft {
  fields: MailFields;
  /** The sender the mail will carry: the note's, else the setting's, else
   *  empty for the bridge's own. */
  from: string;
  /** Plain text, as the recipient will read it. */
  body: string;
  /** The note's diagrams, drawn, in the order the body numbers them. */
  attachments: MailAttachmentDraft[];
  /** Diagrams that go as their source, which the dialogue says before Send. */
  undrawn: number;
  /** Whether that is because the bridge cannot take pictures at all. */
  bridgeTooOld: boolean;
}

/** What the note's diagrams came to, when it has any. */
export interface DraftFigures {
  attachments: MailAttachmentDraft[];
  undrawn: number;
  bridgeTooOld: boolean;
}

export function buildMailDraft(
  frontmatter: unknown,
  markdownBody: string,
  settingsFrom: string,
  figures: DraftFigures = { attachments: [], undrawn: 0, bridgeTooOld: false }
): MailDraft {
  const fields = readMailFields(frontmatter);
  return {
    fields,
    from: fields.from || settingsFrom.trim(),
    body: markdownToPlainText(markdownBody),
    ...figures
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
    shown.body === now.body &&
    shown.undrawn === now.undrawn &&
    shown.bridgeTooOld === now.bridgeTooOld &&
    sameAttachments(shown.attachments, now.attachments)
  );
}

/** Named and sized alike: a picture drawn again from the same canvas is the same. */
function sameAttachments(
  a: readonly MailAttachmentDraft[],
  b: readonly MailAttachmentDraft[]
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (attachment, index) =>
        attachment.filename === b[index]?.filename &&
        attachment.bytes.byteLength === b[index]?.bytes.byteLength
    )
  );
}

/**
 * What the dialogue has to say before Send, most serious first.
 *
 * `noTo`: a note with only a Cc is sendable, and was sent that way without
 * anyone noticing the small dash where the recipient should have been.
 */
export type SendWarning =
  "unconfirmed" | "alreadySent" | "noTo" | "diagramsNotDrawn" | "bridgeTooOld";

export function sendWarnings(
  fields: MailFields,
  figures: Pick<DraftFigures, "undrawn" | "bridgeTooOld"> = { undrawn: 0, bridgeTooOld: false }
): SendWarning[] {
  const warnings: SendWarning[] = [];
  if (fields.unconfirmedAt) warnings.push("unconfirmed");
  if (fields.messageId) warnings.push("alreadySent");
  if (fields.to.length === 0) warnings.push("noTo");
  // A diagram sent as its source is a mail that reads worse than the note, and
  // it cannot be taken back: said before Send, with the reason when there is one.
  if (figures.undrawn > 0) {
    warnings.push(figures.bridgeTooOld ? "bridgeTooOld" : "diagramsNotDrawn");
  }
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
