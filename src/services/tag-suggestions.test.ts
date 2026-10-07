import { describe, expect, it } from "vitest";
import {
  isCovered,
  MAX_TAG_LENGTH,
  normalizeTag,
  resolveTag,
  suggestionsFrom,
  tagKey,
  tagVocabulary,
  voteTags,
  votingNotes,
  TAG_NEIGHBOUR_LIMIT,
  type TagNeighbour
} from "./tag-suggestions";

describe("tagKey", () => {
  it("compares without the hash, case or decomposed umlauts", () => {
    expect(tagKey("#Übung")).toBe(tagKey("übung"));
    expect(tagKey("##Projekt/Alpha")).toBe("projekt/alpha");
  });
});

describe("normalizeTag", () => {
  it("turns a phrase into one tag", () => {
    expect(normalizeTag("Machine Learning")).toBe("Machine-Learning");
    expect(normalizeTag("  #deep   learning ")).toBe("deep-learning");
  });

  it("keeps nesting, letters of any script and underscores", () => {
    expect(normalizeTag("Projekt / Alpha")).toBe("Projekt/Alpha");
    expect(normalizeTag("größe_maß")).toBe("größe_maß");
    expect(normalizeTag("日本語")).toBe("日本語");
  });

  it("drops what a tag cannot hold", () => {
    expect(normalizeTag("C++ (language)!")).toBe("C-language");
    expect(normalizeTag("--a//b--")).toBe("a/b");
  });

  it("refuses what is not a tag", () => {
    expect(normalizeTag("2024")).toBeNull();
    expect(normalizeTag("12/34")).toBeNull();
    expect(normalizeTag("!!!")).toBeNull();
    expect(normalizeTag(42)).toBeNull();
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag("x".repeat(MAX_TAG_LENGTH + 1))).toBeNull();
  });
});

describe("tagVocabulary", () => {
  it("counts each note once per tag and keeps the spelling most notes use", () => {
    const vocabulary = tagVocabulary([["#ML", "#ml"], ["#ml"], ["#ml", "#Physik"], []]);
    expect(vocabulary.total).toBe(4);
    expect(vocabulary.counts.get("ml")).toBe(3);
    expect(vocabulary.spelling.get("ml")).toBe("ml");
    expect(vocabulary.spelling.get("physik")).toBe("Physik");
  });

  it("breaks a spelling tie by sort order, not by file order", () => {
    expect(tagVocabulary([["#b-Tag"], ["#B-tag"]]).spelling.get("b-tag")).toBe("B-tag");
    expect(tagVocabulary([["#B-tag"], ["#b-Tag"]]).spelling.get("b-tag")).toBe("B-tag");
  });

  it("says whether the vault writes its tags in lower case", () => {
    expect(tagVocabulary([["#a", "#b", "#C"]]).lowercase).toBe(true);
    expect(tagVocabulary([["#A", "#B", "#c"]]).lowercase).toBe(false);
    expect(tagVocabulary([]).lowercase).toBe(true);
  });

  it("skips what is not a tag", () => {
    const vocabulary = tagVocabulary([[42 as unknown as string, "#", "#ok"]]);
    expect([...vocabulary.counts.keys()]).toEqual(["ok"]);
  });
});

describe("resolveTag", () => {
  const vocabulary = tagVocabulary([
    ["#machine-learning"],
    ["#machine-learning"],
    ["#Neural_Networks"],
    ["#news"]
  ]);

  it("uses the vault's spelling of the same tag", () => {
    expect(resolveTag("Machine-Learning", vocabulary)).toEqual({
      tag: "machine-learning",
      isNew: false
    });
  });

  it("finds a tag spelt with spaces, underscores or a plural", () => {
    expect(resolveTag("Machine Learning", vocabulary)?.tag).toBe("machine-learning");
    expect(resolveTag("neural network", vocabulary)?.tag).toBe("Neural_Networks");
  });

  it("keeps short words apart that only look like plurals", () => {
    expect(resolveTag("new", vocabulary)).toEqual({ tag: "new", isNew: true });
  });

  it("writes a new tag the way the vault writes tags", () => {
    expect(resolveTag("Quantum Computing", vocabulary)).toEqual({
      tag: "quantum-computing",
      isNew: true
    });
    const upper = tagVocabulary([["#Physik"], ["#Chemie"]]);
    expect(resolveTag("Quantum Computing", upper)?.tag).toBe("Quantum-Computing");
  });

  it("gives nothing for what is not a tag", () => {
    expect(resolveTag("1999", vocabulary)).toBeNull();
  });
});

describe("isCovered", () => {
  const carried = new Set(["projekt/alpha", "lesen"]);

  it("covers a tag the note has or one it has a nested tag of", () => {
    expect(isCovered("#Lesen", carried)).toBe(true);
    expect(isCovered("projekt", carried)).toBe(true);
  });

  it("does not cover a more specific tag or a mere prefix", () => {
    expect(isCovered("lesen/buch", carried)).toBe(false);
    expect(isCovered("proj", carried)).toBe(false);
  });
});

describe("voteTags", () => {
  const vocabulary = tagVocabulary([
    ["#physik", "#optik"],
    ["#physik", "#optik"],
    ["#physik", "#laser"],
    ["#physik"],
    ["#physik"],
    ["#physik"],
    ["#Einmalig"]
  ]);

  const note = (tags: string[], linked = false): TagNeighbour => ({ tags, linked });

  it("suggests what several related notes carry, rarer tags first", () => {
    const suggestions = voteTags(
      [note(["#physik", "#optik"]), note(["#physik", "#optik"]), note(["#physik"])],
      new Set(),
      vocabulary
    );
    expect(suggestions.map((s) => s.tag)).toEqual(["optik", "physik"]);
    expect(suggestions[0]).toMatchObject({ origin: "vault", isNew: false, carriers: 2 });
  });

  it("needs two carriers, unless one is linked", () => {
    expect(voteTags([note(["#laser"]), note([])], new Set(), vocabulary)).toEqual([]);
    const linked = voteTags([note(["#laser"], true)], new Set(), vocabulary);
    expect(linked).toMatchObject([{ tag: "laser", linked: true, carriers: 1 }]);
  });

  it("leaves out what the note already says", () => {
    const suggestions = voteTags(
      [note(["#physik", "#optik"]), note(["#physik", "#optik"])],
      new Set(["optik"]),
      vocabulary
    );
    expect(suggestions.map((s) => s.tag)).toEqual(["physik"]);
  });

  it("counts a neighbour once however often it lists a tag", () => {
    const suggestions = voteTags([note(["#optik", "#Optik"]), note([])], new Set(), vocabulary);
    expect(suggestions).toEqual([]);
  });

  it("drops tags far below the best and keeps to the limit", () => {
    const neighbours = [
      note(["#Einmalig"]),
      note(["#Einmalig"]),
      note(["#Einmalig", "#physik"]),
      note(["#Einmalig", "#physik"])
    ];
    const suggestions = voteTags(neighbours, new Set(), vocabulary);
    expect(suggestions.map((s) => s.tag)).toEqual(["Einmalig"]);
    expect(voteTags(neighbours, new Set(), vocabulary, { limit: 0 })).toEqual([]);
  });

  it("ignores entries that are not strings", () => {
    const bad = note([7 as unknown as string, "#optik"]);
    expect(voteTags([bad, bad], new Set(), vocabulary).map((s) => s.tag)).toEqual(["optik"]);
  });
});

describe("suggestionsFrom", () => {
  const vocabulary = tagVocabulary([["#machine-learning"], ["#physik"]]);

  it("resolves proposals and drops what is carried or already offered", () => {
    const offered = new Set(["physik"]);
    const suggestions = suggestionsFrom(
      "stated",
      ["Machine Learning", "Physik", "Quantum Optics", "Quantum optics", "2020", 5, "lesen"],
      new Set(["lesen"]),
      vocabulary,
      offered
    );
    expect(suggestions).toEqual([
      { tag: "machine-learning", isNew: false, origin: "stated" },
      { tag: "quantum-optics", isNew: true, origin: "stated" }
    ]);
    expect(offered.has("quantum-optics")).toBe(true);
  });
});

describe("votingNotes", () => {
  it("lets only notes vote, in order, up to the limit", () => {
    const entries = [
      { path: "picture.png", isNote: false, reasons: [{ kind: "meaning" }] },
      { path: "A.md", isNote: true, reasons: [{ kind: "meaning" }, { kind: "link" }] },
      { path: "conversation", isNote: false, reasons: [{ kind: "attached" }] },
      { path: "B.md", isNote: true, reasons: [{ kind: "backlink" }] },
      ...Array.from({ length: TAG_NEIGHBOUR_LIMIT }, (_, i) => ({
        path: `N${i}.md`,
        isNote: true,
        reasons: [{ kind: "tag" }]
      }))
    ];
    const notes = votingNotes(entries);
    expect(notes).toHaveLength(TAG_NEIGHBOUR_LIMIT);
    expect(notes[0]).toEqual({ path: "A.md", linked: true });
    expect(notes[1]).toEqual({ path: "B.md", linked: true });
    expect(notes[2]).toEqual({ path: "N0.md", linked: false });
    expect(votingNotes(entries, 1)).toEqual([{ path: "A.md", linked: true }]);
  });
});
