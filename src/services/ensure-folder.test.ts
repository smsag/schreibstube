import { describe, expect, it } from "vitest";
import { folderOfPath, missingAncestors } from "./ensure-folder";

const vault =
  (...folders: string[]) =>
  (folder: string) =>
    folders.includes(folder);

describe("missingAncestors", () => {
  it("names every folder that is not there, outermost first", () => {
    expect(missingAncestors("A/B/C", vault())).toEqual(["A", "A/B", "A/B/C"]);
  });

  it("names only what is missing below the folders that exist", () => {
    expect(missingAncestors("A/B/C", vault("A"))).toEqual(["A/B", "A/B/C"]);
  });

  it("names nothing for a folder that exists", () => {
    expect(missingAncestors("A/B", vault("A", "A/B"))).toEqual([]);
  });

  it("names nothing for the root, however it is spelt", () => {
    expect(missingAncestors("", vault())).toEqual([]);
    expect(missingAncestors("/", vault())).toEqual([]);
  });

  it("ignores empty segments from a leading or doubled slash", () => {
    expect(missingAncestors("/A//B/", vault())).toEqual(["A", "A/B"]);
  });
});

describe("folderOfPath", () => {
  it("is the part before the last slash, or nothing at the root", () => {
    expect(folderOfPath("A/B/c.md")).toBe("A/B");
    expect(folderOfPath("c.md")).toBe("");
  });
});
