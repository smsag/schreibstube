import type { HeadingLevel } from "../types";

export interface OverlayRowEvent {
  lineNumber: number;
  level: HeadingLevel;
  kind: "ancestor";
  source: "click";
}

export interface OverlayInteractionState {
  // Stack-only mode keeps no persistent expansion state.
}

export interface OverlayInteractionResult {
  navigateToLine: number | null;
  shouldRender: boolean;
}

export function reduceOverlayRowEvent(
  _state: OverlayInteractionState,
  event: OverlayRowEvent,
  _isTouchDevice: boolean
): OverlayInteractionResult {
  return {
    navigateToLine: event.lineNumber,
    shouldRender: false
  };
}

export function reduceOutsideTapCollapse(
  _state: OverlayInteractionState,
  _isTouchDevice: boolean,
  _tapInsideOverlay: boolean
): OverlayInteractionResult {
  return {
    navigateToLine: null,
    shouldRender: false
  };
}

export function reduceMouseLeaveCollapse(
  _state: OverlayInteractionState,
  _isTouchDevice: boolean
): OverlayInteractionResult {
  return {
    navigateToLine: null,
    shouldRender: false
  };
}
