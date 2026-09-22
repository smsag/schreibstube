/**
 * The reminder queue, as whatever carries it into Reminders sees it.
 *
 * The planner writes operations into the plan; something on an Apple device
 * has to apply them — a Shortcut, a small Mac helper, one day an app — because
 * nothing on a server can write to iCloud's reminders. That something should
 * not have to read the whole plan, understand its revisions, or decide
 * anything. So it gets two questions to ask: what is there to do, and here is
 * what I did and what the list now says.
 *
 * Pure: a document in, a document out. The route does the storing.
 */
import { DocumentError, MAX_COMPLETIONS } from "./document.mjs";

/** More reminders than a list can sensibly hold in one answer. */
export const MAX_REPORTED_REMINDERS = 2000;
const MAX_NOTES_CHARS = 4000;
const KEY_IN_NOTES = /schreibstube\?key=([A-Za-z0-9-]{1,64})/;

/** What a reminder's notes contain exactly when it is this key's. */
export function matchFor(key) {
  return `schreibstube?key=${key}`;
}

/**
 * The operations still to apply, oldest first, and the sequence to report
 * back once they are. Each carries the text a drain looks for in a
 * reminder's notes, so no drain has to know how the link is spelled.
 */
export function pendingOps(document) {
  const ops = document.queue
    .filter((op) => op.seq > document.acked)
    .sort((left, right) => left.seq - right.seq)
    .map((op) => ({ ...op, match: matchFor(op.key) }));
  return { acked: document.acked, seq: highestSeq(document), ops };
}

/**
 * What a drain reports, checked like any other body: the sequence it applied
 * up to, and what the list held afterwards.
 */
export function checkReport(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DocumentError("the report must be an object");
  }
  if (!Number.isInteger(body.seq) || body.seq < 0) {
    throw new DocumentError("seq must be a whole number, zero or more");
  }
  const reminders = body.reminders ?? [];
  if (!Array.isArray(reminders)) throw new DocumentError("reminders must be a list");
  if (reminders.length > MAX_REPORTED_REMINDERS) {
    throw new DocumentError(`reminders holds at most ${MAX_REPORTED_REMINDERS} entries`);
  }

  return {
    seq: body.seq,
    reminders: reminders.map((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        throw new DocumentError(`reminders[${index}] must be an object`);
      }
      if (typeof entry.notes !== "string" || entry.notes.length > MAX_NOTES_CHARS) {
        throw new DocumentError(
          `reminders[${index}].notes must be text of at most ${MAX_NOTES_CHARS} characters`
        );
      }
      if (typeof entry.done !== "boolean") {
        throw new DocumentError(`reminders[${index}].done must be true or false`);
      }
      return { notes: entry.notes, done: entry.done };
    })
  };
}

/**
 * The plan after a drain reported back.
 *
 * `acked` moves up to what the drain applied, never past what the queue
 * holds and never backwards. A reminder whose completion differs from what
 * the planner last sent was changed in Reminders — ticked on the phone,
 * reopened by hand — and becomes a completion for the planner to write into
 * the note. One the planner has already sent a newer operation for is left:
 * the drain has not applied it yet, so what the list says is out of date.
 */
export function acknowledge(document, report, at) {
  const acked = Math.max(document.acked, Math.min(report.seq, highestSeq(document)));

  const last = new Map();
  for (const op of document.queue) {
    const previous = last.get(op.key);
    if (!previous || op.seq > previous.seq) last.set(op.key, op);
  }

  const changed = new Map();
  for (const reminder of report.reminders) {
    const key = KEY_IN_NOTES.exec(reminder.notes)?.[1];
    const sent = key === undefined ? undefined : last.get(key);
    if (!sent || sent.op !== "upsert" || sent.seq > acked) continue;
    if (sent.done !== reminder.done) changed.set(key, reminder.done);
  }

  const kept = document.completions.filter((completion) => !changed.has(completion.key));
  const fresh = [...changed].map(([key, done]) => ({ key, done, at }));
  const completions = [...kept, ...fresh].slice(-MAX_COMPLETIONS);

  return { ...document, acked, completions };
}

function highestSeq(document) {
  return document.queue.reduce((highest, op) => Math.max(highest, op.seq), document.acked);
}
