import { describe, expect, it } from "vitest";
import { arrivedReceipt, isTrashedEntry, LOCAL_TRASH, localTrashPath } from "./trash-receipt";

describe("localTrashPath", () => {
  it("puts the file's name straight under the trash folder", () => {
    expect(localTrashPath("Entwurf.md")).toBe(`${LOCAL_TRASH}/Entwurf.md`);
  });
});

describe("arrivedReceipt", () => {
  it("names the entry that arrived", () => {
    expect(arrivedReceipt("a.md", [".trash/x.md"], [".trash/x.md", ".trash/a.md"])).toBe(
      ".trash/a.md"
    );
  });

  it("believes the arrival carrying the file's own name before any other", () => {
    const after = [".trash/Fremd.md", ".trash/a.md"];
    expect(arrivedReceipt("a.md", [], after)).toBe(".trash/a.md");
  });

  it("takes the one arrival there is when the trash renamed the file", () => {
    expect(arrivedReceipt("a.md", [".trash/a.md"], [".trash/a.md", ".trash/a 1.md"])).toBe(
      ".trash/a 1.md"
    );
  });

  it("has no receipt when nothing arrived", () => {
    expect(arrivedReceipt("a.md", [".trash/a.md"], [".trash/a.md"])).toBeNull();
  });
});

describe("isTrashedEntry", () => {
  const file = { type: "file", size: 120, mtime: 5 } as const;

  it("takes a file with the same size and modification time for the file", () => {
    expect(isTrashedEntry(file, { type: "file", size: 120, mtime: 5 })).toBe(true);
  });

  it("refuses a namesake that differs in size or modification time", () => {
    expect(isTrashedEntry(file, { type: "file", size: 121, mtime: 5 })).toBe(false);
    expect(isTrashedEntry(file, { type: "file", size: 120, mtime: 6 })).toBe(false);
  });

  it("refuses an entry of the other kind, and nothing at all", () => {
    expect(isTrashedEntry(file, { type: "folder", size: 0, mtime: 0 })).toBe(false);
    expect(isTrashedEntry({ type: "folder" }, { type: "file", size: 0, mtime: 0 })).toBe(false);
    expect(isTrashedEntry(file, null)).toBe(false);
  });

  it("takes any folder for a folder", () => {
    expect(isTrashedEntry({ type: "folder" }, { type: "folder", size: 0, mtime: 9 })).toBe(true);
  });
});
