import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
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
      llmProvider: "openai" as const,
      llmModel: "gpt-4o",
    };
    expect(normalizeSettings(valid)).toEqual(valid);
  });

  it("defaults overlayEnabled to true when absent", () => {
    expect(normalizeSettings({}).overlayEnabled).toBe(true);
  });

  it("preserves an explicit overlayEnabled=false", () => {
    expect(normalizeSettings({ overlayEnabled: false }).overlayEnabled).toBe(false);
  });

  it("defaults llmModelCustom to an empty string", () => {
    expect(normalizeSettings({}).llmModelCustom).toBe("");
  });

  it("preserves a custom model override", () => {
    expect(normalizeSettings({ llmModelCustom: "gpt-5-mini" }).llmModelCustom).toBe("gpt-5-mini");
  });

  it("falls back to default provider for an unknown provider value", () => {
    expect(normalizeSettings({ llmProvider: "unknown" as never })).toMatchObject({
      llmProvider: DEFAULT_SETTINGS.llmProvider,
    });
  });

  it("resets model to first provider model when model belongs to a different provider", () => {
    expect(
      normalizeSettings({ llmProvider: "openai", llmModel: "claude-haiku-4-5-20251001" })
    ).toMatchObject({ llmProvider: "openai", llmModel: "gpt-4o-mini" });
  });

  it("resets model to first provider model when model is unrecognised", () => {
    expect(
      normalizeSettings({ llmProvider: "anthropic", llmModel: "made-up-model" })
    ).toMatchObject({ llmModel: "claude-haiku-4-5-20251001" });
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

  it("migrates legacy rename-scoped provider settings", () => {
    expect(
      normalizeSettings({
        renameProvider: "openai",
        renameModel: "gpt-4o",
        renameModelCustom: "gpt-5-mini",
        renameSecretName: "openai-key",
      })
    ).toMatchObject({
      llmProvider: "openai",
      llmModel: "gpt-4o",
      llmModelCustom: "gpt-5-mini",
      llmSecretName: "openai-key",
    });
  });

  it("prefers the shared llm settings over legacy rename keys", () => {
    expect(
      normalizeSettings({ llmProvider: "anthropic", renameProvider: "openai" }).llmProvider
    ).toBe("anthropic");
  });

  it("does not persist legacy rename-scoped keys", () => {
    const normalized = normalizeSettings({ renameSecretName: "key" });
    expect(normalized).not.toHaveProperty("renameSecretName");
  });

  it("preserves focus settings from loaded data", () => {
    expect(
      normalizeSettings({ focusMode: "sentence", focusDimOpacity: 0.6 })
    ).toMatchObject({ focusMode: "sentence", focusDimOpacity: 0.6 });
  });
});
