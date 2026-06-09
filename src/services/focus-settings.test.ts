import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_DIM_OPACITY,
  MIN_DIM_OPACITY,
  normalizeFocusSettings
} from "./focus-settings";

describe("normalizeFocusSettings", () => {
  it("uses defaults when settings are missing", () => {
    expect(normalizeFocusSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to off mode when unknown mode is provided", () => {
    expect(normalizeFocusSettings({ focusMode: "invalid" as never })).toEqual({
      focusMode: "off",
      focusDimOpacity: DEFAULT_SETTINGS.focusDimOpacity
    });
  });

  it("falls back to off mode when legacy line mode is provided", () => {
    expect(normalizeFocusSettings({ focusMode: "line" as never })).toEqual({
      focusMode: "off",
      focusDimOpacity: DEFAULT_SETTINGS.focusDimOpacity
    });
  });

  it("clamps dim opacity below minimum", () => {
    expect(normalizeFocusSettings({ focusDimOpacity: 0.01 })).toEqual({
      focusMode: "off",
      focusDimOpacity: MIN_DIM_OPACITY
    });
  });

  it("clamps dim opacity above maximum", () => {
    expect(normalizeFocusSettings({ focusDimOpacity: 0.99 })).toEqual({
      focusMode: "off",
      focusDimOpacity: MAX_DIM_OPACITY
    });
  });

  it("keeps valid sentence mode values", () => {
    expect(
      normalizeFocusSettings({ focusMode: "sentence", focusDimOpacity: 0.55 })
    ).toEqual({
      focusMode: "sentence",
      focusDimOpacity: 0.55
    });
  });

  it("keeps valid paragraph mode values", () => {
    expect(
      normalizeFocusSettings({ focusMode: "paragraph", focusDimOpacity: 0.55 })
    ).toEqual({
      focusMode: "paragraph",
      focusDimOpacity: 0.55
    });
  });
});
