import type { HeadingLevel } from "../types";

export interface OverlayRowEvent {
  lineNumber: number;
  level: HeadingLevel;
  kind: "ancestor" | "sibling";
  source: "click" | "hover";
}

export interface OverlayInteractionState {
  expandedLevel: HeadingLevel | null;
}

export interface OverlayInteractionResult {
  nextExpandedLevel: HeadingLevel | null;
  navigateToLine: number | null;
  shouldRender: boolean;
}

export function reduceOverlayRowEvent(
  state: OverlayInteractionState,
  event: OverlayRowEvent,
  isTouchDevice: boolean
): OverlayInteractionResult {
  if (event.source === "hover") {
    if (isTouchDevice || event.kind !== "ancestor") {
      return {
        nextExpandedLevel: state.expandedLevel,
        navigateToLine: null,
        shouldRender: false
      };
    }

    return {
      nextExpandedLevel: event.level,
      navigateToLine: null,
      shouldRender: true
    };
  }

  if (event.kind === "ancestor") {
    if (isTouchDevice && state.expandedLevel !== event.level) {
      return {
        nextExpandedLevel: event.level,
        navigateToLine: null,
        shouldRender: true
      };
    }

    return {
      nextExpandedLevel: null,
      navigateToLine: event.lineNumber,
      shouldRender: false
    };
  }

  return {
    nextExpandedLevel: null,
    navigateToLine: event.lineNumber,
    shouldRender: false
  };
}

export function reduceOutsideTapCollapse(
  state: OverlayInteractionState,
  isTouchDevice: boolean,
  tapInsideOverlay: boolean
): OverlayInteractionResult {
  if (!isTouchDevice || tapInsideOverlay || state.expandedLevel === null) {
    return {
      nextExpandedLevel: state.expandedLevel,
      navigateToLine: null,
      shouldRender: false
    };
  }

  return {
    nextExpandedLevel: null,
    navigateToLine: null,
    shouldRender: true
  };
}

export function reduceMouseLeaveCollapse(
  state: OverlayInteractionState,
  isTouchDevice: boolean
): OverlayInteractionResult {
  if (isTouchDevice || state.expandedLevel === null) {
    return {
      nextExpandedLevel: state.expandedLevel,
      navigateToLine: null,
      shouldRender: false
    };
  }

  return {
    nextExpandedLevel: null,
    navigateToLine: null,
    shouldRender: true
  };
}
