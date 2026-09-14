import { describe, expect, it } from "vitest";
import {
  PANE_MEMORY_VERSION,
  readPaneMemory,
  stateFromMemory,
  writePaneMemory,
  type PaneStorage
} from "./explorer-memory";

function storage(stored: unknown = null): PaneStorage & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    loadLocalStorage: () => stored,
    saveLocalStorage: (_key: string, value: unknown) => {
      written.push(value);
    }
  };
}

describe("readPaneMemory", () => {
  it("returns what was stored when it is an object", () => {
    expect(readPaneMemory(storage({ collapsedSections: ["latest"] }))).toEqual({
      collapsedSections: ["latest"]
    });
  });

  it("returns null for nothing, for a scalar, and for storage that refuses", () => {
    expect(readPaneMemory(storage(null))).toBeNull();
    expect(readPaneMemory(storage("text"))).toBeNull();
    expect(
      readPaneMemory({
        loadLocalStorage: () => {
          throw new Error("refused");
        },
        saveLocalStorage: () => undefined
      })
    ).toBeNull();
  });

  it("copes with an app that has no storage at all", () => {
    expect(readPaneMemory({} as PaneStorage)).toBeNull();
  });
});

describe("stateFromMemory", () => {
  it("reads every list defensively", () => {
    const { state } = stateFromMemory({
      version: PANE_MEMORY_VERSION,
      collapsedSections: ["latest", 3, null] as unknown as string[],
      expandedFolders: "not a list" as unknown as string[]
    });
    expect([...state.collapsedSections]).toEqual(["latest"]);
    expect(state.collapsedBookmarks.size).toBe(0);
    expect(state.expandedFolders.size).toBe(0);
  });

  it("closes the pinned block once, on a device that never had the default", () => {
    const fresh = stateFromMemory(null);
    expect(fresh.defaultsApplied).toBe(true);
    expect(fresh.state.collapsedSections.has("pinned")).toBe(true);

    const older = stateFromMemory({ collapsedSections: [] });
    expect(older.defaultsApplied).toBe(true);
    expect(older.state.collapsedSections.has("pinned")).toBe(true);
  });

  it("leaves a current memory exactly as the person left it", () => {
    const current = stateFromMemory({ version: PANE_MEMORY_VERSION, collapsedSections: [] });
    expect(current.defaultsApplied).toBe(false);
    expect(current.state.collapsedSections.has("pinned")).toBe(false);
  });
});

describe("writePaneMemory", () => {
  it("writes the current version with every set as a list", () => {
    const target = storage();
    writePaneMemory(target, {
      collapsedSections: new Set(["files"]),
      collapsedBookmarks: new Set(["ab"]),
      expandedFolders: new Set(["notes", "notes/2026"])
    });
    expect(target.written).toEqual([
      {
        version: PANE_MEMORY_VERSION,
        collapsedSections: ["files"],
        collapsedBookmarks: ["ab"],
        expandedFolders: ["notes", "notes/2026"]
      }
    ]);
  });

  it("swallows a refusal and does nothing without storage", () => {
    expect(() =>
      writePaneMemory(
        {
          loadLocalStorage: () => null,
          saveLocalStorage: () => {
            throw new Error("refused");
          }
        },
        { collapsedSections: new Set(), collapsedBookmarks: new Set(), expandedFolders: new Set() }
      )
    ).not.toThrow();
    expect(() =>
      writePaneMemory({} as PaneStorage, {
        collapsedSections: new Set(),
        collapsedBookmarks: new Set(),
        expandedFolders: new Set()
      })
    ).not.toThrow();
  });
});
