import { describe, expect, it } from "vitest";
import { en } from "../../i18n/en";
import { enExtra } from "../../i18n/en-extra";
import { semanticStatusText, type SemanticStatus } from "./status-text";

const strings = { ...en, ...enExtra }.semantic.state;
const base: SemanticStatus = {
  state: "notBuilt",
  count: 0,
  done: 0,
  total: 0,
  error: null,
  outOfMemory: false,
  backend: null
};

describe("semanticStatusText", () => {
  it("counts what is ready", () => {
    expect(semanticStatusText({ ...base, state: "ready", count: 1 }, strings)).toBe(
      "Ready: 1 note."
    );
    expect(semanticStatusText({ ...base, state: "ready", count: 4200 }, strings)).toContain("4200");
  });

  it("shows the progress of a build", () => {
    expect(
      semanticStatusText({ ...base, state: "building", done: 3, total: 9 }, strings)
    ).toContain("3 of 9");
  });

  it("says what to do about running out of memory instead of the raw error", () => {
    const text = semanticStatusText(
      { ...base, state: "failed", error: "RangeError: allocation failed", outOfMemory: true },
      strings
    );
    expect(text).toBe(strings.outOfMemory);
  });

  it("passes any other failure through", () => {
    expect(
      semanticStatusText({ ...base, state: "failed", error: "network down" }, strings)
    ).toContain("network down");
  });

  it("has a sentence for every state", () => {
    const states: SemanticStatus["state"][] = [
      "off",
      "blocked",
      "notBuilt",
      "loading",
      "building",
      "ready",
      "partial",
      "outdated",
      "failed",
      "paused"
    ];
    for (const state of states) {
      expect(semanticStatusText({ ...base, state }, strings).length).toBeGreaterThan(0);
    }
  });
});
