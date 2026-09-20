/**
 * iCalendar and CalDAV, without a socket in sight.
 *
 * Everything that can be decided about a calendar event is decided here: how a
 * summary is escaped, where a line folds, which bytes a REPORT asks for, and
 * what a multistatus answer actually said. The network half is `caldav.mjs`
 * and does nothing but carry these strings back and forth, which is what makes
 * "iCloud put a semicolon in a title" reproducible on a laptop.
 *
 * Every parser here reads what a stranger sent. A calendar server is not
 * hostile on purpose, but it is old, it is someone else's, and the events in it
 * were written by clients this code has never heard of.
 */

export class IcalError extends Error {}

/** RFC 5545 folds content lines at 75 octets, not characters. */
export const FOLD_OCTETS = 75;

/** A multistatus with more parts than this is not an answer, it is a flood. */
export const MAX_MULTISTATUS_ENTRIES = 5000;

/** How much of one VEVENT this will walk before deciding it is not one. */
const MAX_EVENT_LINES = 5000;

const PRODID = "-//Schreibstube//Bridge//EN";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ICAL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const ICAL_DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

/**
 * A text value, escaped the way RFC 5545 §3.3.11 asks.
 *
 * Control characters are dropped rather than escaped: they have no
 * representation in a text value at all, and a NUL inside a SUMMARY is how the
 * next parser in the chain gets a surprise.
 */
export function escapeText(value) {
  return stripControl(String(value ?? "").replace(/\r\n?/g, "\n"))
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Written out rather than as a character class: a control character inside a
 *  regular expression is exactly the thing a linter should object to. */
function stripControl(value) {
  let out = "";
  for (const character of value) {
    const code = character.codePointAt(0);
    if (character !== "\n" && (code < 0x20 || code === 0x7f)) continue;
    out += character;
  }
  return out;
}

/** The inverse, forgiving of an escape nobody should have written. */
export function unescapeText(value) {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      out += character;
      continue;
    }
    const escaped = value[index + 1];
    // A trailing backslash escapes nothing; it is dropped rather than kept,
    // because keeping it would make the value re-escape differently.
    if (escaped === undefined) break;
    index += 1;
    out += escaped === "n" || escaped === "N" ? "\n" : escaped;
  }
  return out;
}

/**
 * Fold one content line to 75 octets.
 *
 * The split is counted in bytes and never lands inside a UTF-8 sequence: a
 * German title folded mid-umlaut comes back as two replacement characters, and
 * the event that carried it looks corrupt in every client that shows it.
 */
export function foldLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= FOLD_OCTETS) return line;

  const parts = [];
  let offset = 0;
  // Continuation lines start with a space, which counts against the 75.
  let limit = FOLD_OCTETS;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    while (end > offset + 1 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
    limit = FOLD_OCTETS - 1;
  }
  return parts.join("\r\n ");
}

/** Undo folding, tolerating a server that ends its lines with a bare LF. */
export function unfold(ics) {
  return String(ics ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

/** `2026-09-20T07:30:00Z` as `20260920T073000Z`. */
export function icalUtc(value) {
  const at = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(at.getTime())) throw new IcalError("A date and time is required.");
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * `2026-09-20` as `20260920`.
 *
 * Read off the string rather than through a Date, because an all-day event has
 * no time zone and running it through one moves it a day in half the world.
 */
export function icalDate(value) {
  const text = String(value ?? "");
  if (DATE.test(text)) return text.replace(/-/g, "");

  const at = new Date(text);
  if (Number.isNaN(at.getTime())) throw new IcalError("A date is required.");
  return at.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * One VEVENT, wrapped in the VCALENDAR a PUT has to carry.
 *
 * Timed events are written in UTC. A server that stores them in a named zone
 * is free to do so, and every server accepts the Z form — which keeps the
 * write path out of the business of guessing what "Europe/Berlin" means.
 */
export function buildEvent(event, { stamp = new Date() } = {}) {
  const uid = String(event?.uid ?? "");
  if (!uid) throw new IcalError("An event needs a UID.");

  const times = event.allDay
    ? [`DTSTART;VALUE=DATE:${icalDate(event.start)}`, `DTEND;VALUE=DATE:${icalDate(event.end)}`]
    : [`DTSTART:${icalUtc(event.start)}`, `DTEND:${icalUtc(event.end)}`];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeText(uid)}`,
    `DTSTAMP:${icalUtc(stamp)}`,
    ...times,
    `SUMMARY:${escapeText(event.title ?? "")}`,
    ...(event.notes ? [`DESCRIPTION:${escapeText(event.notes)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR"
  ];

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/**
 * One VEVENT, read back into the shape the plugin sees.
 *
 * An entry without a UID is not an event this bridge can address again, so it
 * is dropped rather than returned half-usable. Everything else missing is
 * reported as the empty string: a calendar full of events without summaries is
 * a real calendar, not an error.
 */
export function parseEvent(ics, { calendar = "" } = {}) {
  const event = { uid: "", title: "", start: "", end: "", allDay: false, calendar, notes: "" };
  let inside = false;
  let seen = 0;

  for (const line of unfold(ics)) {
    seen += 1;
    if (seen > MAX_EVENT_LINES) break;
    if (/^BEGIN:VEVENT\s*$/i.test(line)) {
      inside = true;
      continue;
    }
    if (/^END:VEVENT\s*$/i.test(line)) break;
    if (!inside) continue;

    const property = splitProperty(line);
    if (!property) continue;

    switch (property.name) {
      case "UID":
        event.uid = unescapeText(property.value.trim());
        break;
      case "SUMMARY":
        event.title = unescapeText(property.value);
        break;
      case "DESCRIPTION":
        event.notes = unescapeText(property.value);
        break;
      case "DTSTART": {
        const moment = readMoment(property);
        event.start = moment.value;
        event.allDay = moment.allDay;
        break;
      }
      case "DTEND": {
        event.end = readMoment(property).value;
        break;
      }
      default:
        break;
    }
  }

  return event.uid ? event : null;
}

/**
 * Where a property's name and parameters end and its value begins.
 *
 * The first colon usually settles it, but a quoted parameter may contain one —
 * `DTSTART;TZID="Europe/Berlin":…` is the ordinary case, not a contrived one.
 */
function splitProperty(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character !== ":" || quoted) continue;

    const [name, ...params] = line.slice(0, index).split(";");
    return { name: name.trim().toUpperCase(), params, value: line.slice(index + 1) };
  }
  return null;
}

function parameter(params, wanted) {
  for (const param of params) {
    const at = param.indexOf("=");
    if (at < 0) continue;
    if (param.slice(0, at).trim().toUpperCase() !== wanted) continue;
    return param
      .slice(at + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  return undefined;
}

/**
 * A DTSTART or DTEND, in any of the three forms a calendar actually uses.
 *
 * A UTC value and a named zone both become an instant. A floating time — no
 * zone, no Z — is handed back as written: it means "whatever the clock on the
 * wall says", and inventing an offset for it would be a guess with a day's
 * consequences.
 */
function readMoment({ params, value }) {
  const raw = value.trim();

  if (parameter(params, "VALUE")?.toUpperCase() === "DATE" || ICAL_DATE.test(raw)) {
    const parts = ICAL_DATE.exec(raw);
    return parts
      ? { allDay: true, value: `${parts[1]}-${parts[2]}-${parts[3]}` }
      : { allDay: true, value: "" };
  }

  const parts = ICAL_DATE_TIME.exec(raw);
  if (!parts) return { allDay: false, value: "" };

  const wall = {
    year: Number(parts[1]),
    month: Number(parts[2]),
    day: Number(parts[3]),
    hour: Number(parts[4]),
    minute: Number(parts[5]),
    second: Number(parts[6])
  };

  if (parts[7]) {
    return { allDay: false, value: new Date(utcOf(wall)).toISOString() };
  }

  const zone = parameter(params, "TZID");
  const instant = zone ? zonedToUtc(wall, zone) : null;
  if (instant !== null) return { allDay: false, value: new Date(instant).toISOString() };

  return {
    allDay: false,
    value: `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}`
  };
}

function utcOf(wall) {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/**
 * The instant at which a named zone's clock reads this wall time.
 *
 * Node carries the zone database, so the bridge does not have to: the offset is
 * read back out of `Intl` rather than guessed from a VTIMEZONE component that
 * half the servers omit. Two passes, because the offset that applies depends on
 * the instant, and across a daylight change the first guess sits on the wrong
 * side of it. Returns null for a zone this Node has never heard of, which is
 * the caller's cue to treat the time as floating.
 */
export function zonedToUtc(wall, timeZone) {
  let format;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return null;
  }

  const naive = utcOf(wall);
  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    guess = naive - (wallClock(format, guess) - guess);
  }
  return guess;
}

function wallClock(format, instant) {
  const parts = {};
  for (const part of format.formatToParts(new Date(instant))) parts[part.type] = part.value;
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
}

/**
 * The REPORT body that asks one calendar for a window of events.
 *
 * The window ends at midnight after `to`, so a request for a single day is a
 * request for that whole day rather than for its first instant.
 */
export function buildCalendarQuery({ from, to }) {
  const start = dayStamp(from, 0);
  const end = dayStamp(to, 1);

  return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${escapeXml(start)}" end="${escapeXml(end)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>
`;
}

/**
 * The REPORT body that asks a calendar where one UID lives.
 *
 * A resource's address is not derivable from its UID: a client that created the
 * event chose the file name, and iCloud's is a UUID of its own. Asking is the
 * only way an update lands on the event rather than beside it.
 */
export function buildUidQuery(uid) {
  const wanted = String(uid ?? "");
  if (!wanted) throw new IcalError("A UID is required.");

  return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:prop-filter name="UID">
          <c:text-match collation="i;octet">${escapeXml(wanted)}</c:text-match>
        </c:prop-filter>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>
`;
}

/** The PROPFIND body that asks a collection what it contains. */
export function buildCalendarPropfind() {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:displayname/><d:resourcetype/></d:prop>
</d:propfind>
`;
}

/**
 * A multistatus answer, flattened to one entry per response.
 *
 * Namespace prefixes are whatever the server felt like — `d:`, `D:`, none at
 * all — so the element names are matched with the prefix optional rather than
 * against a namespace this would then have to resolve.
 */
export function parseMultiStatus(xml, { limit = MAX_MULTISTATUS_ENTRIES } = {}) {
  const entries = [];
  const responses =
    /<(?:[A-Za-z0-9._-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9._-]+:)?response\s*>/gi;

  let found;
  while ((found = responses.exec(xml ?? "")) !== null) {
    if (entries.length >= limit) break;
    const block = found[1];
    entries.push({
      href: decodeXml(tagValue(block, "href") ?? "").trim(),
      etag: decodeXml(tagValue(block, "getetag") ?? "").trim(),
      ics: decodeXml(tagValue(block, "calendar-data") ?? ""),
      displayName: decodeXml(tagValue(block, "displayname") ?? "").trim(),
      // A calendar home and a calendar are both collections; only one of them
      // is something events can be asked for.
      isCalendar: /<(?:[A-Za-z0-9._-]+:)?calendar(?:\s[^>]*)?\/?>/i.test(block)
    });
  }
  return entries;
}

function tagValue(block, name) {
  const paired = new RegExp(
    `<(?:[A-Za-z0-9._-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9._-]+:)?${name}\\s*>`,
    "i"
  );
  const found = paired.exec(block);
  if (!found) return undefined;

  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(found[1]);
  return cdata ? cdata[1] : found[1];
}

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function decodeXml(value) {
  return String(value ?? "").replace(
    /&(?:amp|lt|gt|quot|apos|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g,
    (entity, decimal, hex) => {
      if (decimal !== undefined) return codePoint(Number.parseInt(decimal, 10), entity);
      if (hex !== undefined) return codePoint(Number.parseInt(hex, 16), entity);
      return { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }[entity];
    }
  );
}

/** An out-of-range code point is left as it was written rather than thrown
 *  over: a malformed entity in a description is not a reason to lose the day. */
function codePoint(value, entity) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return entity;
  try {
    return String.fromCodePoint(value);
  } catch {
    return entity;
  }
}

function dayStamp(value, addDays) {
  const text = String(value ?? "");
  if (!DATE.test(text)) throw new IcalError("A window bound must be a date, as YYYY-MM-DD.");

  const [year, month, day] = text.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day + addDays));
  if (Number.isNaN(at.getTime())) throw new IcalError("A window bound must be a date that exists.");
  return `${at.toISOString().slice(0, 10).replace(/-/g, "")}T000000Z`;
}
