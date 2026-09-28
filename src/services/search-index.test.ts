import { describe, expect, it } from "vitest";
import {
  FileSearchIndex,
  MAX_ALIASES,
  type FileMetadata,
  type IndexedFile,
  type SearchSource
} from "./search-index";

interface FakeFile {
  path: string;
  metadata?: FileMetadata | null;
}

/**
 * A vault the size of a test, plus a count of how often it was asked.
 *
 * The count is the point of the fake: the cache is the difference between a
 * filter that keeps up with typing and one that re-reads the whole vault on
 * every keystroke, and that is not visible in a result.
 */
function fakeSource(files: FakeFile[]): SearchSource & { reads: number } {
  const source = {
    reads: 0,
    files: (): IndexedFile[] =>
      files.map((file) => ({ path: file.path, name: file.path.split("/").pop() ?? file.path })),
    metadata: (file: IndexedFile): FileMetadata | null => {
      source.reads += 1;
      const entry = files.find((candidate) => candidate.path === file.path);
      if (!entry) return null;
      return entry.metadata === undefined ? {} : entry.metadata;
    }
  };
  return source;
}

const VAULT: FakeFile[] = [
  {
    path: "Objekte/Objekt 12.md",
    metadata: { title: "Villa Seeblick", aliases: ["Seeblick", "Villa am See"], tags: ["#objekt"] }
  },
  { path: "Objekte/Mietvertrag Seeblick.md", metadata: { tags: ["#vertrag"] } },
  { path: "Kontakte/Meier.md", metadata: { tags: ["#kontakt"] } },
  { path: "Bilder/terrasse.png", metadata: {} }
];

describe("FileSearchIndex", () => {
  it("finds a note by the title in its frontmatter", () => {
    const index = new FileSearchIndex(fakeSource(VAULT));

    expect(index.search("villa", 50).shown[0]?.path).toBe("Objekte/Objekt 12.md");
  });

  it("finds a note by an alias", () => {
    const index = new FileSearchIndex(fakeSource(VAULT));

    expect(index.search("villa am see", 50).shown.map((hit) => hit.path)).toContain(
      "Objekte/Objekt 12.md"
    );
  });

  it("finds a note by a tag, without its hash", () => {
    const index = new FileSearchIndex(fakeSource(VAULT));

    expect(index.search("tag:kontakt", 50).shown.map((hit) => hit.path)).toEqual([
      "Kontakte/Meier.md"
    ]);
  });

  it("finds a file with no metadata at all by its name", () => {
    const index = new FileSearchIndex(fakeSource(VAULT));

    expect(index.search("terrasse", 50).shown.map((hit) => hit.path)).toEqual([
      "Bilder/terrasse.png"
    ]);
  });

  it("reads each file once however often it is searched", () => {
    const source = fakeSource(VAULT);
    const index = new FileSearchIndex(source);

    index.search("v", 50);
    index.search("vi", 50);
    index.search("vil", 50);

    expect(source.reads).toBe(VAULT.length);
    expect(index.size).toBe(VAULT.length);
  });

  it("reads a file again once it is forgotten", () => {
    const source = fakeSource(VAULT);
    const index = new FileSearchIndex(source);

    index.search("villa", 50);
    index.forget("Objekte/Objekt 12.md");
    index.search("villa", 50);

    expect(source.reads).toBe(VAULT.length + 1);
  });

  it("forgets the whole vault when asked", () => {
    const source = fakeSource(VAULT);
    const index = new FileSearchIndex(source);

    index.search("villa", 50);
    index.forgetAll();

    expect(index.size).toBe(0);
  });

  it("says how many matched beyond what may be drawn", () => {
    const many: FakeFile[] = Array.from({ length: 10 }, (_, i) => ({
      path: `Objekt ${i}.md`
    }));
    const index = new FileSearchIndex(fakeSource(many));

    const result = index.search("objekt", 3);

    expect(result.shown).toHaveLength(3);
    expect(result.hits).toHaveLength(10);
    expect(result.held).toBe(7);
  });

  it("holds nothing back when everything fits", () => {
    const index = new FileSearchIndex(fakeSource(VAULT));

    expect(index.search("villa", 50).held).toBe(0);
  });

  it("answers an empty query with nothing", () => {
    const index = new FileSearchIndex(fakeSource(VAULT));

    expect(index.search("", 50).hits).toEqual([]);
  });
});

describe("FileSearchIndex against frontmatter a person wrote", () => {
  // Frontmatter is untrusted: another plugin writes it, a person edits it by
  // hand, and a sync delivers whatever the other device had. Every shape below
  // has to leave the file findable by its name rather than take the search down
  // or poison it with "[object Object]".
  const shapes: { what: string; metadata: FileMetadata }[] = [
    { what: "a single alias written as a bare string", metadata: { aliases: "Seeblick" } },
    { what: "an alias list holding a number", metadata: { aliases: ["Seeblick", 12] } },
    { what: "an alias list holding null", metadata: { aliases: [null, "Seeblick"] } },
    { what: "a nested alias list", metadata: { aliases: [["Seeblick"]] } },
    { what: "aliases written as an object", metadata: { aliases: { first: "Seeblick" } } },
    { what: "aliases set to null", metadata: { aliases: null } },
    { what: "a numeric title", metadata: { title: 2026 } },
    { what: "a title written as an object", metadata: { title: { de: "Villa" } } },
    { what: "a title set to null", metadata: { title: null } },
    { what: "tags set to null", metadata: { tags: null } }
  ];

  for (const { what, metadata } of shapes) {
    it(`survives ${what}`, () => {
      const index = new FileSearchIndex(fakeSource([{ path: "Plan.md", metadata }]));

      expect(() => index.search("plan", 50)).not.toThrow();
      expect(index.search("plan", 50).shown.map((hit) => hit.path)).toEqual(["Plan.md"]);
    });
  }

  it("takes a bare-string alias as an alias", () => {
    const index = new FileSearchIndex(
      fakeSource([{ path: "Plan.md", metadata: { aliases: "Seeblick" } }])
    );

    expect(index.search("seeblick", 50).shown.map((hit) => hit.path)).toEqual(["Plan.md"]);
  });

  it("keeps the usable aliases out of a list that also holds rubbish", () => {
    const index = new FileSearchIndex(
      fakeSource([{ path: "Plan.md", metadata: { aliases: [null, "Seeblick", 12] } }])
    );

    expect(index.search("seeblick", 50).shown.map((hit) => hit.path)).toEqual(["Plan.md"]);
  });

  it("finds a note by a numeric title", () => {
    const index = new FileSearchIndex(fakeSource([{ path: "Plan.md", metadata: { title: 2026 } }]));

    expect(index.search("2026", 50).shown.map((hit) => hit.path)).toEqual(["Plan.md"]);
  });

  it("never lets an unusable title become a word", () => {
    const index = new FileSearchIndex(
      fakeSource([{ path: "Plan.md", metadata: { title: { de: "Villa" } } }])
    );

    // "[object Object]" tokenizes to "object" — a word that would then match
    // every note whose frontmatter is shaped wrongly, and nothing a person means.
    expect(index.search("object", 50).shown).toEqual([]);
  });
});

describe("metadata not read yet", () => {
  it("answers by name and reads the file again next time", () => {
    const files: FakeFile[] = [{ path: "Objekt 12.md", metadata: null }];
    const source = fakeSource(files);
    const index = new FileSearchIndex(source);

    expect(index.search("seeblick", 10).hits).toEqual([]);
    expect(index.search("objekt", 10).shown[0]?.path).toBe("Objekt 12.md");
    expect(index.size).toBe(0);

    // Obsidian finishes parsing the note; nothing says so, the next search asks.
    files[0] = { path: "Objekt 12.md", metadata: { title: "Villa Seeblick" } };

    expect(index.search("seeblick", 10).shown[0]?.path).toBe("Objekt 12.md");
    expect(index.size).toBe(1);
  });
});

describe("hostile metadata", () => {
  it("drops tags that are not strings", () => {
    const index = new FileSearchIndex(
      fakeSource([{ path: "Plan.md", metadata: { tags: [{ tag: "x" }, 7, "#objekt", ""] } }])
    );

    expect(index.fieldsFor({ path: "Plan.md", name: "Plan.md" }).tags).toEqual(["objekt"]);
  });

  it("ignores a tag list that is not a list", () => {
    const index = new FileSearchIndex(
      fakeSource([{ path: "Plan.md", metadata: { tags: "#objekt" } }])
    );

    expect(index.fieldsFor({ path: "Plan.md", name: "Plan.md" }).tags).toEqual([]);
  });

  it("reads no more aliases than the bound", () => {
    const aliases = Array.from({ length: MAX_ALIASES + 10 }, (_, i) => `alias${i}`);
    const index = new FileSearchIndex(fakeSource([{ path: "Plan.md", metadata: { aliases } }]));

    const fields = index.fieldsFor({ path: "Plan.md", name: "Plan.md" });

    expect(fields.aliases).toHaveLength(MAX_ALIASES);
    expect(fields.aliases).not.toContain(`alias${MAX_ALIASES}`);
  });

  it("says how many files it searched", () => {
    const index = new FileSearchIndex(fakeSource(VAULT));

    expect(index.search("villa", 1).searched).toBe(VAULT.length);
  });

  it("treats a negative limit as none", () => {
    const index = new FileSearchIndex(fakeSource(VAULT));

    const result = index.search("objekt", -5);

    expect(result.shown).toEqual([]);
    expect(result.held).toBe(result.hits.length);
  });
});

describe("forgetUnder", () => {
  it("drops every file under the folder and nothing beside it", () => {
    const source = fakeSource([
      { path: "Projekte/Alpha/Plan.md" },
      { path: "Projekte/Alpha/Notizen.md" },
      { path: "Projekte/Beta/Plan.md" }
    ]);
    const index = new FileSearchIndex(source);
    for (const file of source.files()) index.fieldsFor(file);
    expect(index.size).toBe(3);

    index.forgetUnder("Projekte/Alpha");

    expect(index.size).toBe(1);
  });

  it("does not mistake a folder for one whose name it starts with", () => {
    const source = fakeSource([{ path: "Alpha/Plan.md" }, { path: "Alphabet/Plan.md" }]);
    const index = new FileSearchIndex(source);
    for (const file of source.files()) index.fieldsFor(file);

    index.forgetUnder("Alpha");

    expect(index.size).toBe(1);
  });
});

describe("a described picture's words", () => {
  it("reach the index through its metadata, validated like any other field", () => {
    const index = new FileSearchIndex(
      fakeSource([
        { path: "Fotos/IMG_1.jpg", metadata: { description: "Terrasse mit Seeblick" } },
        { path: "Fotos/IMG_2.jpg", metadata: { description: { not: "text" } } }
      ])
    );
    expect(index.search("seeblick", 10).hits.map((h) => h.path)).toEqual(["Fotos/IMG_1.jpg"]);
    expect(index.fieldsFor({ path: "Fotos/IMG_2.jpg", name: "IMG_2.jpg" }).description).toEqual([]);
  });
});
