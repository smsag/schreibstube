import type { Messages } from "../../i18n";
import { isModelPinError } from "./model-pins";

export type SemanticState =
  | "off"
  | "blocked"
  | "notBuilt"
  | "loading"
  | "building"
  | "ready"
  | "partial"
  | "outdated"
  | "failed"
  | "paused"
  | "phonePaused"
  | "desktopBuilds";

/** What a failure was, as far as the status line can say what to do about it. */
export type FailureCause = "offline" | "timeout" | "modelPin" | "other";

/** Where the index stands, as the settings tab reports it. */
export interface SemanticStatus {
  state: SemanticState;
  count: number;
  /** On "blocked": the plugin whose own model keeps this one off the phone. */
  blockedBy?: string;
  /** How many notes one "Build now" adds on a phone. */
  budget?: number;
  done: number;
  total: number;
  /** The raw failure, for the log and the report; the status line says it only
   *  when nothing better can be said. */
  error: string | null;
  cause?: FailureCause;
  outOfMemory: boolean;
  backend: string | null;
}

/**
 * What a failure was, from its message: the model could not be fetched with
 * the device offline, or the backend did not answer in time. The messages are
 * the runtime's own English, so the status line says the cause in the
 * person's language and leaves the text to the log.
 */
export function failureCause(error: unknown): FailureCause {
  // First: a pin refusal can mention a timeout or an address, and is the one
  // cause no retry can fix.
  if (isModelPinError(error)) return "modelPin";
  const message = error instanceof Error ? error.message : String(error);
  if (/\boffline\b/i.test(message)) return "offline";
  if (/timed? ?out/i.test(message)) return "timeout";
  return "other";
}

/** One sentence for the status line. Out of memory, being offline and a
 *  timeout are said instead of the raw error, because the raw one ("RangeError:
 *  Array buffer allocation failed") does not say what to do about it. */
export function semanticStatusText(
  status: SemanticStatus,
  strings: Messages["semantic"]["state"]
): string {
  switch (status.state) {
    case "off":
      return strings.off;
    case "blocked":
      return strings.blocked(status.blockedBy ?? "");
    case "notBuilt":
      return strings.notBuilt;
    case "loading":
      return strings.loading;
    case "building":
      return strings.building(status.done, status.total);
    case "ready":
      return strings.ready(status.count);
    case "partial":
      return strings.partial(status.count);
    case "outdated":
      return strings.outdated(status.count);
    case "failed":
      if (status.outOfMemory) return strings.outOfMemory;
      if (status.cause === "offline") return strings.offline;
      if (status.cause === "timeout") return strings.timedOut;
      if (status.cause === "modelPin") return strings.modelPin;
      return strings.failed(status.error ?? "");
    case "paused":
      return strings.paused;
    case "phonePaused":
      return strings.phonePaused;
    case "desktopBuilds":
      return strings.desktopBuilds(status.count, status.budget ?? 0);
  }
}
