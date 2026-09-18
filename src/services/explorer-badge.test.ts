import { describe, expect, it } from "vitest";
import { syncBadgeFor, syncBadgeIcon } from "./explorer-badge";

const record = { hash: "0", etag: "", checkedAt: 1 };

describe("syncBadgeFor", () => {
  it("shows nothing for a note without a binding", () => {
    expect(syncBadgeFor({ bound: false, sourceValid: false })).toBe("none");
  });

  it("marks a binding the plugin will not fetch as an error", () => {
    expect(syncBadgeFor({ bound: true, sourceValid: false, record })).toBe("error");
  });

  it("claims nothing before the first check", () => {
    expect(syncBadgeFor({ bound: true, sourceValid: true })).toBe("unchecked");
    expect(
      syncBadgeFor({ bound: true, sourceValid: true, record: { ...record, checkedAt: 0 } })
    ).toBe("unchecked");
  });

  it("tells changes waiting from a note in sync", () => {
    expect(syncBadgeFor({ bound: true, sourceValid: true, record })).toBe("synced");
    expect(
      syncBadgeFor({ bound: true, sourceValid: true, record: { ...record, pendingChanges: 2 } })
    ).toBe("pending");
  });
});

describe("syncBadgeIcon", () => {
  it("gives every badge but none a glyph", () => {
    for (const badge of ["synced", "pending", "unchecked", "error"] as const) {
      expect(syncBadgeIcon(badge)).not.toBe("");
    }
    expect(syncBadgeIcon("none")).toBe("");
  });
});
