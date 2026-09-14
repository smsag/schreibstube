import { describe, expect, it } from "vitest";
import {
  formatFolderRules,
  matchFolderRule,
  parseFolderRules,
  parseGlossaryList,
  resolveGlossarySelection
} from "./glossary-resolver";

describe("resolveGlossarySelection", () => {
  const folderRules = [{ folder: "Kunden", glossaries: ["Kunden.md"] }];

  it("prefers the note's own frontmatter", () => {
    expect(
      resolveGlossarySelection({
        notePath: "Kunden/a.md",
        frontmatter: ["Eigen.md"],
        folderRules,
        session: ["Sitzung.md"],
        fallback: ["Standard.md"]
      })
    ).toEqual({ paths: ["Eigen.md"], source: "frontmatter" });
  });

  it("falls back to a folder rule", () => {
    expect(
      resolveGlossarySelection({
        notePath: "Kunden/a.md",
        folderRules,
        session: ["Sitzung.md"],
        fallback: ["Standard.md"]
      })
    ).toEqual({ paths: ["Kunden.md"], source: "folder" });
  });

  it("falls back to the session pick", () => {
    expect(
      resolveGlossarySelection({
        notePath: "Andere/a.md",
        folderRules,
        session: ["Sitzung.md"],
        fallback: ["Standard.md"]
      })
    ).toEqual({ paths: ["Sitzung.md"], source: "session" });
  });

  it("honours an explicit empty pick instead of falling back", () => {
    expect(
      resolveGlossarySelection({ notePath: "a.md", session: [], fallback: ["Standard.md"] })
    ).toEqual({ paths: [], source: "none" });
  });

  it("still falls back when the user has not touched the picker", () => {
    expect(resolveGlossarySelection({ notePath: "a.md", fallback: ["Standard.md"] }).source).toBe(
      "default"
    );
  });

  it("lets frontmatter override an explicit empty pick", () => {
    expect(
      resolveGlossarySelection({ notePath: "a.md", frontmatter: ["F.md"], session: [] }).source
    ).toBe("frontmatter");
  });

  it("falls back to the vault default", () => {
    expect(
      resolveGlossarySelection({ notePath: "Andere/a.md", fallback: ["Standard.md"] })
    ).toEqual({ paths: ["Standard.md"], source: "default" });
  });

  it("reports none when nothing is configured", () => {
    expect(resolveGlossarySelection({ notePath: "a.md" })).toEqual({ paths: [], source: "none" });
  });

  it("never merges sources", () => {
    const result = resolveGlossarySelection({
      notePath: "Kunden/a.md",
      frontmatter: ["Eigen.md"],
      fallback: ["Standard.md"]
    });
    expect(result.paths).toEqual(["Eigen.md"]);
  });

  it("ignores an empty frontmatter list", () => {
    expect(
      resolveGlossarySelection({ notePath: "a.md", frontmatter: ["  "], fallback: ["S.md"] }).source
    ).toBe("default");
  });

  it("removes duplicates while keeping order", () => {
    expect(
      resolveGlossarySelection({ notePath: "a.md", fallback: ["A.md", "B.md", "A.md"] }).paths
    ).toEqual(["A.md", "B.md"]);
  });
});

describe("matchFolderRule", () => {
  const rules = [
    { folder: "Kunden", glossaries: ["Allgemein.md"] },
    { folder: "Kunden/Nord", glossaries: ["Nord.md"] }
  ];

  it("picks the deepest matching folder", () => {
    expect(matchFolderRule("Kunden/Nord/a.md", rules)?.glossaries).toEqual(["Nord.md"]);
  });

  it("falls back to the shallower rule", () => {
    expect(matchFolderRule("Kunden/Sued/a.md", rules)?.glossaries).toEqual(["Allgemein.md"]);
  });

  it("returns null when no folder matches", () => {
    expect(matchFolderRule("Privat/a.md", rules)).toBe(null);
  });

  it("does not match a folder that is only a name prefix", () => {
    expect(matchFolderRule("Kundenarchiv/a.md", rules)).toBe(null);
  });

  it("tolerates leading and trailing slashes", () => {
    expect(matchFolderRule("Kunden/a.md", [{ folder: "/Kunden/", glossaries: ["X.md"] }])).not.toBe(
      null
    );
  });
});

describe("parseFolderRules", () => {
  it("parses one rule per line", () => {
    expect(parseFolderRules("Kunden | A.md, B.md\nProjekte | C.md")).toEqual([
      { folder: "Kunden", glossaries: ["A.md", "B.md"] },
      { folder: "Projekte", glossaries: ["C.md"] }
    ]);
  });

  it("skips blanks, comments, and malformed lines", () => {
    expect(parseFolderRules("\n# comment\nkein Trenner\nKunden | A.md")).toEqual([
      { folder: "Kunden", glossaries: ["A.md"] }
    ]);
  });

  it("round-trips through formatFolderRules", () => {
    const text = "Kunden | A.md, B.md";
    expect(formatFolderRules(parseFolderRules(text))).toBe(text);
  });
});

describe("parseGlossaryList", () => {
  it("reads a single path", () => {
    expect(parseGlossaryList("Glossar.md")).toEqual(["Glossar.md"]);
  });

  it("reads a comma list", () => {
    expect(parseGlossaryList("A.md, B.md")).toEqual(["A.md", "B.md"]);
  });

  it("reads a YAML array", () => {
    expect(parseGlossaryList(["A.md", "B.md"])).toEqual(["A.md", "B.md"]);
  });

  it("reads an inline bracket list", () => {
    expect(parseGlossaryList("[A.md, B.md]")).toEqual(["A.md", "B.md"]);
  });

  it("strips wikilink brackets", () => {
    expect(parseGlossaryList("[[Glossare/Haus]]")).toEqual(["Glossare/Haus"]);
  });

  it("returns nothing for other types", () => {
    expect(parseGlossaryList(42)).toEqual([]);
  });
});
