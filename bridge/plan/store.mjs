/**
 * The one thing the bridge keeps.
 *
 * Exactly one planning document, at its latest revision, in one JSON file. No
 * history, no per-request rows, nothing about messages or published pages — a
 * deployment that loses this file loses one document that the vault can write
 * again, and that bound is the whole design.
 *
 * Two properties make it safe to share between a laptop, a phone and a helper:
 *
 *   atomic   every write lands in a temporary file and is renamed over the
 *            target, so a crash mid-write leaves the previous revision intact
 *            rather than half a document
 *   revised  the server, not the caller, assigns the revision, and a write
 *            that names a revision the store has moved past is refused. The
 *            late writer re-reads and applies its change again; nothing is
 *            merged behind anyone's back.
 *
 * Writes are serialised in process. The bridge runs as a single instance — the
 * throttle and the publish lock already depend on that — so one queue is the
 * whole of the concurrency story.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { checkDocument, DocumentError, emptyDocument } from "./document.mjs";

export class PlanStoreError extends Error {}

export function createPlanStore(path) {
  // Read-check-write has to be one step or two callers at the same revision
  // both pass the check and the second one wins silently.
  let queue = Promise.resolve();
  const serial = (work) => {
    const done = queue.then(work, work);
    queue = done.then(
      () => {},
      () => {}
    );
    return done;
  };

  // What was last read or written, and the file as it stood then. Reading
  // and validating the whole document on every request is the cost of a
  // file someone else might edit; a stat that says it has not changed is
  // enough to skip it, and an edit on disk is still seen on the next read.
  let known = null;
  const current = async () => {
    const stamp = await fileStamp(path);
    if (stamp === null) {
      known = null;
      return { rev: 0, document: emptyDocument() };
    }
    if (known && known.stamp === stamp) return known.value;
    const value = await load(path);
    known = { stamp, value };
    return value;
  };

  return {
    path,

    /** The stored revision and document, or the empty one. */
    read: () => serial(current),

    /**
     * Store a document if `expectedRev` is still the current revision.
     *
     * Answers `{ok: false, rev, document}` when it is not, so the caller has
     * what it needs to re-apply its change without a second round trip.
     */
    write: (document, expectedRev) =>
      serial(async () => {
        const stored = await current();
        if (stored.rev !== expectedRev) return { ok: false, ...stored };

        const rev = stored.rev + 1;
        await save(path, { rev, document });
        known = { stamp: await fileStamp(path), value: { rev, document } };
        return { ok: true, rev };
      })
  };
}

/** Size and modification time together, or null when there is no file yet. */
async function fileStamp(path) {
  try {
    const info = await stat(path);
    return `${info.size}:${info.mtimeMs}`;
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new PlanStoreError(`The plan store cannot be read (${err.code ?? "unknown error"}).`);
  }
}

/**
 * A file on disk is outside the process, so it is checked like any other input.
 *
 * A document that no longer validates is reported rather than replaced: the
 * file is the user's, and silently handing back an empty plan would look like
 * the plan was lost — which, a save later, it would be.
 */
async function load(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { rev: 0, document: emptyDocument() };
    throw new PlanStoreError(`The plan store cannot be read (${err.code ?? "unknown error"}).`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PlanStoreError("The plan store is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PlanStoreError("The plan store does not hold an object.");
  }
  if (!Number.isInteger(parsed.rev) || parsed.rev < 0) {
    throw new PlanStoreError("The plan store has no usable revision number.");
  }

  try {
    checkDocument(parsed.document);
  } catch (err) {
    if (err instanceof DocumentError) {
      throw new PlanStoreError(`The stored plan is unusable: ${err.message}`);
    }
    throw err;
  }

  return { rev: parsed.rev, document: parsed.document };
}

async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  // Beside the target rather than in the system temp directory: a rename across
  // filesystems is a copy, and a copy is not atomic.
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;

  try {
    // The document holds what someone is planning to do and where their notes
    // live. Nobody else on the host needs to read it.
    await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => {});
    throw new PlanStoreError(`The plan store cannot be written (${err.code ?? "unknown error"}).`);
  }
}
