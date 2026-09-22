/**
 * The CalDAV side of planning: the part that needs a socket, and nothing else.
 *
 * Every decision — what the XML says, how a title is escaped, what a
 * multistatus meant — is in `ical.mjs` and is tested without a network. What is
 * left here is four verbs (PROPFIND, REPORT, PUT, DELETE) and the rules that
 * come with carrying a password:
 *
 *   one host    the credential goes to the host in CALDAV_URL and nowhere
 *               else. Redirects are followed only within that host, and an
 *               href the server hands back is resolved and re-checked before
 *               anything is sent to it.
 *   one deadline every request, body included, is raced against the configured
 *               upstream budget and aborted when it loses.
 *   one bound   a response is read up to a limit and then abandoned. A calendar
 *               with ten years of events in it is a real thing.
 */
import { randomUUID } from "node:crypto";
import { withDeadline } from "../timeout.mjs";
import {
  buildCalendarPropfind,
  buildCalendarQuery,
  buildEvent,
  buildUidQuery,
  parseEvent,
  parseMultiStatus
} from "./ical.mjs";

export class CalDavError extends Error {}

/**
 * What may be a path segment.
 *
 * `encodeURIComponent` leaves a dot alone, so ".." survives encoding intact and
 * would walk out of the collection. Naming the characters that are allowed is
 * the only version of this check that stays right.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** A redirect chain longer than this is a loop with extra steps. */
const MAX_REDIRECTS = 3;

/**
 * How long the server's list of calendars is trusted. It changes when someone
 * creates a calendar, not between two requests, and asking it again on every
 * request doubles the round trips of every day the planner shows.
 */
const DISCOVERY_TTL_MS = 5 * 60_000;

export function createCalDavClient({
  url,
  user,
  password,
  calendars = [],
  timeoutMs,
  maxResponseBytes
}) {
  const base = new URL(url.endsWith("/") ? url : `${url}/`);
  const authorization = `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
  const client = { base, authorization, timeoutMs, maxResponseBytes };

  /** Where a named calendar lives, checked before it is a URL at all. */
  const calendarUrl = (name) => {
    if (!SEGMENT.test(name)) throw new CalDavError("That is not a usable calendar name.");
    return sameHost(new URL(`${encodeURIComponent(name)}/`, base), base);
  };

  let discovered = null;
  const discoverCached = async () => {
    if (discovered && Date.now() - discovered.at < DISCOVERY_TTL_MS) return discovered.found;
    const found = await discover(client);
    discovered = { at: Date.now(), found };
    return found;
  };

  /** What the server has, narrowed to what the allowlist permits. */
  const catalogue = async () => {
    const found = await discoverCached();
    return calendars.length > 0 ? found.filter((entry) => calendars.includes(entry.name)) : found;
  };

  /**
   * The calendars this bridge may touch, as the path segments it addresses.
   *
   * A person names a calendar the way their calendar app shows it; the server
   * addresses it by a segment that on iCloud is an opaque identifier. So a
   * requested name is taken as a segment when it is one, and otherwise
   * matched against the names discovery reports, without regard to case. An
   * allowlist is the operator's answer: a name it lists needs no discovery,
   * and nothing outside it is ever offered.
   */
  const permitted = async (requested) => {
    if (requested.length === 0) {
      return calendars.length > 0 ? calendars : (await catalogue()).map((entry) => entry.name);
    }
    if (requested.every((name) => calendars.includes(name))) return [...requested];

    const known = await catalogue();
    const names = [];
    for (const wanted of requested) {
      const lower = wanted.toLowerCase();
      const hit =
        known.find((entry) => entry.name === wanted) ??
        known.find(
          (entry) => entry.name.toLowerCase() === lower || entry.displayName.toLowerCase() === lower
        );
      if (hit && !names.includes(hit.name)) names.push(hit.name);
    }
    return names;
  };

  const writable = async (calendar) => {
    const [name] = await permitted([calendar]);
    if (name === undefined) {
      throw new CalDavError("That calendar is not one this bridge may write to.");
    }
    return name;
  };

  return {
    /** What the server says it has, narrowed to what the allowlist permits. */
    async listCalendars() {
      if (calendars.length > 0) {
        return calendars.map((name) => ({ name, displayName: name }));
      }
      return catalogue();
    },

    /**
     * Every event in the window, across the permitted calendars.
     *
     * The calendars are asked at once rather than one after the other: each
     * is a round trip to a server that may be a continent away, and a day in
     * the planner should cost one of them, not one per calendar.
     */
    async listEvents({ from, to, calendars: requested = [], limit }) {
      const names = await permitted(requested);
      const answers = await Promise.all(
        names.map((name) =>
          send(client, {
            method: "REPORT",
            url: calendarUrl(name),
            headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
            body: buildCalendarQuery({ from, to }),
            label: "Calendar query"
          })
        )
      );

      const events = [];
      for (const [index, answer] of answers.entries()) {
        // A calendar that has gone is not a failed request; the others still
        // have a day in them.
        if (answer.status === 404) continue;
        expect(answer, [207], "Calendar query");

        for (const entry of parseMultiStatus(answer.text)) {
          if (!entry.ics) continue;
          const event = parseEvent(entry.ics, { calendar: names[index] });
          if (!event) continue;
          if (events.length >= limit) return { events, truncated: true };
          events.push(event);
        }
      }

      return { events, truncated: false };
    },

    /**
     * Create an event, or replace the one that already carries this UID.
     *
     * An update asks the server where the UID lives before writing. The
     * resource's name is whichever client created it — iCloud's is a UUID of
     * its own — so writing to `<uid>.ics` on the strength of the UID alone is
     * how one event becomes two.
     */
    async saveEvent({ uid, title, start, end, calendar, notes, allDay }) {
      const name = await writable(calendar);

      const identifier = uid ?? randomUUID();
      if (!SEGMENT.test(identifier)) {
        throw new CalDavError("That is not a usable event identifier.");
      }

      const existing = uid ? await locate(client, calendarUrl(name), uid) : null;
      const target =
        existing?.url ?? sameHost(new URL(`${identifier}.ics`, calendarUrl(name)), base);

      const answer = await send(client, {
        method: "PUT",
        url: target,
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          // A write says what it expects to find. Nothing, when the event is
          // new — so a name already taken is a refusal, not someone else's
          // event overwritten. The version it read, when it is an update — so
          // an edit made in between on another device is not silently lost.
          ...(existing === null
            ? { "if-none-match": "*" }
            : existing.etag
              ? { "if-match": existing.etag }
              : {})
        },
        body: buildEvent({ uid: identifier, title, start, end, notes, allDay }),
        label: "Calendar write"
      });
      if (answer.status === 412) {
        throw new CalDavError(
          existing === null
            ? "Another event already has that name on the calendar server."
            : "The event changed on the calendar server meanwhile. Try again."
        );
      }
      expect(answer, [200, 201, 204], "Calendar write");

      return { uid: identifier };
    },

    async deleteEvent({ uid, calendar }) {
      const name = await writable(calendar);

      const existing = await locate(client, calendarUrl(name), uid);
      if (!existing) return { deleted: false };

      const answer = await send(client, {
        method: "DELETE",
        url: existing.url,
        label: "Calendar delete"
      });
      // Gone before we got there is the outcome the caller asked for, reported
      // honestly: nothing was deleted by this request.
      if (answer.status === 404 || answer.status === 410) return { deleted: false };
      expect(answer, [200, 202, 204], "Calendar delete");

      return { deleted: true };
    }
  };
}

async function discover(client) {
  const answer = await send(client, {
    method: "PROPFIND",
    url: client.base,
    headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
    body: buildCalendarPropfind(),
    label: "Calendar discovery"
  });
  expect(answer, [207], "Calendar discovery");

  const found = [];
  for (const entry of parseMultiStatus(answer.text)) {
    if (!entry.isCalendar || !entry.href) continue;

    const name = segmentOf(entry.href, client.base);
    if (!name || found.some((calendar) => calendar.name === name)) continue;
    found.push({ name, displayName: entry.displayName || name });
  }
  return found;
}

/**
 * Where a UID actually lives, and the version found there, or null when the
 * calendar does not have it.
 *
 * CalDAV's text-match is a substring match, so `abc` also finds `abcd`: the
 * UID inside each answer is read back and compared whole. The href comes
 * from the server, so it is resolved against the base and checked like any
 * other address before the credential follows it there.
 */
async function locate(client, calendar, uid) {
  const answer = await send(client, {
    method: "REPORT",
    url: calendar,
    headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
    body: buildUidQuery(uid),
    label: "Calendar lookup"
  });
  if (answer.status === 404) return null;
  expect(answer, [207], "Calendar lookup");

  for (const entry of parseMultiStatus(answer.text)) {
    if (!entry.href) continue;
    if (entry.ics && parseEvent(entry.ics, { calendar: "" })?.uid !== uid) continue;
    return {
      url: sameHost(new URL(entry.href, client.base), client.base),
      etag: entry.etag || null
    };
  }
  return null;
}

/**
 * The last path segment of an href, once it is known to be on our host.
 *
 * Anything that cannot be a segment is skipped rather than escaped: a calendar
 * this bridge cannot address safely is a calendar it should not offer.
 */
function segmentOf(href, base) {
  let resolved;
  try {
    resolved = sameHost(new URL(href, base), base);
  } catch {
    return null;
  }

  const segments = resolved.pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (last === undefined) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    return null;
  }
  return SEGMENT.test(decoded) ? decoded : null;
}

/**
 * The rule that makes the password safe to hold: it goes to one host.
 *
 * Not "usually", and not "unless the server says otherwise" — a redirect and an
 * href are both the server's words, and both pass through here.
 */
function sameHost(target, base) {
  if (target.protocol !== base.protocol || target.host !== base.host) {
    throw new CalDavError("The calendar server pointed somewhere this bridge will not follow.");
  }
  return target;
}

async function send(client, { method, url, headers = {}, body, label }) {
  return withDeadline(
    attempt(client, { method, url, headers, body, label }),
    client.timeoutMs,
    label
  );
}

async function attempt(client, { method, url, headers, body, label }, hop = 0) {
  const controller = new AbortController();
  // The deadline alone would stop waiting; the abort is what lets go of the
  // socket rather than leaving it open behind a settled promise. So it stays
  // armed until the body has been read, not only until the headers arrived:
  // a server that answers and then stalls mid-body is the case it is for.
  const timer = setTimeout(() => controller.abort(), client.timeoutMs);
  timer.unref?.();

  try {
    let response;
    try {
      response = await fetch(sameHost(url, client.base), {
        method,
        headers: { authorization: client.authorization, ...headers },
        body,
        signal: controller.signal,
        // Followed by hand, so that the host check above sees every hop. Left
        // to fetch, a redirect decides for itself where the Authorization goes.
        redirect: "manual"
      });
    } catch (err) {
      if (err instanceof CalDavError) throw err;
      throw new CalDavError(`${label} could not reach the calendar server.`);
    }

    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      // A redirect's own body is never read; released now, its connection
      // goes back to the pool instead of waiting to be collected.
      await response.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new CalDavError(`${label} was redirected too many times.`);
      // 303, and 302 in practice, mean "ask again with GET" — which is not a
      // request this client ever makes, so the chain stops rather than guessing.
      if (response.status === 303) throw new CalDavError(`${label} was redirected to a GET.`);

      const next = sameHost(new URL(location, url), client.base);
      return attempt(client, { method, url: next, headers, body, label }, hop + 1);
    }

    try {
      return { status: response.status, text: await readBounded(response, client, label) };
    } catch (err) {
      if (err instanceof CalDavError) throw err;
      throw new CalDavError(`${label} stopped before the calendar server finished answering.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * As much of a response as the budget allows, and not one byte more.
 *
 * The declared length settles it for a well-behaved server; the read is
 * counted anyway, because a chunked response declares nothing.
 */
async function readBounded(response, client, label) {
  const limit = client.maxResponseBytes;
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isInteger(declared) && declared > limit) {
    await response.body?.cancel().catch(() => {});
    throw new CalDavError(`${label} returned more than ${limit} bytes.`);
  }
  if (!response.body) return "";

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) {
      await response.body.cancel().catch(() => {});
      throw new CalDavError(`${label} returned more than ${limit} bytes.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A status the request can go on from, or a failure that says only the status.
 *
 * The body is deliberately not quoted: a CalDAV error document carries hrefs,
 * principal URLs and sometimes the account name, none of which is the vault's
 * business. The operator has the request id and the log.
 */
function expect(answer, allowed, label) {
  if (allowed.includes(answer.status)) return;
  if (answer.status === 401 || answer.status === 403) {
    throw new CalDavError(`${label} was refused by the calendar server (${answer.status}).`);
  }
  throw new CalDavError(`${label} failed (${answer.status}).`);
}
