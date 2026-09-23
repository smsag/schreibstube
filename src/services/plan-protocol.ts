/**
 * What the planner and the bridge say to each other.
 *
 * The plan document travels whole, with the revision it was read at: the
 * bridge accepts a write only against the revision it still holds, so two
 * devices planning at once produce a refusal to re-read rather than a
 * silently overwritten afternoon.
 *
 * Parsing lives here, apart from the transport, because a response from a
 * service someone runs themselves is exactly the kind of input this codebase
 * validates rather than trusts.
 */
import { asRecord, describeBridgeError as describeError, str } from "./bridge-protocol";
import { dayKey, normalizePlan, shiftDay, type PlanDocument } from "./plan-model";

/**
 * The bridge protocol the planner needs.
 *
 * Plugin and bridge are deployed separately and will drift. An older bridge
 * answers a route it does not have with a 404, which reads as a wrong URL
 * rather than as a redeploy that has not happened, so the planner asks once.
 */
export const PLAN_PROTOCOL_VERSION = 2;

/** A planning call is one small document; a slow answer means a sick bridge. */
export const PLAN_REQUEST_TIMEOUT_MS = 20_000;

export interface PlanBridgeConfig {
  baseUrl: string;
  token: string;
}

export interface StoredPlan {
  rev: number;
  plan: PlanDocument;
}

export interface CalendarEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  notes: string;
}

export interface EventDraft {
  uid?: string;
  title: string;
  start: string;
  end: string;
  calendar: string;
  notes?: string;
}

/** Raised when the bridge holds a newer plan than the one being written. */
export class PlanConflict extends Error {
  constructor(readonly stored: StoredPlan) {
    super("the plan changed elsewhere.");
    this.name = "PlanConflict";
  }
}

/**
 * Whether a refused write is the one refusal worth redoing.
 *
 * The bridge answers every error with `{error, code, requestId}`, and a
 * conflict adds the revision and the document that won. Both have to be there:
 * a 409 without them is some other refusal, and treating it as a conflict
 * would have the caller redo its change on an empty plan.
 */
export function conflictFrom(json: unknown): StoredPlan | null {
  const root = asRecord(json);
  if (root.code !== "conflict" || root.document === undefined) return null;
  return parseStoredPlan(root);
}

export function parseStoredPlan(json: unknown): StoredPlan {
  const root = asRecord(json);
  const rev = typeof root.rev === "number" && root.rev >= 0 ? Math.floor(root.rev) : 0;
  return { rev, plan: normalizePlan(root.document ?? root.plan) };
}

export function parseEvents(json: unknown): CalendarEvent[] {
  const root = asRecord(json);
  const events = Array.isArray(root.events) ? root.events : [];
  return events
    .slice(0, 2000)
    .map(parseEvent)
    .filter((event): event is CalendarEvent => !!event);
}

function parseEvent(value: unknown): CalendarEvent | null {
  const raw = asRecord(value);
  const uid = str(raw.uid);
  const start = str(raw.start);
  const end = str(raw.end);
  if (!uid || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;

  return {
    uid,
    title: str(raw.title),
    start,
    end,
    allDay: raw.allDay === true,
    calendar: str(raw.calendar),
    notes: str(raw.notes)
  };
}

export function parseEventUid(json: unknown): string {
  const uid = str(asRecord(json).uid);
  if (!uid) throw new Error("the bridge did not return an event id.");
  return uid;
}

/** The query string for a calendar read, with the window kept inside bounds. */
export function eventsQuery(from: string, to: string, calendars: readonly string[]): string {
  const parameters = new URLSearchParams({ from, to });
  const named = calendars.filter((name) => name.trim() !== "");
  if (named.length > 0) parameters.set("calendars", named.join(","));
  return `/calendar/events?${parameters.toString()}`;
}

export function describePlanError(status: number, body: string): string {
  if (status === 401) return "bridge rejected the token — check the planner's token.";
  if (status === 404) return "bridge has no planning capability — check its configuration.";
  if (status === 413) return "the plan is too large for the bridge to accept.";
  return describeError(status, body, "calendar server");
}

/**
 * The calendar's events that fall on one local day, earliest first.
 *
 * A timed event counts when any of it overlaps the day. An all-day event
 * comes as bare dates with an exclusive end, which a clock would read as UTC
 * midnight and so shift by the reader's offset; it is compared as dates.
 */
export function eventsOn(events: readonly CalendarEvent[], day: string): CalendarEvent[] {
  const from = new Date(`${day}T00:00:00`).getTime();
  const to = new Date(`${dayKey(shiftDay(new Date(`${day}T00:00:00`), 1))}T00:00:00`).getTime();

  return events
    .filter((event) => {
      if (event.allDay) {
        // Some servers write a one-day event with no end; its start is its day.
        const first = event.start.slice(0, 10);
        return first === day || (first < day && event.end.slice(0, 10) > day);
      }
      return Date.parse(event.start) < to && Date.parse(event.end) > from;
    })
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}
