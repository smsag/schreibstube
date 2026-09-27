import { describe, expect, it } from "vitest";
import { availableTarget, openTargetOf, treeRowTarget } from "./pane-target";

describe("openTargetOf", () => {
  it("takes Obsidian's reading of the modifiers as it is", () => {
    expect(openTargetOf(false)).toBe(false);
    expect(openTargetOf("tab")).toBe("tab");
    expect(openTargetOf("split")).toBe("split");
    expect(openTargetOf("window")).toBe("window");
  });

  it("reads anything else Obsidian may answer as a tab", () => {
    expect(openTargetOf(true)).toBe("tab");
    expect(openTargetOf("something-new")).toBe("tab");
  });
});

describe("treeRowTarget", () => {
  it("opens a plain press in place", () => {
    expect(treeRowTarget(false, false)).toBe(false);
  });

  it("leaves Cmd and Shift to the selection, as they were", () => {
    expect(treeRowTarget("tab", false)).toBeNull();
    expect(treeRowTarget(false, true)).toBeNull();
    expect(treeRowTarget("tab", true)).toBeNull();
  });

  it("opens the split and window chords, though the window chord carries Shift", () => {
    expect(treeRowTarget("split", false)).toBe("split");
    expect(treeRowTarget("window", true)).toBe("window");
  });
});

describe("availableTarget", () => {
  it("opens a window where there are windows, and a tab where there are none", () => {
    expect(availableTarget("window", true)).toBe("window");
    expect(availableTarget("window", false)).toBe("tab");
    expect(availableTarget("split", false)).toBe("split");
    expect(availableTarget(false, false)).toBe(false);
  });
});
