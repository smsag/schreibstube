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

  /**
   * The calendars this bridge may touch.
   *
   * A configured allowlist is the operator's answer and is taken as given —
   * discovery would only let a calendar the operator did not name appear.
   * Without one, the server is asked, and the request's own list narrows
   * whatever comes back.
   */
  const permitted = async (requested) => {
    const available =
      calendars.length > 0 ? calendars : (await discover(client)).map((entry) => entry.name);
    if (requested.length === 0) return available;
    return requested.filter((name) => available.includes(name));
  };

  return {
    /** What the server says it has, narrowed to what the allowlist permits. */
    async listCalendars() {
      if (calendars.length > 0) {
        return calendars.map((name) => ({ name, displayName: name }));
      }
      return discover(client);
    },

    async listEvents({ from, to, calendars: requested = [], limit }) {
      const names = await permitted(requested);
      const events = [];

      for (const name of names) {
        const answer = await send(client, {
          method: "REPORT",
          url: calendarUrl(name),
          headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
          body: buildCalendarQuery({ from, to }),
          label: "Calendar query"
        });
        // A calendar that has gone is not a failed request; the others still
        // have a day in them.
        if (answer.status === 404) continue;
        expect(answer, [207], "Calendar query");

        for (const entry of parseMultiStatus(answer.text)) {
          if (!entry.ics) continue;
          const event = parseEvent(entry.ics, { calendar: name });
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
      const names = await permitted([calendar]);
      if (names.length === 0) {
        throw new CalDavError("That calendar is not one this bridge may write to.");
      }

      const identifier = uid ?? randomUUID();
      if (!SEGMENT.test(identifier)) {
        throw new CalDavError("That is not a usable event identifier.");
      }

      const existing = uid ? await locate(client, calendarUrl(calendar), uid) : null;
      const target =
        existing ?? sameHost(new URL(`${identifier}.ics`, calendarUrl(calendar)), base);

      const answer = await send(client, {
        method: "PUT",
        url: target,
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          // Only on a create: it turns "the name was already taken" into a
          // refusal rather than into someone else's event being overwritten.
          ...(uid ? {} : { "if-none-match": "*" })
        },
        body: buildEvent({ uid: identifier, title, start, end, notes, allDay }),
        label: "Calendar write"
      });
      expect(answer, [200, 201, 204], "Calendar write");

      return { uid: identifier };
    },

    async deleteEvent({ uid, calendar }) {
      const names = await permitted([calendar]);
      if (names.length === 0) {
        throw new CalDavError("That calendar is not one this bridge may write to.");
      }

      const target = await locate(client, calendarUrl(calendar), uid);
      if (!target) return { deleted: false };

      const answer = await send(client, {
        method: "DELETE",
        url: target,
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
 * Where a UID actually lives, or null when the calendar does not have it.
 *
 * The href comes from the server, so it is resolved against the base and
 * checked like any other address before the credential follows it there.
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
    return sameHost(new URL(entry.href, client.base), client.base);
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
  // socket rather than leaving it open behind a settled promise.
  const timer = setTimeout(() => controller.abort(), client.timeoutMs);
  timer.unref?.();

  let response;
  try {
    response = await fetch(sameHost(url, client.base), {
      method,
      headers: { authorization: client.authorization, ...headers },
      body,
      signal: controller.signal,
      // Followed by hand, so that the host check above sees every hop. Left to
      // fetch, a redirect decides for itself where the Authorization goes.
      redirect: "manual"
    });
  } catch (err) {
    if (err instanceof CalDavError) throw err;
    throw new CalDavError(`${label} could not reach the calendar server.`);
  } finally {
    clearTimeout(timer);
  }

  const location = response.headers.get("location");
  if ([301, 302, 303, 307, 308].includes(response.status) && location) {
    if (hop >= MAX_REDIRECTS) throw new CalDavError(`${label} was redirected too many times.`);
    // 303, and 302 in practice, mean "ask again with GET" — which is not a
    // request this client ever makes, so the chain stops rather than guessing.
    if (response.status === 303) throw new CalDavError(`${label} was redirected to a GET.`);

    const next = sameHost(new URL(location, url), client.base);
    return attempt(client, { method, url: next, headers, body, label }, hop + 1);
  }

  return { status: response.status, text: await readBounded(response, client, label) };
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
