import type { HeadingLevel } from "../types";

export interface OverlayRowEvent {
  lineNumber: number;
  level: HeadingLevel;
  kind: "ancestor";
  source: "click";
}

export function reduceOverlayRowEvent(event: OverlayRowEvent): number {
  return event.lineNumber;
}
