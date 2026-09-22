import { describe, expect, it } from "vitest";
import { mergeSyncState, sameSyncState } from "./sync-merge";
import type { SyncRecord } from "./sync-document";

function record(checkedAt: number, hash = `h${checkedAt}`): SyncRecord {
  return { hash, remoteHash: hash, etag: "", checkedAt, pendingChanges: 0 };
}

describe("mergeSyncState", () => {
  it("keeps the other device's records for notes this one never checked", () => {
    const merged = mergeSyncState({
      local: { "A.md": record(1) },
      disk: { "B.md": record(2) }
    });

    expect(Object.keys(merged).sort()).toEqual(["A.md", "B.md"]);
  });

  it("takes the other device's record when its check was later", () => {
    // The laptop fetched and accepted the update; the phone's copy predates it.
    const laptop = record(20, "accepted");
    const merged = mergeSyncState({
      local: { "A.md": record(10, "stale") },
      disk: { "A.md": laptop }
    });

    expect(merged["A.md"]).toEqual(laptop);
  });

  it("keeps this device's record when its check was later", () => {
    const ours = record(30);
    const merged = mergeSyncState({
      local: { "A.md": ours },
      disk: { "A.md": record(20) }
    });

    expect(merged["A.md"]).toEqual(ours);
  });

  it("keeps this device's record on a tie", () => {
    const ours = record(20, "ours");
    const merged = mergeSyncState({
      local: { "A.md": ours },
      disk: { "A.md": record(20, "theirs") }
    });

    expect(merged["A.md"]).toEqual(ours);
  });

  it("does not bring back a record this device dropped", () => {
    const merged = mergeSyncState({
      local: {},
      disk: { "A.md": record(10) },
      dropped: new Map([["A.md", 15]])
    });

    expect(merged).toEqual({});
  });

  it("keeps a record checked elsewhere after this device dropped it", () => {
    // Bound again on the other device and checked there since: that is news.
    const theirs = record(20);
    const merged = mergeSyncState({
      local: {},
      disk: { "A.md": theirs },
      dropped: new Map([["A.md", 15]])
    });

    expect(merged["A.md"]).toEqual(theirs);
  });

  it("leaves both inputs as they were", () => {
    const local = { "A.md": record(1) };
    const disk = { "A.md": record(2), "B.md": record(3) };
    mergeSyncState({ local, disk });

    expect(Object.keys(local)).toEqual(["A.md"]);
    expect(local["A.md"]?.checkedAt).toBe(1);
  });
});

describe("sameSyncState", () => {
  it("is true for the same records", () => {
    expect(sameSyncState({ "A.md": record(1) }, { "A.md": record(1) })).toBe(true);
  });

  it("is false when a record differs, is missing, or is extra", () => {
    expect(sameSyncState({ "A.md": record(1) }, { "A.md": record(2) })).toBe(false);
    expect(sameSyncState({ "A.md": record(1) }, {})).toBe(false);
    expect(sameSyncState({ "A.md": record(1) }, { "B.md": record(1) })).toBe(false);
  });
});
