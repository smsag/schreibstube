import { describe, expect, it } from "vitest";
import { joinVaultPath, newNotePath, nextFreeName } from "./new-note";

const taken = (...names: string[]) => {
  const set = new Set(names);
  return (name: string) => set.has(name);
};

describe("nextFreeName", () => {
  it("uses the bare base when nothing is taken", () => {
    expect(nextFreeName("Untitled", taken())).toBe("Untitled");
  });

  it("counts up past the names already taken", () => {
    expect(nextFreeName("Untitled", taken("Untitled"))).toBe("Untitled 1");
    expect(nextFreeName("Untitled", taken("Untitled", "Untitled 1"))).toBe("Untitled 2");
  });

  it("fills a gap rather than counting past it, as Obsidian does", () => {
    expect(nextFreeName("Untitled", taken("Untitled 1"))).toBe("Untitled");
    expect(nextFreeName("Untitled", taken("Untitled", "Untitled 2"))).toBe("Untitled 1");
  });

  it("works with whatever base word the language gives", () => {
    expect(nextFreeName("Unbenannt", taken("Unbenannt"))).toBe("Unbenannt 1");
  });
});

describe("joinVaultPath", () => {
  it("joins a folder and a name, and treats both root spellings as no folder", () => {
    expect(joinVaultPath("", "a.md")).toBe("a.md");
    expect(joinVaultPath("/", "a.md")).toBe("a.md");
    expect(joinVaultPath("Notes", "a.md")).toBe("Notes/a.md");
    expect(joinVaultPath("Notes/Sub", "a.md")).toBe("Notes/Sub/a.md");
    expect(joinVaultPath("Notes/", "a.md")).toBe("Notes/a.md");
  });
});

describe("newNotePath", () => {
  it("names the next untitled note in the folder", () => {
    const exists = taken("Untitled.md");
    expect(newNotePath("/", "Untitled", exists)).toBe("Untitled 1.md");
    expect(newNotePath("", "Untitled", () => false)).toBe("Untitled.md");
  });

  it("counts only the notes in the same folder", () => {
    const exists = taken("Notes/Untitled.md", "Notes/Untitled 1.md", "Untitled 2.md");
    expect(newNotePath("Notes", "Untitled", exists)).toBe("Notes/Untitled 2.md");
    expect(newNotePath("Other", "Untitled", exists)).toBe("Other/Untitled.md");
  });
});
