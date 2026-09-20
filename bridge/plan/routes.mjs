/**
 * The plan capability: one stored document and a calendar to write into.
 *
 *   GET  /plan                    the document and the revision it is at
 *   PUT  /plan                    store it, if nobody moved it meanwhile
 *   GET  /calendar/events         a bounded window of a bounded set of calendars
 *   POST /calendar/events         create one, or replace the one with that UID
 *   POST /calendar/events/delete  remove it, and say whether there was one
 *
 * The document is the plugin's; the bridge never reads meaning into it. What it
 * does is refuse a document it cannot store safely, and refuse a write that was
 * written against a revision somebody else has already replaced — because the
 * document is edited from a laptop, a phone and a helper, and last-writer-wins
 * on a whole document loses a day's planning rather than a field.
 */
import { httpError } from "../http.mjs";
import { CalDavError, createCalDavClient } from "./caldav.mjs";
import { checkDocument, DocumentError } from "./document.mjs";
import { createPlanStore, PlanStoreError } from "./store.mjs";

/** A window nobody asks for by hand, and an answer that still fits in memory. */
export const MAX_WINDOW_DAYS = 120;
export const MAX_EVENTS = 2000;
/** More than one calendar per weekday is somebody's mistake, not a query. */
const MAX_CALENDARS_PER_REQUEST = 50;

const MAX_TITLE_CHARS = 500;
const MAX_NOTES_CHARS = 4000;
const MAX_UID_CHARS = 200;
const MAX_CALENDAR_CHARS = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$/;
const CALENDAR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createPlanRoutes(config) {
  const plan = config.plan;
  const store = createPlanStore(plan.store);
  const calendar = createCalDavClient({
    ...plan.caldav,
    timeoutMs: config.upstreamTimeoutMs,
    maxResponseBytes: plan.maxResponseBytes
  });

  const route = (method, path, maxBytes, handler) => ({
    method,
    path,
    capability: "plan",
    maxBytes,
    bodyType: method === "GET" ? "none" : "json",
    handler
  });

  return [
    route("GET", "/plan", 0, async () => stored(store)),

    route("PUT", "/plan", plan.maxBodyBytes, async ({ body, log }) => {
      const expected = body?.rev;
      if (!Number.isInteger(expected) || expected < 0) {
        throw httpError(400, "invalid_request", "rev must be a whole number, zero or more.");
      }

      let document;
      try {
        document = checkDocument(body?.document);
      } catch (err) {
        if (!(err instanceof DocumentError)) throw err;
        throw httpError(400, "invalid_document", err.message);
      }

      const result = await write(store, document, expected);
      if (!result.ok) {
        // The current revision travels with the refusal, so the late writer
        // re-applies its change without a second round trip.
        throw conflict(result);
      }

      log("info", `plan stored at revision ${result.rev}`);
      return { rev: result.rev };
    }),

    route("GET", "/calendar/events", 0, async ({ query, log }) => {
      const window = checkWindow(query.get("from"), query.get("to"));
      const names = checkCalendarList(query.get("calendars"));

      const result = await upstream(() =>
        calendar.listEvents({ ...window, calendars: names, limit: MAX_EVENTS })
      );
      log("info", `calendar window returned ${result.events.length} event(s)`);
      return result;
    }),

    route("POST", "/calendar/events", 64_000, async ({ body, log }) => {
      const event = checkEvent(body ?? {});
      const result = await upstream(() => calendar.saveEvent(event));
      // The title is the note's own text; the identifier is not.
      log("info", `calendar event ${result.uid} written`);
      return result;
    }),

    route("POST", "/calendar/events/delete", 16_000, async ({ body, log }) => {
      const uid = checkUid(body?.uid, { required: true });
      const name = checkCalendarName(body?.calendar);

      const result = await upstream(() => calendar.deleteEvent({ uid, calendar: name }));
      log("info", `calendar event ${uid} ${result.deleted ? "deleted" : "was already gone"}`);
      return result;
    })
  ];
}

async function stored(store) {
  try {
    return await store.read();
  } catch (err) {
    throw asHttp(err);
  }
}

async function write(store, document, expected) {
  try {
    return await store.write(document, expected);
  } catch (err) {
    throw asHttp(err);
  }
}

function asHttp(err) {
  // The store's own messages name the problem without quoting the document, so
  // they are safe to pass on — and they are the only way an operator learns
  // that the file on the volume has been edited into something unusable.
  if (err instanceof PlanStoreError) return httpError(500, "plan_store_error", err.message);
  return err;
}

/**
 * A conflict carries the winning revision and the document that holds it.
 *
 * The bridge's error shape is `{error, code, requestId}`; this adds the two
 * fields the caller needs to recover, which the server merges into the body.
 * The client keys on `code`, as it does everywhere else.
 */
function conflict(result) {
  const err = httpError(
    409,
    "conflict",
    "The stored plan has moved on. Re-read it and apply the change again."
  );
  err.payload = { rev: result.rev, document: result.document };
  return err;
}

async function upstream(work) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof CalDavError) throw httpError(502, "caldav_error", err.message);
    throw err;
  }
}

function checkWindow(from, to) {
  if (!DATE.test(String(from ?? "")) || !DATE.test(String(to ?? ""))) {
    throw httpError(400, "invalid_request", "from and to are required, as YYYY-MM-DD.");
  }

  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw httpError(400, "invalid_request", "from and to must be dates that exist.");
  }
  if (end < start) throw httpError(400, "invalid_request", "to must not precede from.");

  // Counted in days rather than in events, because the bound has to hold
  // before the calendar has been asked anything.
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > MAX_WINDOW_DAYS) {
    throw httpError(400, "window_too_wide", `A window covers at most ${MAX_WINDOW_DAYS} days.`);
  }

  return { from, to };
}

function checkCalendarList(value) {
  if (value === null || value.trim() === "") return [];

  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length > MAX_CALENDARS_PER_REQUEST) {
    throw httpError(
      400,
      "invalid_request",
      `calendars names at most ${MAX_CALENDARS_PER_REQUEST} calendars.`
    );
  }
  return names.map((name) => checkCalendarName(name));
}

function checkCalendarName(value) {
  if (typeof value !== "string" || !CALENDAR.test(value) || value.length > MAX_CALENDAR_CHARS) {
    throw httpError(400, "invalid_request", "A calendar name is required.");
  }
  return value;
}

function checkUid(value, { required }) {
  if (value === undefined || value === null) {
    if (!required) return undefined;
    throw httpError(400, "invalid_request", "uid is required.");
  }
  // The UID becomes a path segment on a create, so it is held to what a
  // segment may hold rather than to what a string may.
  if (typeof value !== "string" || !CALENDAR.test(value) || value.length > MAX_UID_CHARS) {
    throw httpError(
      400,
      "invalid_request",
      "uid must be letters, digits, dot, dash or underscore."
    );
  }
  return value;
}

function checkEvent(body) {
  const allDay = body.allDay ?? false;
  if (typeof allDay !== "boolean") {
    throw httpError(400, "invalid_request", "allDay must be true or false.");
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    throw httpError(400, "invalid_request", "A non-empty title is required.");
  }
  if (body.title.length > MAX_TITLE_CHARS) {
    throw httpError(400, "invalid_request", `title exceeds ${MAX_TITLE_CHARS} characters.`);
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") {
      throw httpError(400, "invalid_request", "notes must be a string.");
    }
    if (body.notes.length > MAX_NOTES_CHARS) {
      throw httpError(400, "invalid_request", `notes exceeds ${MAX_NOTES_CHARS} characters.`);
    }
  }

  // An all-day event has no time zone; a timed one is an instant. Mixing the
  // two shapes is how an event lands a day out, so each is required to look
  // like itself.
  const moment = (value, field) => {
    const pattern = allDay ? DATE : TIMESTAMP;
    if (typeof value !== "string" || !pattern.test(value) || Number.isNaN(Date.parse(value))) {
      throw httpError(
        400,
        "invalid_request",
        allDay
          ? `${field} must be a date, as YYYY-MM-DD.`
          : `${field} must be an ISO date and time.`
      );
    }
    return value;
  };

  const start = moment(body.start, "start");
  const end = moment(body.end, "end");
  if (Date.parse(end) < Date.parse(start)) {
    throw httpError(400, "invalid_request", "end must not precede start.");
  }

  return {
    uid: checkUid(body.uid, { required: false }),
    title: body.title,
    start,
    end,
    calendar: checkCalendarName(body.calendar),
    notes: body.notes,
    allDay
  };
}
