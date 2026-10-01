import { describe, expect, it } from "vitest";
import { BASE_PRESS_WINDOW_MS, opensForReading, type OpenedNote } from "./bases-reading";

/** A note that opened 200 ms after a press in a base, shown for editing. */
const opened = (over: Partial<OpenedNote> = {}): OpenedNote => ({
  enabled: true,
  pressedAt: 1000,
  now: 1200,
  extension: "md",
  mode: "source",
  ...over
});

describe("opensForReading", () => {
  it("switches a note that opened right after a press in a base", () => {
    expect(opensForReading(opened())).toBe(true);
  });

  it("leaves it alone while the setting is off", () => {
    expect(opensForReading(opened({ enabled: false }))).toBe(false);
  });

  it("leaves a note alone that opened after a press elsewhere", () => {
    expect(opensForReading(opened({ pressedAt: null }))).toBe(false);
  });

  it("counts an opening within the window, and none after it", () => {
    expect(opensForReading(opened({ now: 1000 + BASE_PRESS_WINDOW_MS }))).toBe(true);
    expect(opensForReading(opened({ now: 1001 + BASE_PRESS_WINDOW_MS }))).toBe(false);
  });

  it("does not trust a clock that went backwards", () => {
    expect(opensForReading(opened({ now: 900 }))).toBe(false);
  });

  it("switches only a Markdown note, and one not already in Reading view", () => {
    expect(opensForReading(opened({ extension: "png" }))).toBe(false);
    expect(opensForReading(opened({ extension: "MD" }))).toBe(true);
    expect(opensForReading(opened({ mode: "preview" }))).toBe(false);
    expect(opensForReading(opened({ mode: null }))).toBe(false);
  });
});
