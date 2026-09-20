/**
 * The planning document, checked before anything is stored or read back.
 *
 * Four different things write this document — the Obsidian plugin, a helper on
 * the Mac, an app on the phone, and a person with a text editor when one of
 * those has gone wrong — so none of them is trusted. A field that arrives in
 * the wrong shape is refused rather than coerced: a `capacity` of "3" silently
 * becoming 3 is how two writers end up disagreeing about what the document
 * says, and the disagreement surfaces days later as a lost time block.
 *
 * Every message names the field that failed and never quotes what was in it.
 * The document holds task text, note paths and deadlines; an error that echoes
 * them puts them in a log, a bug report and a screenshot.
 */

export class DocumentError extends Error {}

/** The only shape this bridge knows. A newer plugin bumps it and says so. */
export const DOCUMENT_VERSION = 1;

/** Serialized. Large enough for a year of planning, small enough that reading
 *  and rewriting the whole document on every save stays free. */
export const MAX_DOCUMENT_BYTES = 512 * 1024;

export const MAX_DEADLINES = 200;
export const MAX_BLOCKS = 500;
export const MAX_MEMBERS = 200;
export const MAX_ANCHORS = 2000;
export const MAX_QUEUE = 500;
export const MAX_COMPLETIONS = 500;

const MAX_TAG_CHARS = 200;
const MAX_KEY_CHARS = 64;
const MAX_UID_CHARS = 200;
const MAX_TITLE_CHARS = 500;
const MAX_TEXT_CHARS = 500;
const MAX_PATH_CHARS = 400;
const MAX_CALENDAR_CHARS = 200;
const MAX_HASH_CHARS = 64;
const MAX_NOTES_CHARS = 4000;
const MAX_LIST_CHARS = 200;
/** An ISO timestamp with an offset and microseconds still fits well inside. */
const MAX_TIMESTAMP_CHARS = 40;

const TAG = /^[A-Za-z0-9/_-]+$/;
const TASK_KEY = /^[A-Za-z0-9-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * What each object may hold. `keys` must all be present — a document that
 * round-trips through the store must not quietly lose a section — and
 * `optional` may be, which is how "no due date given" stays distinguishable
 * from "the due date was cleared".
 */
const TOP_LEVEL = {
  keys: ["v", "deadlines", "blocks", "anchors", "queue", "acked", "completions"],
  optional: []
};
const DEADLINE = { keys: ["date"], optional: ["capacity"] };
const BLOCK = {
  keys: ["uid", "tag", "title", "start", "end", "calendar", "members"],
  optional: []
};
const MEMBER = { keys: ["key", "text", "path", "remind"], optional: ["done"] };
const ANCHOR = { keys: ["path", "hash", "text", "ordinal"], optional: [] };
const QUEUE = {
  keys: ["seq", "op", "key"],
  optional: ["title", "notes", "due", "done", "list"]
};
const COMPLETION = { keys: ["key", "done", "at"], optional: [] };
const QUEUE_OPS = ["upsert", "delete"];

/** What a vault that has never planned anything looks like. A fresh object
 *  every time, so a caller that edits it cannot edit the next reader's copy. */
export function emptyDocument() {
  return {
    v: DOCUMENT_VERSION,
    deadlines: {},
    blocks: [],
    anchors: {},
    queue: [],
    acked: 0,
    completions: []
  };
}

/**
 * Check a document top to bottom and hand it back unchanged.
 *
 * Nothing is filled in and nothing is dropped: what the caller sent is either
 * exactly what gets stored, or it is refused.
 */
export function checkDocument(document) {
  object(document, "document");
  only(document, TOP_LEVEL, "document");
  withinSizeLimit(document);

  if (document.v !== DOCUMENT_VERSION) {
    fail(`document.v must be ${DOCUMENT_VERSION}`);
  }

  checkDeadlines(document.deadlines);
  checkBlocks(document.blocks);
  checkAnchors(document.anchors);
  checkQueue(document.queue);
  counter(document.acked, "document.acked");
  checkCompletions(document.completions);

  return document;
}

function checkDeadlines(deadlines) {
  object(deadlines, "deadlines");
  const entries = Object.entries(deadlines);
  atMost(entries.length, MAX_DEADLINES, "deadlines");

  for (const [name, deadline] of entries) {
    if (!TAG.test(name) || name.length > MAX_TAG_CHARS) {
      fail(
        `deadlines has a key that is not a tag (letters, digits, "/", "_", "-", ` +
          `at most ${MAX_TAG_CHARS} characters)`
      );
    }
    const at = `deadlines[tag]`;
    object(deadline, at);
    only(deadline, DEADLINE, at);
    date(deadline.date, `${at}.date`);
    if (deadline.capacity !== undefined) {
      integer(deadline.capacity, `${at}.capacity`, 1, 50);
    }
  }
}

function checkBlocks(blocks) {
  array(blocks, "blocks");
  atMost(blocks.length, MAX_BLOCKS, "blocks");

  blocks.forEach((block, index) => {
    const at = `blocks[${index}]`;
    object(block, at);
    only(block, BLOCK, at);
    text(block.uid, `${at}.uid`, MAX_UID_CHARS);
    tag(block.tag, `${at}.tag`);
    text(block.title, `${at}.title`, MAX_TITLE_CHARS, { empty: true });
    timestamp(block.start, `${at}.start`);
    timestamp(block.end, `${at}.end`);
    text(block.calendar, `${at}.calendar`, MAX_CALENDAR_CHARS);

    array(block.members, `${at}.members`);
    atMost(block.members.length, MAX_MEMBERS, `${at}.members`);
    block.members.forEach((member, position) => {
      const here = `${at}.members[${position}]`;
      object(member, here);
      only(member, MEMBER, here);
      taskKey(member.key, `${here}.key`);
      text(member.text, `${here}.text`, MAX_TEXT_CHARS, { empty: true });
      text(member.path, `${here}.path`, MAX_PATH_CHARS);
      flag(member.remind, `${here}.remind`);
      if (member.done !== undefined) flag(member.done, `${here}.done`);
    });
  });
}

function checkAnchors(anchors) {
  object(anchors, "anchors");
  const entries = Object.entries(anchors);
  atMost(entries.length, MAX_ANCHORS, "anchors");

  for (const [key, anchor] of entries) {
    if (!TASK_KEY.test(key) || key.length > MAX_KEY_CHARS) {
      fail(
        `anchors has a key that is not a task key (letters, digits, "-", ` +
          `at most ${MAX_KEY_CHARS} characters)`
      );
    }
    const at = `anchors[key]`;
    object(anchor, at);
    only(anchor, ANCHOR, at);
    text(anchor.path, `${at}.path`, MAX_PATH_CHARS);
    text(anchor.hash, `${at}.hash`, MAX_HASH_CHARS);
    text(anchor.text, `${at}.text`, MAX_TEXT_CHARS, { empty: true });
    counter(anchor.ordinal, `${at}.ordinal`);
  }
}

function checkQueue(queue) {
  array(queue, "queue");
  atMost(queue.length, MAX_QUEUE, "queue");

  queue.forEach((entry, index) => {
    const at = `queue[${index}]`;
    object(entry, at);
    only(entry, QUEUE, at);
    counter(entry.seq, `${at}.seq`);
    if (!QUEUE_OPS.includes(entry.op)) fail(`${at}.op must be "upsert" or "delete"`);
    taskKey(entry.key, `${at}.key`);
    if (entry.title !== undefined) {
      text(entry.title, `${at}.title`, MAX_TITLE_CHARS, { empty: true });
    }
    if (entry.notes !== undefined) {
      text(entry.notes, `${at}.notes`, MAX_NOTES_CHARS, { empty: true });
    }
    // A due date that was cleared is null, which is not the same as a due date
    // this entry says nothing about.
    if (entry.due !== undefined && entry.due !== null) date(entry.due, `${at}.due`);
    if (entry.done !== undefined) flag(entry.done, `${at}.done`);
    if (entry.list !== undefined) text(entry.list, `${at}.list`, MAX_LIST_CHARS);
  });
}

function checkCompletions(completions) {
  array(completions, "completions");
  atMost(completions.length, MAX_COMPLETIONS, "completions");

  completions.forEach((completion, index) => {
    const at = `completions[${index}]`;
    object(completion, at);
    only(completion, COMPLETION, at);
    taskKey(completion.key, `${at}.key`);
    flag(completion.done, `${at}.done`);
    timestamp(completion.at, `${at}.at`);
  });
}

/**
 * The whole document, measured the way it will be stored.
 *
 * Counting the serialized bytes rather than the request body is what makes the
 * limit mean the same thing however the caller spaced its JSON.
 */
function withinSizeLimit(document) {
  let serialized;
  try {
    serialized = JSON.stringify(document);
  } catch {
    serialized = undefined;
  }
  if (typeof serialized !== "string") fail("document cannot be serialized as JSON");
  if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_BYTES) {
    fail(`document exceeds the ${MAX_DOCUMENT_BYTES} byte limit`);
  }
}

function fail(what) {
  throw new DocumentError(`${what}.`);
}

function object(value, at) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${at} must be an object`);
  }
}

function array(value, at) {
  if (!Array.isArray(value)) fail(`${at} must be an array`);
}

function atMost(count, limit, at) {
  if (count > limit) fail(`${at} holds more than ${limit} entries`);
}

function only(value, shape, at) {
  const allowed = [...shape.keys, ...shape.optional];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`${at} has a key that is not one of: ${allowed.join(", ")}`);
    }
  }
  for (const key of shape.keys) {
    if (value[key] === undefined) fail(`${at} is missing ${key}`);
  }
}

function text(value, at, max, { empty = false } = {}) {
  if (typeof value !== "string") fail(`${at} must be a string`);
  if (!empty && value.length === 0) fail(`${at} must not be empty`);
  if (value.length > max) fail(`${at} exceeds ${max} characters`);
}

function tag(value, at) {
  if (typeof value !== "string") fail(`${at} must be a string`);
  if (!TAG.test(value) || value.length > MAX_TAG_CHARS) {
    fail(`${at} must be a tag (letters, digits, "/", "_", "-", at most ${MAX_TAG_CHARS})`);
  }
}

function taskKey(value, at) {
  if (typeof value !== "string") fail(`${at} must be a string`);
  if (!TASK_KEY.test(value) || value.length > MAX_KEY_CHARS) {
    fail(`${at} must be a task key (letters, digits, "-", at most ${MAX_KEY_CHARS})`);
  }
}

function flag(value, at) {
  if (typeof value !== "boolean") fail(`${at} must be true or false`);
}

function integer(value, at, min, max) {
  if (!Number.isInteger(value)) fail(`${at} must be a whole number`);
  if (value < min || value > max) fail(`${at} must be between ${min} and ${max}`);
}

function counter(value, at) {
  if (!Number.isInteger(value) || value < 0) fail(`${at} must be a whole number, zero or more`);
}

/** A calendar date, and one that exists: 2026-02-30 parses and is not a day. */
function date(value, at) {
  if (typeof value !== "string" || !DATE.test(value)) fail(`${at} must be a date, as YYYY-MM-DD`);
  if (!exists(value)) fail(`${at} is not a date that exists`);
}

function exists(text) {
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function timestamp(value, at) {
  if (typeof value !== "string" || value.length > MAX_TIMESTAMP_CHARS || !TIMESTAMP.test(value)) {
    fail(`${at} must be an ISO 8601 date and time`);
  }
  if (Number.isNaN(Date.parse(value))) fail(`${at} is not a moment that exists`);
  // `Date.parse` rolls a thirty-first of September forward into October rather
  // than refusing it, so the calendar half is checked the same way a date is.
  if (!exists(value.slice(0, 10))) fail(`${at} is not a moment that exists`);
}
