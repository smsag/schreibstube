import { describe, expect, it } from "vitest";
import { resolveIconName } from "./ribbon-icon";

const AVAILABLE = ["folder", "folder-tree", "spell-check", "link"];

describe("resolveIconName", () => {
  it("keeps the preferred icon when Obsidian ships it", () => {
    expect(resolveIconName("folder-tree", AVAILABLE, "folder")).toBe("folder-tree");
  });

  it("steps down to the fallback when the preferred one is missing", () => {
    expect(resolveIconName("folder-tree", ["folder", "link"], "folder")).toBe("folder");
  });

  it("keeps the preferred icon when the fallback is missing too", () => {
    // Nothing better to offer, and a name Obsidian might still know beats one
    // it has already said it does not.
    expect(resolveIconName("folder-tree", ["link"], "folder")).toBe("folder-tree");
  });

  it("trusts the caller when the set cannot be read", () => {
    // An empty list is a question that went unanswered, not evidence against
    // the chosen name.
    expect(resolveIconName("folder-tree", [], "folder")).toBe("folder-tree");
  });

  it("is case-sensitive, as Obsidian's own ids are", () => {
    expect(resolveIconName("Folder-Tree", AVAILABLE, "folder")).toBe("folder");
  });
});
