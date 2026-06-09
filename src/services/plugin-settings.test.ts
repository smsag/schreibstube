import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_OVERLAY_VISIBLE_ROWS,
  MIN_OVERLAY_VISIBLE_ROWS,
  normalizeSettings
} from "./plugin-settings";

describe("normalizeSettings", () => {
  it("returns defaults when called with undefined", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults when called with null", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves a fully valid settings object", () => {
    const valid = {
      ...DEFAULT_SETTINGS,
      renameProvider: "openai" as const,
      renameModel: "gpt-4o",
    };
    expect(normalizeSettings(valid)).toEqual(valid);
  });

  it("clamps overlay rows to minimum", () => {
    expect(normalizeSettings({ overlayMaxVisibleRows: 0 })).toMatchObject({
      overlayMaxVisibleRows: MIN_OVERLAY_VISIBLE_ROWS,
    });
  });

  it("clamps overlay rows to maximum", () => {
    expect(normalizeSettings({ overlayMaxVisibleRows: 999 })).toMatchObject({
      overlayMaxVisibleRows: MAX_OVERLAY_VISIBLE_ROWS,
    });
  });

  it("falls back to default provider for an unknown provider value", () => {
    expect(normalizeSettings({ renameProvider: "unknown" as never })).toMatchObject({
      renameProvider: DEFAULT_SETTINGS.renameProvider,
    });
  });

  it("resets model to first provider model when model belongs to a different provider", () => {
    expect(
      normalizeSettings({ renameProvider: "openai", renameModel: "claude-haiku-4-5-20251001" })
    ).toMatchObject({ renameProvider: "openai", renameModel: "gpt-4o-mini" });
  });

  it("resets model to first provider model when model is unrecognised", () => {
    expect(
      normalizeSettings({ renameProvider: "anthropic", renameModel: "made-up-model" })
    ).toMatchObject({ renameModel: "claude-haiku-4-5-20251001" });
  });

  it("falls back for non-positive renameMinContentChars", () => {
    expect(normalizeSettings({ renameMinContentChars: 0 })).toMatchObject({
      renameMinContentChars: DEFAULT_SETTINGS.renameMinContentChars,
    });
  });

  it("falls back for non-positive renameMaxContentChars", () => {
    expect(normalizeSettings({ renameMaxContentChars: -1 })).toMatchObject({
      renameMaxContentChars: DEFAULT_SETTINGS.renameMaxContentChars,
    });
  });

  it("falls back for non-positive renameMaxFilenameLength", () => {
    expect(normalizeSettings({ renameMaxFilenameLength: 0 })).toMatchObject({
      renameMaxFilenameLength: DEFAULT_SETTINGS.renameMaxFilenameLength,
    });
  });

  it("preserves focus settings from loaded data", () => {
    expect(
      normalizeSettings({ focusMode: "sentence", focusDimOpacity: 0.6 })
    ).toMatchObject({ focusMode: "sentence", focusDimOpacity: 0.6 });
  });
});
