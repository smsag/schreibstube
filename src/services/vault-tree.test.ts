import { describe, expect, it } from "vitest";
import { folderPathsUnder, treeAction, type VaultNode } from "./vault-tree";

function file(path: string): VaultNode {
  return { path };
}

function folder(path: string, ...children: VaultNode[]): VaultNode {
  return { path, children };
}

describe("folderPathsUnder", () => {
  it("names every folder underneath, however deep", () => {
    const vault = folder(
      "",
      folder("Objekte", folder("Objekte/2026", file("Objekte/2026/a.md"))),
      file("b.md")
    );

    expect(folderPathsUnder(vault)).toEqual(["Objekte", "Objekte/2026"]);
  });

  it("leaves out the folder it was asked about", () => {
    // Nothing in the pane opens or closes the vault itself, so the root is not
    // one of the folders a control over the tree acts on.
    expect(folderPathsUnder(folder("Objekte", file("a.md")))).toEqual([]);
  });

  it("counts an empty folder, which is still a folder", () => {
    expect(folderPathsUnder(folder("", folder("Leer")))).toEqual(["Leer"]);
  });

  it("says nothing about a vault with no files", () => {
    expect(folderPathsUnder({ path: "" })).toEqual([]);
  });
});

describe("treeAction", () => {
  it("offers to close while a single folder is open", () => {
    expect(treeAction(["a", "b"], (path) => path === "b")).toBe("collapse");
  });

  it("offers to open only once everything is shut", () => {
    expect(treeAction(["a", "b"], () => false)).toBe("expand");
  });

  it("offers to open an empty vault, rather than nothing at all", () => {
    expect(treeAction([], () => false)).toBe("expand");
  });
});
