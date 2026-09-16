import { describe, expect, it } from "vitest";
import { hashText, nextSyncRecord, type SyncRecord } from "./sync-document";
import {
  findMovedRecord,
  ORPHAN_RECORD_TTL_MS,
  reconcileSyncState,
  recordForSource,
  type NoteBinding
} from "./sync-reconcile";

const A = "https://example.com/a.md";
const B = "https://example.com/b.md";
const NOW = Date.UTC(2026, 8, 16, 12, 0);

function record(over: Partial<SyncRecord> = {}): SyncRecord {
  return { hash: hashText("Text.\n"), etag: "", checkedAt: NOW, source: A, ...over };
}

function bindings(map: Record<string, NoteBinding>): (path: string) => NoteBinding {
  return (path) => map[path] ?? { kind: "missing" };
}

describe("reconcileSyncState", () => {
  it("changes nothing while every record matches its note", () => {
    expect(
      reconcileSyncState({
        state: { "a.md": record() },
        bindingOf: bindings({ "a.md": { kind: "bound", source: A } }),
        now: NOW
      })
    ).toBeNull();
  });

  it("drops the record of a note unbound on another device", () => {
    expect(
      reconcileSyncState({
        state: { "a.md": record(), "b.md": record({ source: B }) },
        bindingOf: bindings({ "a.md": { kind: "unbound" }, "b.md": { kind: "bound", source: B } }),
        now: NOW
      })
    ).toEqual({ "b.md": record({ source: B }) });
  });

  it("drops a record made against a source the note no longer names", () => {
    expect(
      reconcileSyncState({
        state: { "a.md": record() },
        bindingOf: bindings({ "a.md": { kind: "bound", source: B } }),
        now: NOW
      })
    ).toEqual({});
  });

  it("keeps a record from before records named their source", () => {
    const { source: _source, ...legacy } = record();
    expect(
      reconcileSyncState({
        state: { "a.md": legacy },
        bindingOf: bindings({ "a.md": { kind: "bound", source: B } }),
        now: NOW
      })
    ).toBeNull();
  });

  it("says nothing about a note that has not been indexed", () => {
    expect(
      reconcileSyncState({
        state: { "a.md": record() },
        bindingOf: bindings({ "a.md": { kind: "unknown" } }),
        now: NOW
      })
    ).toBeNull();
  });

  it("keeps a record whose note is gone, for a while", () => {
    const state = { "gone.md": record({ checkedAt: NOW - ORPHAN_RECORD_TTL_MS }) };
    expect(reconcileSyncState({ state, bindingOf: bindings({}), now: NOW })).toBeNull();
    expect(reconcileSyncState({ state, bindingOf: bindings({}), now: NOW + 1 })).toEqual({});
  });

  it("judges only the records it is pointed at", () => {
    expect(
      reconcileSyncState({
        state: { "a.md": record(), "b.md": record() },
        bindingOf: bindings({ "a.md": { kind: "unbound" }, "b.md": { kind: "unbound" } }),
        paths: ["a.md"],
        now: NOW
      })
    ).toEqual({ "b.md": record() });
  });
});

describe("recordForSource", () => {
  it("hands back a record made against the same source", () => {
    expect(recordForSource(record(), A)).toEqual(record());
  });

  it("hands back nothing for a record made against another source", () => {
    expect(recordForSource(record(), B)).toBeUndefined();
  });
});

describe("findMovedRecord", () => {
  const body = "Text.\n";
  const exists = (path: string): boolean => path === "new.md";

  it("finds the record a moved note left at its old path", () => {
    expect(findMovedRecord({ state: { "old.md": record() }, source: A, body, exists })).toBe(
      "old.md"
    );
  });

  it("ignores a record whose note is still there", () => {
    expect(findMovedRecord({ state: { "new.md": record() }, source: A, body, exists })).toBeNull();
  });

  it("ignores a record for another source", () => {
    expect(
      findMovedRecord({ state: { "old.md": record({ source: B }) }, source: A, body, exists })
    ).toBeNull();
  });

  it("ignores a record made against other text, as a note written afresh", () => {
    expect(
      findMovedRecord({ state: { "old.md": record() }, source: A, body: "Neu.\n", exists })
    ).toBeNull();
  });

  it("takes nothing when more than one record fits", () => {
    expect(
      findMovedRecord({
        state: { "old.md": record(), "older.md": record() },
        source: A,
        body,
        exists
      })
    ).toBeNull();
  });
});

describe("the source on a record", () => {
  it("is written by a check and kept by one that does not name it", () => {
    const first = nextSyncRecord({
      record: undefined,
      body: "Text.\n",
      remoteBody: "Text.\n",
      etag: "e1",
      checkedAt: NOW,
      pendingChanges: 0,
      settled: true,
      source: A
    });
    expect(first.source).toBe(A);

    const second = nextSyncRecord({
      record: first,
      body: "Text.\n",
      remoteBody: null,
      etag: "e1",
      checkedAt: NOW + 1,
      pendingChanges: 0,
      settled: false
    });
    expect(second.source).toBe(A);
  });
});
