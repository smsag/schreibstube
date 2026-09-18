import { describe, expect, it } from "vitest";
import { frontmatterTitle } from "./note-title";

describe("frontmatterTitle", () => {
  it("takes the title a note gives itself", () => {
    expect(frontmatterTitle("Exposé Musterstraße 4")).toBe("Exposé Musterstraße 4");
  });

  it("trims it, and folds a title that wrapped in the frontmatter onto one line", () => {
    expect(frontmatterTitle("  Ein langer Titel  ")).toBe("Ein langer Titel");
    expect(frontmatterTitle("Ein Titel\n  über zwei Zeilen")).toBe("Ein Titel über zwei Zeilen");
  });

  it("takes a number, because a year or a version is typed without quotes", () => {
    expect(frontmatterTitle(2026)).toBe("2026");
  });

  it("says nothing for a key that is absent or empty", () => {
    expect(frontmatterTitle(undefined)).toBeNull();
    expect(frontmatterTitle("")).toBeNull();
    expect(frontmatterTitle("   ")).toBeNull();
  });

  it("says nothing for a value that is not a title", () => {
    // YAML types these without being asked, and a row cannot draw any of them.
    expect(frontmatterTitle(true)).toBeNull();
    expect(frontmatterTitle(null)).toBeNull();
    expect(frontmatterTitle(["a", "b"])).toBeNull();
    expect(frontmatterTitle({ de: "Titel" })).toBeNull();
    expect(frontmatterTitle(new Date(0))).toBeNull();
    expect(frontmatterTitle(Number.NaN)).toBeNull();
  });
});
