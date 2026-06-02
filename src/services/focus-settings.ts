import type { FocusMode } from "../types";

export interface FocusSettings {
  focusMode: FocusMode;
  focusDimOpacity: number;
}

export const MIN_DIM_OPACITY = 0.2;
export const MAX_DIM_OPACITY = 0.8;

export const DEFAULT_SETTINGS: FocusSettings = {
  focusMode: "off",
  focusDimOpacity: 0.4
};

const ALLOWED_MODES = new Set<FocusMode>([
  "off",
  "sentence",
  "paragraph"
]);

export function normalizeFocusSettings(
  loaded: Partial<FocusSettings> | null | undefined
): FocusSettings {
  const merged = Object.assign({}, DEFAULT_SETTINGS, loaded);
  const focusMode = ALLOWED_MODES.has(merged.focusMode as FocusMode)
    ? (merged.focusMode as FocusMode)
    : DEFAULT_SETTINGS.focusMode;

  const candidateOpacity = Number(merged.focusDimOpacity);
  const safeOpacity = Number.isFinite(candidateOpacity)
    ? candidateOpacity
    : DEFAULT_SETTINGS.focusDimOpacity;

  return {
    focusMode,
    focusDimOpacity: Math.max(MIN_DIM_OPACITY, Math.min(MAX_DIM_OPACITY, safeOpacity))
  };
}
