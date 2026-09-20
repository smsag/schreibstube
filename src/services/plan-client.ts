import { requestUrl } from "obsidian";
import { withTimeout } from "../utils/with-timeout";
import { authHeaders, buildEndpoint } from "./bridge-protocol";
import type { PlanDocument } from "./plan-model";
import {
  describePlanError,
  parseHealth,
  eventsQuery,
  parseEvents,
  parseEventUid,
  conflictFrom,
  parseStoredPlan,
  PlanConflict,
  PLAN_REQUEST_TIMEOUT_MS,
  type CalendarEvent,
  type BridgeHealth,
  type EventDraft,
  type PlanBridgeConfig,
  type StoredPlan
} from "./plan-protocol";

/**
 * Transport for the planning bridge.
 *
 * Obsidian's `requestUrl` again, for the same reason the mail client uses it:
 * it behaves identically on a phone and on a laptop, and the planner has to
 * work on both. Every decision about what came back is in plan-protocol.
 */

/** What the deployment is actually running; the one call that needs no token. */
export async function fetchHealth(config: PlanBridgeConfig): Promise<BridgeHealth> {
  return parseHealth(await call(config, "GET", "/health"));
}

export async function fetchPlan(config: PlanBridgeConfig): Promise<StoredPlan> {
  return parseStoredPlan(await call(config, "GET", "/plan"));
}

/**
 * Writes the plan against the revision it was read at. A bridge holding a
 * newer one refuses, and the refusal carries that newer plan, so the caller
 * can redo its change on top instead of asking a person to.
 */
export async function savePlan(
  config: PlanBridgeConfig,
  rev: number,
  plan: PlanDocument
): Promise<StoredPlan> {
  const response = await request(config, "PUT", "/plan", { rev, document: plan });
  const conflict = response.status === 409 ? conflictFrom(response.json) : null;
  if (conflict) throw new PlanConflict(conflict);
  refuse(response);
  return { rev: parseStoredPlan(response.json).rev, plan };
}

export async function fetchEvents(
  config: PlanBridgeConfig,
  from: string,
  to: string,
  calendars: readonly string[]
): Promise<CalendarEvent[]> {
  return parseEvents(await call(config, "GET", eventsQuery(from, to, calendars)));
}

export async function saveEvent(config: PlanBridgeConfig, draft: EventDraft): Promise<string> {
  return parseEventUid(await call(config, "POST", "/calendar/events", draft));
}

export async function deleteEvent(
  config: PlanBridgeConfig,
  uid: string,
  calendar: string
): Promise<void> {
  await call(config, "POST", "/calendar/events/delete", { uid, calendar });
}

interface Response {
  status: number;
  text: string;
  json: unknown;
}

async function call(
  config: PlanBridgeConfig,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown
): Promise<unknown> {
  const response = await request(config, method, path, body);
  refuse(response);
  return response.json;
}

function refuse(response: Response): void {
  if (response.status >= 200 && response.status < 300) return;
  throw new Error(describePlanError(response.status, response.text));
}

async function request(
  config: PlanBridgeConfig,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown
): Promise<Response> {
  const response = await withTimeout(
    requestUrl({
      url: buildEndpoint(config.baseUrl, path),
      method,
      headers: authHeaders(config.token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      throw: false
    }),
    PLAN_REQUEST_TIMEOUT_MS,
    (seconds) => `bridge did not respond within ${seconds}s.`
  );

  let json: unknown;
  try {
    json = response.json;
  } catch {
    json = null;
  }
  return { status: response.status, text: response.text ?? "", json };
}
