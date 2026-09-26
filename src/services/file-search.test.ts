import { describe, expect, it } from "vitest";
import {
  matchesText,
  matchStrength,
  MAX_QUERY_TOKENS,
  parseSearchScope,
  queryTokens,
  rankFiles,
  searchFields,
  tokenize,
  type SearchCandidate,
  type SearchSubject
} from "./file-search";

function candidate(subject: SearchSubject): SearchCandidate {
  return { path: subject.path, fields: searchFields(subject) };
}

function file(path: string, extra: Partial<SearchSubject> = {}): SearchCandidate {
  return candidate({ path, name: path.split("/").pop() ?? path, ...extra });
}

const VAULT: SearchCandidate[] = [
  file("Objekte/Mietvertrag Seeblick.md", { tags: ["vertrag", "objekt/villa"] }),
  file("Objekte/Objekt 12.md", { title: "Villa Seeblick", aliases: ["Seeblick"] }),
  file("Kontakte/Meier.md", { tags: ["kontakt"] }),
  file("Notizen/Besichtigung.md"),
  file("Bilder/terrasse.png")
];

describe("tokenize", () => {
  it("keeps umlaut words whole", () => {
    expect(tokenize("Ernährung")).toEqual(["ernährung"]);
  });

  it("reads a decomposed umlaut as the precomposed one", () => {
    // How macOS stores the name on disk: "u" plus a combining diaeresis.
    expect(tokenize("Gru\u0308n")).toEqual(tokenize("Grün"));
  });

  it("keeps a non-Latin query as tokens rather than dropping it", () => {
    expect(tokenize("Вертраг 契約")).toEqual(["вертраг", "契約"]);
  });

  it("dedupes and lowercases", () => {
    expect(tokenize("Objekt objekt OBJEKT 12")).toEqual(["objekt", "12"]);
  });
});

describe("matchStrength", () => {
  it("ranks an exact hit above a prefix above a compound above a shorter form", () => {
    const exact = matchStrength(["objekt"], "objekt");
    const prefix = matchStrength(["objekte"], "objekt");
    const infix = matchStrength(["mietvertrag"], "vertrag");
    const reverse = matchStrength(["objekt"], "objekte");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(infix);
    expect(infix).toBeGreaterThan(reverse);
    expect(reverse).toBeGreaterThan(0);
  });

  it("finds a German compound by its head", () => {
    expect(matchStrength(["mietvertrag"], "vertrag")).toBeGreaterThan(0);
  });

  it("will not look inside a word for a short query", () => {
    // Four characters: "trag" occurs inside far too much to be a hit.
    expect(matchStrength(["mietvertrag"], "trag")).toBe(0);
  });

  it("refuses a stopword as the shorter form of a long query", () => {
    expect(matchStrength(["der"], "dermatologie")).toBe(0);
  });

  it("answers nothing for an empty query token", () => {
    expect(matchStrength(["objekt"], "")).toBe(0);
  });
});

describe("parseSearchScope", () => {
  it("reads a prefix in either language", () => {
    expect(parseSearchScope("tag:vertrag")).toEqual({
      scope: "tags",
      query: "vertrag",
      explicit: true
    });
    expect(parseSearchScope("pfad: Objekte")).toEqual({
      scope: "path",
      query: "Objekte",
      explicit: true
    });
  });

  it("leaves an unknown prefix in the query as ordinary text", () => {
    expect(parseSearchScope("todo: Angebot")).toEqual({
      scope: "all",
      query: "todo: Angebot",
      explicit: false
    });
  });
});

describe("rankFiles", () => {
  it("finds a compound by its head, which the old substring filter could not", () => {
    const hits = rankFiles("vertrag", VAULT);

    expect(hits.map((hit) => hit.path)).toContain("Objekte/Mietvertrag Seeblick.md");
  });

  it("finds a note by the title in its frontmatter", () => {
    const hits = rankFiles("villa", VAULT);

    expect(hits[0]?.path).toBe("Objekte/Objekt 12.md");
  });

  it("finds a note by an alias", () => {
    const hits = rankFiles("seeblick", VAULT);

    expect(hits.map((hit) => hit.path)).toContain("Objekte/Objekt 12.md");
  });

  it("ranks a name hit above a folder hit", () => {
    const hits = rankFiles("objekt", VAULT);

    // "Objekt 12" is called that; "Mietvertrag Seeblick" only lives there.
    expect(hits[0]?.path).toBe("Objekte/Objekt 12.md");
  });

  it("narrows to one dimension when a scope is typed", () => {
    const hits = rankFiles("tag:kontakt", VAULT);

    expect(hits.map((hit) => hit.path)).toEqual(["Kontakte/Meier.md"]);
  });

  it("ranks a file answering both words above one answering a single word", () => {
    const hits = rankFiles("mietvertrag seeblick", VAULT);

    expect(hits[0]?.path).toBe("Objekte/Mietvertrag Seeblick.md");
  });

  it("returns nothing for an empty query", () => {
    expect(rankFiles("", VAULT)).toEqual([]);
    expect(rankFiles("   ", VAULT)).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(rankFiles("kernfusion", VAULT)).toEqual([]);
  });

  it("finds an attachment by its stem without its extension answering", () => {
    expect(rankFiles("terrasse", VAULT).map((hit) => hit.path)).toEqual(["Bilder/terrasse.png"]);
    expect(rankFiles("png", VAULT)).toEqual([]);
  });

  it("does not let the extension of a note make every note a hit", () => {
    expect(rankFiles("md", VAULT)).toEqual([]);
  });

  it("keeps the best results when a limit is given", () => {
    const hits = rankFiles("seeblick", VAULT, 1);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe("Objekte/Mietvertrag Seeblick.md");
  });

  it("drops results far below the best one", () => {
    // Every note lives under a folder, so a weak path hit alone must not put
    // the whole vault on screen.
    const hits = rankFiles("objekte", VAULT);

    expect(hits.length).toBeLessThan(VAULT.length);
  });

  it("weighs a rare word above a word most files share", () => {
    const shared: SearchCandidate[] = [
      file("Objekt Alpha.md"),
      file("Objekt Beta.md"),
      file("Objekt Gamma.md"),
      file("Objekt Seeblick.md")
    ];

    const hits = rankFiles("objekt seeblick", shared);

    expect(hits[0]?.path).toBe("Objekt Seeblick.md");
  });

  it("answers an empty vault with nothing", () => {
    expect(rankFiles("objekt", [])).toEqual([]);
  });
});

describe("queryTokens", () => {
  it("reads a typed filter whole", () => {
    expect(queryTokens("mietvertrag seeblick")).toEqual(["mietvertrag", "seeblick"]);
  });

  it("keeps the first words of a query longer than the bound", () => {
    const words = Array.from({ length: MAX_QUERY_TOKENS + 20 }, (_, i) => `wort${i}`);
    const kept = queryTokens(words.join(" "));

    expect(kept).toHaveLength(MAX_QUERY_TOKENS);
    expect(kept).toEqual(words.slice(0, MAX_QUERY_TOKENS));
  });

  it("counts a repeated word once against the bound", () => {
    expect(queryTokens("objekt ".repeat(MAX_QUERY_TOKENS + 5))).toEqual(["objekt"]);
  });
});

describe("rankFiles bounds a pasted query", () => {
  it("answers a long query as it answers its first words", () => {
    const head = Array.from({ length: MAX_QUERY_TOKENS }, (_, i) => (i === 0 ? "objekt" : `w${i}`));
    const pasted = [...head, ...Array.from({ length: 2000 }, (_, i) => `rest${i}`)];

    expect(rankFiles(pasted.join(" "), VAULT)).toEqual(rankFiles(head.join(" "), VAULT));
  });

  it("scores a pasted paragraph against a vault without walking it once per word", () => {
    // The scoring holds one number per file per word, so an unbounded query is
    // both the time and the memory. Ten thousand words over a thousand files
    // would be ten million of them; the bound makes it twelve thousand.
    const vault = Array.from({ length: 1000 }, (_, i) =>
      file(`Objekte/Objekt ${i}.md`, { tags: ["objekt"] })
    );
    const pasted = Array.from({ length: 10000 }, (_, i) => `wort${i}`).join(" ");

    const started = Date.now();
    const hits = rankFiles(`objekt ${pasted}`, vault);

    expect(hits).toHaveLength(1000);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("searchFields", () => {
  it("keeps the folders above a file out of its name", () => {
    const fields = searchFields({ path: "Objekte/Villa/Plan.md", name: "Plan.md" });

    expect(fields.name).toEqual(["plan"]);
    expect(fields.path).toEqual(["objekte", "villa"]);
  });

  it("holds an absent title and absent tags as empty fields", () => {
    const fields = searchFields({ path: "Plan.md", name: "Plan.md" });

    expect(fields.title).toEqual([]);
    expect(fields.tags).toEqual([]);
    expect(fields.aliases).toEqual([]);
  });
});

describe("matchesText", () => {
  it("answers a row whose text holds every word typed", () => {
    expect(matchesText("objekt 12", "Objekt 12.md")).toBe(true);
    expect(matchesText("objekt vertrag", "Objekt 12.md")).toBe(false);
  });

  it("finds a compound in a row's text", () => {
    expect(matchesText("vertrag", "Mietvertrag Seeblick")).toBe(true);
  });

  it("finds a compound from either of its parts", () => {
    // Both halves answer: "see" begins the word, "blick" ends it.
    expect(matchesText("see blick", "Seeblick")).toBe(true);
  });

  it("keeps every row while nothing is typed", () => {
    expect(matchesText("", "Seeblick")).toBe(true);
    expect(matchesText("tag:", "Seeblick")).toBe(true);
  });

  it("hides a row that cannot answer the dimension asked for", () => {
    // A bookmark has no tags: `tag:` must hide it, not match its name.
    expect(matchesText("tag:objekt", "Objekt 12")).toBe(false);
    expect(matchesText("tag:objekt", "objekt", ["all", "tags"])).toBe(true);
  });
});

describe("a picture found by its description", () => {
  const pic = (path: string, description: string) => ({
    path,
    fields: searchFields({ path, name: path.split("/").pop()!, description })
  });

  it("finds IMG_4711.jpg by what it shows", () => {
    const hits = rankFiles("kochinsel", [
      pic("Fotos/IMG_4711.jpg", "Offene Küche mit weißer Kochinsel und Eichenparkett."),
      pic("Fotos/IMG_4712.jpg", "Badezimmer mit Dusche.")
    ]);
    expect(hits.map((h) => h.path)).toEqual(["Fotos/IMG_4711.jpg"]);
  });

  it("ranks a file named for the word above a picture whose description mentions it", () => {
    const named = {
      path: "Kochinsel.md",
      fields: searchFields({ path: "Kochinsel.md", name: "Kochinsel.md" })
    };
    const hits = rankFiles("kochinsel", [pic("IMG_1.jpg", "Eine Kochinsel."), named]);
    expect(hits[0]?.path).toBe("Kochinsel.md");
  });

  it("gives nothing else a description field", () => {
    expect(searchFields({ path: "a.md", name: "a.md" }).description).toEqual([]);
  });
});
