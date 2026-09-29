import { describe, expect, it } from "vitest";
import { en } from "../../i18n/en";
import { enExtra } from "../../i18n/en-extra";
import { failureCause, semanticStatusText, type SemanticStatus } from "./status-text";

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
      semanticStatusText(
        { ...base, state: "failed", error: "network down", cause: "other" },
        strings
      )
    ).toContain("network down");
  });

  it("says being offline and a timeout in the person's language, not the runtime's", () => {
    const offline = new Error(
      "The Multilingual model has not been downloaded yet and you appear to be offline. " +
        "Connect to the internet to finish setting up."
    );
    expect(failureCause(offline)).toBe("offline");
    expect(failureCause(new Error("Embedding request 7 timed out"))).toBe("timeout");
    expect(failureCause(new Error("Embedding worker load timed out"))).toBe("timeout");
    expect(failureCause("The build was stopped")).toBe("other");

    const failed = (error: Error): string =>
      semanticStatusText(
        { ...base, state: "failed", error: error.message, cause: failureCause(error) },
        strings
      );
    expect(failed(offline)).toBe(strings.offline);
    expect(failed(new Error("Embedding request 7 timed out"))).toBe(strings.timedOut);
    expect(failed(offline)).not.toContain("appear");
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

describe("a phone holding the desktop's index", () => {
  it("says the desktop builds it, and what Build now adds", () => {
    const text = semanticStatusText(
      { ...base, state: "desktopBuilds", count: 12, budget: 50 },
      strings
    );
    expect(text).toContain("12 notes ready");
    expect(text).toContain("50");
  });
});
