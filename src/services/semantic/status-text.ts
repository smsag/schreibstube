import type { Messages } from "../../i18n";

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
  | "paused";

/** Where the index stands, as the settings tab reports it. */
export interface SemanticStatus {
  state: SemanticState;
  count: number;
  done: number;
  total: number;
  error: string | null;
  outOfMemory: boolean;
  backend: string | null;
}

/** One sentence for the status line. Out of memory is said instead of the raw
 *  error, because the raw one ("RangeError: Array buffer allocation failed")
 *  does not say what to do about it. */
export function semanticStatusText(
  status: SemanticStatus,
  strings: Messages["semantic"]["state"]
): string {
  switch (status.state) {
    case "off":
      return strings.off;
    case "blocked":
      return strings.blocked;
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
      return status.outOfMemory ? strings.outOfMemory : strings.failed(status.error ?? "");
    case "paused":
      return strings.paused;
  }
}
