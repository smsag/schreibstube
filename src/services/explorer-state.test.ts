import { describe, expect, it } from "vitest";
import {
  emptyExplorerData,
  entryFor,
  iconFor,
  isKept,
  isPinned,
  markMissing,
  mergeExplorerData,
  parseExplorerData,
  pruneExplorerData,
  reattachOrphans,
  reorderPinned,
  renamePath,
  serializeExplorerData,
  setIcon,
  setKept,
  setPinned,
  setTitle,
  titleOf,
  pinnedPaths,
  sortSiblings,
  type ExplorerData,
  type ExplorerNode
} from "./explorer-state";

const T0 = Date.UTC(2026, 8, 12, 8, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * 60_000;

function node(path: string, kind: "file" | "folder" = "file"): ExplorerNode {
  return { path, kind, name: path.split("/").pop() ?? path };
}

describe("parseExplorerData", () => {
  it("accepts a file it wrote itself", () => {
    const written = setIcon(emptyExplorerData(), "Objekte/Haus.md", "home", T0);
    const parsed = parseExplorerData(JSON.parse(serializeExplorerData(written)));

    expect(iconFor(parsed, "Objekte/Haus.md")).toBe("home");
  });

  it("drops entries that are not entries, and keeps the rest", () => {
    const parsed = parseExplorerData({
      entries: {
        "a.md": { icon: "star", updatedAt: T0 },
        "b.md": "not an object",
        "c.md": { icon: 42, pinnedAt: "soon", updatedAt: T0 },
        "": { icon: "star", updatedAt: T0 }
      }
    });

    expect(Object.keys(parsed.entries)).toEqual(["a.md", "c.md"]);
    expect(parsed.entries["c.md"]).toEqual({ updatedAt: T0 });
  });

  it("treats anything that is not a state file as empty", () => {
    expect(parseExplorerData(null).entries).toEqual({});
    expect(parseExplorerData([]).entries).toEqual({});
    expect(parseExplorerData({ entries: [] }).entries).toEqual({});
  });

  it("writes keys in a stable order, so two devices produce the same bytes", () => {
    const one = setIcon(setIcon(emptyExplorerData(), "b.md", "star", T0), "a.md", "home", T0);
    const other = setIcon(setIcon(emptyExplorerData(), "a.md", "home", T0), "b.md", "star", T0);

    expect(serializeExplorerData(one)).toBe(serializeExplorerData(other));
  });
});

describe("setting an icon and a pin", () => {
  it("records and clears an icon without touching the pin", () => {
    let data = setPinned(setIcon(emptyExplorerData(), "a.md", "home", T0), "a.md", true, T0);
    data = setIcon(data, "a.md", null, T0 + MINUTE);

    expect(iconFor(data, "a.md")).toBeUndefined();
    expect(isPinned(data, "a.md")).toBe(true);
  });

  it("keeps a cleared entry, so an older value elsewhere cannot come back", () => {
    const data = setIcon(
      setIcon(emptyExplorerData(), "a.md", "home", T0),
      "a.md",
      null,
      T0 + MINUTE
    );

    expect(data.entries["a.md"]).toEqual({ updatedAt: T0 + MINUTE });
  });

  it("leaves an already pinned item where it is in the pinned block", () => {
    const first = setPinned(emptyExplorerData(), "a.md", true, T0);
    const again = setPinned(first, "a.md", true, T0 + MINUTE);

    expect(again.entries["a.md"].pinnedAt).toBe(T0);
  });

  it("revives a tombstone when the user changes the same path again", () => {
    const gone = markMissing(setIcon(emptyExplorerData(), "a.md", "home", T0), "a.md", T0 + MINUTE);
    const back = setIcon(gone, "a.md", "star", T0 + 2 * MINUTE);

    expect(entryFor(back, "a.md")).toEqual({ icon: "star", updatedAt: T0 + 2 * MINUTE });
  });
});

describe("renamePath", () => {
  it("moves the folder and everything under it", () => {
    let data = setIcon(emptyExplorerData(), "Alt", "folder", T0);
    data = setIcon(data, "Alt/Haus.md", "home", T0);
    data = setIcon(data, "Alternativ.md", "star", T0);

    const moved = renamePath(data, "Alt", "Neu", T0 + MINUTE);

    expect(iconFor(moved, "Neu")).toBe("folder");
    expect(iconFor(moved, "Neu/Haus.md")).toBe("home");
    expect(iconFor(moved, "Alternativ.md")).toBe("star");
    expect(moved.entries["Alt"]).toBeUndefined();
  });

  it("is a no-op when nothing moved", () => {
    const data = setIcon(emptyExplorerData(), "a.md", "home", T0);
    expect(renamePath(data, "a.md", "a.md", T0 + MINUTE)).toBe(data);
  });
});

describe("a file that disappears", () => {
  it("becomes a tombstone rather than a deletion", () => {
    const data = markMissing(setIcon(emptyExplorerData(), "a.md", "home", T0), "a.md", T0 + MINUTE);

    expect(entryFor(data, "a.md")).toBeUndefined();
    expect(data.entries["a.md"]).toMatchObject({
      icon: "home",
      orphanedAt: T0 + MINUTE,
      name: "a.md"
    });
  });

  it("tombstones a folder's children too", () => {
    const data = markMissing(
      setIcon(emptyExplorerData(), "Alt/Haus.md", "home", T0),
      "Alt",
      T0 + MINUTE
    );

    expect(data.entries["Alt/Haus.md"].orphanedAt).toBe(T0 + MINUTE);
  });

  it("keeps the first tombstone time when it is reported twice", () => {
    let data = markMissing(setIcon(emptyExplorerData(), "a.md", "home", T0), "a.md", T0 + MINUTE);
    data = markMissing(data, "a.md", T0 + 2 * MINUTE);

    expect(data.entries["a.md"].orphanedAt).toBe(T0 + MINUTE);
  });

  it("does not rewrite the map when there was nothing to forget", () => {
    const data = setIcon(emptyExplorerData(), "a.md", "home", T0);
    expect(markMissing(data, "other.md", T0 + MINUTE)).toBe(data);
  });

  it("hands the icon to the same file found somewhere else", () => {
    const gone = markMissing(
      setIcon(emptyExplorerData(), "Alt/Haus.md", "home", T0),
      "Alt/Haus.md",
      T0
    );
    const back = reattachOrphans(gone, ["Neu/Haus.md", "Neu/Andere.md"], T0 + MINUTE);

    expect(iconFor(back, "Neu/Haus.md")).toBe("home");
    expect(back.entries["Alt/Haus.md"]).toBeUndefined();
  });

  it("leaves an ambiguous match alone rather than guessing", () => {
    const gone = markMissing(
      setIcon(emptyExplorerData(), "Alt/Haus.md", "home", T0),
      "Alt/Haus.md",
      T0
    );
    const still = reattachOrphans(gone, ["Eins/Haus.md", "Zwei/Haus.md"], T0 + MINUTE);

    expect(still.entries["Alt/Haus.md"].orphanedAt).toBe(T0);
  });

  it("leaves two tombstones with one candidate alone", () => {
    let data = setIcon(emptyExplorerData(), "A/Haus.md", "home", T0);
    data = setIcon(data, "B/Haus.md", "star", T0);
    data = markMissing(markMissing(data, "A/Haus.md", T0), "B/Haus.md", T0);

    const after = reattachOrphans(data, ["C/Haus.md"], T0 + MINUTE);

    expect(iconFor(after, "C/Haus.md")).toBeUndefined();
  });

  it("does no work when there is nothing to match", () => {
    const data = setIcon(emptyExplorerData(), "a.md", "home", T0);
    expect(reattachOrphans(data, ["a.md"], T0)).toBe(data);

    const gone = markMissing(data, "a.md", T0);
    expect(reattachOrphans(gone, ["other.md"], T0)).toBe(gone);
  });

  it("revives a file that was written again at the same path", () => {
    const gone = markMissing(setIcon(emptyExplorerData(), "a.md", "home", T0), "a.md", T0);
    const back = reattachOrphans(gone, ["a.md"], T0 + MINUTE);

    expect(iconFor(back, "a.md")).toBe("home");
  });
});

describe("pruneExplorerData", () => {
  it("drops a tombstone once the grace period is over", () => {
    const gone = markMissing(setIcon(emptyExplorerData(), "a.md", "home", T0), "a.md", T0);

    expect(pruneExplorerData(gone, T0 + 29 * DAY).entries["a.md"]).toBeDefined();
    expect(pruneExplorerData(gone, T0 + 31 * DAY).entries["a.md"]).toBeUndefined();
  });

  it("drops an old cleared entry but keeps one with an icon", () => {
    let data = setIcon(
      setIcon(emptyExplorerData(), "cleared.md", "home", T0),
      "cleared.md",
      null,
      T0
    );
    data = setIcon(data, "kept.md", "star", T0);

    const pruned = pruneExplorerData(data, T0 + 31 * DAY);

    expect(pruned.entries["cleared.md"]).toBeUndefined();
    expect(pruned.entries["kept.md"]).toBeDefined();
  });

  it("returns the same object when nothing expired", () => {
    const data = setIcon(emptyExplorerData(), "a.md", "home", T0);
    expect(pruneExplorerData(data, T0 + DAY)).toBe(data);
  });
});

describe("mergeExplorerData", () => {
  it("takes the newer change per entry, from either side", () => {
    const mine: ExplorerData = setIcon(
      setIcon(emptyExplorerData(), "a.md", "home", T0 + MINUTE),
      "b.md",
      "star",
      T0
    );
    const theirs: ExplorerData = setIcon(
      setIcon(emptyExplorerData(), "a.md", "flag", T0),
      "b.md",
      "bulb",
      T0 + MINUTE
    );

    const merged = mergeExplorerData(mine, theirs);

    expect(iconFor(merged, "a.md")).toBe("home");
    expect(iconFor(merged, "b.md")).toBe("bulb");
  });

  it("keeps an entry only one side has ever seen", () => {
    const merged = mergeExplorerData(
      setIcon(emptyExplorerData(), "mine.md", "home", T0),
      setIcon(emptyExplorerData(), "theirs.md", "star", T0)
    );

    expect(Object.keys(merged.entries).sort()).toEqual(["mine.md", "theirs.md"]);
  });

  it("lets a removal beat an older value from the other device", () => {
    const cleared = setIcon(
      setIcon(emptyExplorerData(), "a.md", "home", T0),
      "a.md",
      null,
      T0 + MINUTE
    );
    const stale = setIcon(emptyExplorerData(), "a.md", "home", T0);

    expect(iconFor(mergeExplorerData(cleared, stale), "a.md")).toBeUndefined();
    expect(iconFor(mergeExplorerData(stale, cleared), "a.md")).toBeUndefined();
  });
});

describe("pinnedPaths", () => {
  it("lists what is pinned, in the order it was pinned", () => {
    let data = setPinned(emptyExplorerData(), "Zebra.md", true, T0 + MINUTE);
    data = setPinned(data, "Objekte/Haus.md", true, T0);
    data = setIcon(data, "Nicht angeheftet.md", "star", T0);

    expect(pinnedPaths(data)).toEqual(["Objekte/Haus.md", "Zebra.md"]);
  });

  it("leaves out what was unpinned and what went missing", () => {
    let data = setPinned(emptyExplorerData(), "a.md", true, T0);
    data = setPinned(data, "b.md", true, T0);
    data = setPinned(data, "a.md", false, T0 + MINUTE);
    data = markMissing(data, "b.md", T0 + MINUTE);

    expect(pinnedPaths(data)).toEqual([]);
  });

  it("finds nothing in an empty vault", () => {
    expect(pinnedPaths(emptyExplorerData())).toEqual([]);
  });
});

describe("sortSiblings", () => {
  it("puts items kept at the top first, in the order they were kept", () => {
    let data = setKept(emptyExplorerData(), "Zebra.md", true, T0);
    data = setKept(data, "Anfang.md", true, T0 + MINUTE);

    const sorted = sortSiblings([node("Anfang.md"), node("Mitte.md"), node("Zebra.md")], data);

    expect(sorted.map((entry) => entry.path)).toEqual(["Zebra.md", "Anfang.md", "Mitte.md"]);
  });

  it("holds a folder above the others, then sorts folders before files", () => {
    const data = setKept(emptyExplorerData(), "Notizen", true, T0);

    const sorted = sortSiblings(
      [node("Anhang.md"), node("Archiv", "folder"), node("Notizen", "folder")],
      data
    );

    expect(sorted.map((entry) => entry.path)).toEqual(["Notizen", "Archiv", "Anhang.md"]);
  });

  it("sorts numbers the way a person reads them", () => {
    const sorted = sortSiblings(
      [node("Objekt 10.md"), node("Objekt 2.md"), node("objekt 1.md")],
      emptyExplorerData()
    );

    expect(sorted.map((entry) => entry.path)).toEqual([
      "objekt 1.md",
      "Objekt 2.md",
      "Objekt 10.md"
    ]);
  });

  it("falls back to the name when two items were kept in the same millisecond", () => {
    let data = setKept(emptyExplorerData(), "b.md", true, T0);
    data = setKept(data, "a.md", true, T0);

    const sorted = sortSiblings([node("b.md"), node("a.md")], data);

    expect(sorted.map((entry) => entry.path)).toEqual(["a.md", "b.md"]);
  });

  it("ignores a mark on a tombstone", () => {
    const data = markMissing(setKept(emptyExplorerData(), "a.md", true, T0), "a.md", T0);

    const sorted = sortSiblings([node("a.md"), node("Ordner", "folder")], data);

    expect(sorted.map((entry) => entry.path)).toEqual(["Ordner", "a.md"]);
  });

  it("leaves the folder's order alone for something that is only pinned", () => {
    // The pinned block above the tree is a different question from where a row
    // sits inside its folder, and answering one must not answer the other.
    const data = setPinned(emptyExplorerData(), "Zebra.md", true, T0);

    const sorted = sortSiblings([node("Anfang.md"), node("Zebra.md")], data);

    expect(sorted.map((entry) => entry.path)).toEqual(["Anfang.md", "Zebra.md"]);
  });
});

describe("keeping an item at the top of its folder", () => {
  it("is independent of the pin, in both directions", () => {
    let data = setKept(emptyExplorerData(), "a.md", true, T0);
    expect(isKept(data, "a.md")).toBe(true);
    expect(isPinned(data, "a.md")).toBe(false);

    data = setPinned(data, "a.md", true, T0 + MINUTE);
    data = setKept(data, "a.md", false, T0 + 2 * MINUTE);

    expect(isKept(data, "a.md")).toBe(false);
    expect(isPinned(data, "a.md")).toBe(true);
  });

  it("leaves an item where it is when it is kept again", () => {
    const first = setKept(emptyExplorerData(), "a.md", true, T0);
    const again = setKept(first, "a.md", true, T0 + MINUTE);

    expect(again.entries["a.md"].keptAt).toBe(T0);
  });

  it("survives the prune that clears an entry holding nothing", () => {
    const data = setKept(emptyExplorerData(), "a.md", true, T0);

    expect(pruneExplorerData(data, T0 + 31 * DAY).entries["a.md"]).toBeDefined();
  });
});

describe("naming a file in the pane", () => {
  it("records a name and hands it back", () => {
    const data = setTitle(emptyExplorerData(), "Anhang/scan_0042.pdf", "Exposé Musterstraße 4", T0);

    expect(titleOf(data, "Anhang/scan_0042.pdf")).toBe("Exposé Musterstraße 4");
  });

  it("trims it and folds it onto one line, because a row is one line high", () => {
    const data = setTitle(emptyExplorerData(), "a.pdf", "  Grundriss\n  Erdgeschoss ", T0);

    expect(titleOf(data, "a.pdf")).toBe("Grundriss Erdgeschoss");
  });

  it("hands the row back to the filename when the name is cleared or blank", () => {
    const named = setTitle(emptyExplorerData(), "a.pdf", "Exposé", T0);

    expect(titleOf(setTitle(named, "a.pdf", null, T0 + MINUTE), "a.pdf")).toBeUndefined();
    expect(titleOf(setTitle(named, "a.pdf", "   ", T0 + MINUTE), "a.pdf")).toBeUndefined();
  });

  it("keeps the entry after a clear, so an older name elsewhere cannot come back", () => {
    const cleared = setTitle(
      setTitle(emptyExplorerData(), "a.pdf", "Exposé", T0),
      "a.pdf",
      null,
      T0 + MINUTE
    );

    expect(cleared.entries["a.pdf"]).toEqual({ updatedAt: T0 + MINUTE });
  });

  it("moves with the file, and survives the prune that clears an empty entry", () => {
    const data = setTitle(emptyExplorerData(), "Anhang/a.pdf", "Exposé", T0);
    const moved = renamePath(data, "Anhang/a.pdf", "Objekte/a.pdf", T0 + MINUTE);

    expect(titleOf(moved, "Objekte/a.pdf")).toBe("Exposé");
    expect(pruneExplorerData(moved, T0 + 31 * DAY).entries["Objekte/a.pdf"]).toBeDefined();
  });

  it("is independent of the icon and both marks", () => {
    let data = setTitle(emptyExplorerData(), "a.pdf", "Exposé", T0);
    data = setIcon(data, "a.pdf", "home", T0);
    data = setTitle(data, "a.pdf", null, T0 + MINUTE);

    expect(iconFor(data, "a.pdf")).toBe("home");
    expect(titleOf(data, "a.pdf")).toBeUndefined();
  });
});

describe("reading a file written before the two marks were separated", () => {
  it("hands a version 1 pin the top of its folder as well, which is what it did", () => {
    const data = parseExplorerData({
      version: 1,
      entries: { "a.md": { pinnedAt: T0, updatedAt: T0 } }
    });

    expect(isKept(data, "a.md")).toBe(true);
    expect(isPinned(data, "a.md")).toBe(true);
  });

  it("leaves a version 2 pin alone, so removing the top stays removed", () => {
    const data = parseExplorerData({
      version: 2,
      entries: { "a.md": { pinnedAt: T0, updatedAt: T0 } }
    });

    expect(isKept(data, "a.md")).toBe(false);
    expect(isPinned(data, "a.md")).toBe(true);
  });
});

describe("reorderPinned", () => {
  const pinnedData = (...paths: string[]): ExplorerData => ({
    version: 1,
    entries: Object.fromEntries(
      paths.map((path, index) => [path, { pinnedAt: 100 + index, updatedAt: 100 + index }])
    )
  });

  it("puts the pinned block in the order given", () => {
    const data = pinnedData("a.md", "b.md", "c.md");

    const next = reorderPinned(data, ["c.md", "a.md", "b.md"], 500);

    expect(pinnedPaths(next)).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("stamps every moved entry so a merge prefers this order", () => {
    const data = pinnedData("a.md", "b.md");

    const next = reorderPinned(data, ["b.md", "a.md"], 500);

    expect(next.entries["a.md"].updatedAt).toBe(500);
    expect(next.entries["b.md"].updatedAt).toBe(500);
  });

  it("keeps a pin the caller did not mention, after the ones it did", () => {
    const data = pinnedData("a.md", "b.md", "c.md");

    const next = reorderPinned(data, ["c.md", "a.md"], 500);

    expect(pinnedPaths(next)).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("ignores a path that is not pinned rather than pinning it", () => {
    const data = pinnedData("a.md");

    const next = reorderPinned(data, ["b.md", "a.md"], 500);

    expect(pinnedPaths(next)).toEqual(["a.md"]);
    expect(next.entries["b.md"]).toBeUndefined();
  });

  it("leaves the data alone when nothing given is pinned", () => {
    const data = pinnedData("a.md");

    expect(reorderPinned(data, ["x.md"], 500)).toBe(data);
  });

  it("does not disturb an icon already on a reordered entry", () => {
    const data = pinnedData("a.md", "b.md");
    data.entries["a.md"] = { ...data.entries["a.md"], icon: "key" };

    const next = reorderPinned(data, ["b.md", "a.md"], 500);

    expect(next.entries["a.md"].icon).toBe("key");
  });
});
