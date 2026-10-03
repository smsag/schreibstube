import { describe, expect, it } from "vitest";
import { LIVE_PREVIEW, READING_VIEW, switchedViewMode } from "./view-mode";

describe("switching between reading and editing", () => {
  it("goes from Live Preview to Reading view", () => {
    expect(switchedViewMode({ mode: "source", source: false, file: "a.md" })).toEqual(READING_VIEW);
  });

  it("goes from Reading view to Live Preview, whichever editor was last in use", () => {
    expect(switchedViewMode({ mode: "preview", source: false })).toEqual(LIVE_PREVIEW);
    expect(switchedViewMode({ mode: "preview", source: true })).toEqual(LIVE_PREVIEW);
  });

  it("goes from Source mode to Live Preview, not to Reading view", () => {
    expect(switchedViewMode({ mode: "source", source: true })).toEqual(LIVE_PREVIEW);
  });

  it("takes a state it cannot read to Live Preview, where the writer can still type", () => {
    for (const state of [null, undefined, "preview", {}, { mode: "source" }, { mode: 1 }]) {
      expect(switchedViewMode(state)).toEqual(LIVE_PREVIEW);
    }
  });
});
