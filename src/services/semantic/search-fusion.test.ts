import { describe, expect, it } from "vitest";
import {
  applyMeaningFloor,
  fuseRankings,
  meaningFloor,
  meaningQuery,
  meaningRows,
  PHRASE_FLOOR,
  WORD_FLOOR
} from "./search-fusion";

const list = (...paths: string[]) => paths.map((path) => ({ path }));

describe("fuseRankings", () => {
  it("returns the keyword order unchanged when there is no semantic list", () => {
    expect(fuseRankings(list("a", "b", "c"), []).map((h) => h.path)).toEqual(["a", "b", "c"]);
  });

  it("adds what only meaning found — the note that never says the word", () => {
    const out = fuseRankings(list("Objekt 12.md"), list("Küche Seeblick.md"));
    expect(out.map((h) => h.path)).toEqual(["Objekt 12.md", "Küche Seeblick.md"]);
    expect(out[1]?.by).toEqual(["meaning"]);
  });

  it("raises a file both lists found above one that only one list holds", () => {
    const out = fuseRankings(list("a", "b", "x"), list("c", "b"));
    const order = out.map((h) => h.path);
    // "a" keeps first place as the exact keyword hit; "b", found by both, comes
    // next — above "c" and "x", which only one list holds.
    expect(order).toEqual(["a", "b", "c", "x"]);
    expect(out[1]?.by).toEqual(["words", "meaning"]);
  });

  it("keeps an exact name first even when meaning ranks something else first", () => {
    // "Objekt 12" typed: the note called that tops the words; a sentence model
    // prefers some prose note. The name must win.
    const out = fuseRankings(
      list("Objekt 12.md", "x.md"),
      list("prose.md", "y.md", "Objekt 12.md")
    );
    expect(out[0]?.path).toBe("Objekt 12.md");
  });

  it("caps the list when asked, after fusing", () => {
    expect(fuseRankings(list("a", "b", "c"), list("d", "e"), 2)).toHaveLength(2);
  });

  it("is stable for equal scores", () => {
    const one = fuseRankings(list(), list("b", "a")).map((h) => h.path);
    expect(one).toEqual(["b", "a"]);
    expect(fuseRankings(list("z"), list("y")).map((h) => h.path)).toEqual(["z", "y"]);
  });
});

describe("meaningQuery", () => {
  it("passes plain text through", () => {
    expect(meaningQuery("balkon mit seeblick")).toBe("balkon mit seeblick");
  });

  it("waits for a few letters", () => {
    expect(meaningQuery("ba")).toBeNull();
    expect(meaningQuery("bal")).toBe("bal");
  });

  it("leaves a narrowed dimension alone", () => {
    expect(meaningQuery("tag:immobilie")).toBeNull();
    expect(meaningQuery("pfad:Objekte")).toBeNull();
    expect(meaningQuery("name:Exposé")).toBeNull();
  });

  it("treats all: as the plain box", () => {
    expect(meaningQuery("all: küche hell")).toBe("küche hell");
  });

  it("keeps an unknown prefix as text", () => {
    expect(meaningQuery("todo: angebot")).toBe("todo: angebot");
  });
});

describe("meaningRows", () => {
  it("shows a description note as its picture", () => {
    const rows = meaningRows(list("Beschreibungen/see.md", "a.md"), (p) =>
      p === "Beschreibungen/see.md" ? "Bilder/see.jpg" : p
    );
    expect(rows.map((r) => r.path)).toEqual(["Bilder/see.jpg", "a.md"]);
  });

  it("drops what is not a row and keeps each row once, at its best place", () => {
    const rows = meaningRows(list("gone.md", "b.md", "note.md", "b.md"), (p) =>
      p === "gone.md" ? null : p === "note.md" ? "b.md" : p
    );
    expect(rows.map((r) => r.path)).toEqual(["b.md"]);
  });
});

describe("meaning for one word", () => {
  it("is not asked when the words already found something", () => {
    expect(meaningQuery("Jahres", 3)).toBeNull();
    expect(meaningQuery("Jahres", 0)).toBe("Jahres");
  });

  it("is always asked for a phrase", () => {
    expect(meaningQuery("Rechte gegenüber Verwalter", 12)).toBe("Rechte gegenüber Verwalter");
  });

  it("holds a lone word to a lower floor, cut relative to the best hit", () => {
    expect(meaningFloor("Jahres")).toBe(WORD_FLOOR);
    expect(meaningFloor("zwei Wörter")).toBe(PHRASE_FLOOR);
    const hits = [
      { id: "a", score: 0.3 },
      { id: "b", score: 0.28 },
      { id: "c", score: 0.26 },
      { id: "d", score: 0.2 }
    ];
    expect(applyMeaningFloor(hits, WORD_FLOOR).map((h) => h.id)).toEqual(["a", "b"]);
    expect(applyMeaningFloor(hits, PHRASE_FLOOR)).toEqual([]);
    expect(applyMeaningFloor([], WORD_FLOOR)).toEqual([]);
  });
});
