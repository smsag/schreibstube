import type { SchreibstubeSettings } from "../types";
import {
  DEFAULT_SETTINGS as DEFAULT_FOCUS_SETTINGS,
  normalizeFocusSettings
} from "./focus-settings";

export const MIN_OVERLAY_VISIBLE_ROWS = 3;
export const MAX_OVERLAY_VISIBLE_ROWS = 20;

export const DEFAULT_SETTINGS: SchreibstubeSettings = {
  overlayMaxVisibleRows: 6,
  ...DEFAULT_FOCUS_SETTINGS
};

export function normalizeSettings(
  loaded: Partial<SchreibstubeSettings> | null | undefined
): SchreibstubeSettings {
  const merged = Object.assign({}, DEFAULT_SETTINGS, loaded);
  const focus = normalizeFocusSettings(loaded);

  const candidateRows = Number(merged.overlayMaxVisibleRows);
  const overlayMaxVisibleRows = Number.isFinite(candidateRows)
    ? Math.max(
        MIN_OVERLAY_VISIBLE_ROWS,
        Math.min(MAX_OVERLAY_VISIBLE_ROWS, Math.floor(candidateRows))
      )
    : DEFAULT_SETTINGS.overlayMaxVisibleRows;

  return {
    overlayMaxVisibleRows,
    ...focus
  };
}
