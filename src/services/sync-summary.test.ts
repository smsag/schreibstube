import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import { describePollSummary, type PollSummary } from "./sync-summary";

setLanguage("en");

function summary(overrides: Partial<PollSummary> = {}): PollSummary {
  return { checked: 0, withChanges: 0, failed: 0, notes: [], ...overrides };
}

describe("describePollSummary", () => {
  it("says why nothing ran before anything else", () => {
    expect(describePollSummary(summary({ skipped: "disabled" }), { scope: "vault" })).toContain(
      "off"
    );
    expect(
      describePollSummary(summary({ skipped: "busy", failed: 3 }), { scope: "note", name: "a" })
    ).toContain("already running");
  });

  it("counts a vault-wide check", () => {
    expect(
      describePollSummary(summary({ checked: 3, withChanges: 1, failed: 1 }), { scope: "vault" })
    ).toBe("3 checked, 1 with updates, 1 failed.");
    expect(describePollSummary(summary(), { scope: "vault" })).toContain("no bound notes");
  });

  it("does not call a folder empty when its one note failed", () => {
    expect(describePollSummary(summary({ failed: 1 }), { scope: "folder" })).toBe(
      "0 checked, 0 with updates, 1 failed."
    );
    expect(describePollSummary(summary(), { scope: "folder" })).toContain("in this folder");
  });

  it("names the reason a note failed", () => {
    expect(
      describePollSummary(summary({ failed: 1, reason: "HTTP 404" }), { scope: "note", name: "a" })
    ).toContain("HTTP 404");
    expect(describePollSummary(summary({ failed: 1 }), { scope: "note", name: "a" })).toContain(
      "cannot be fetched"
    );
  });

  it("tells a note with updates from one that is current", () => {
    expect(
      describePollSummary(summary({ checked: 1, withChanges: 1 }), { scope: "note", name: "a" })
    ).toContain("updates");
    expect(describePollSummary(summary({ checked: 1 }), { scope: "note", name: "Plan" })).toBe(
      "Plan is up to date with its source."
    );
    expect(describePollSummary(summary(), { scope: "note", name: "a" })).toContain("not bound");
  });
});
