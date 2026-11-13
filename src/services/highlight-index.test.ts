import { describe, expect, it } from "vitest";
import { BodyIndex, BodyLoader } from "./body-index";
import { highlightWords, rankFiles, searchFields, type SearchCandidate } from "./file-search";
import {
  HighlightIndex,
  locateHighlight,
  MAX_HIGHLIGHT_CHARS,
  MAX_HIGHLIGHTS_PER_NOTE
} from "./highlight-index";
import { findHighlightSpans } from "./passages";
import { FileSearchIndex } from "./search-index";

describe("findHighlightSpans", () => {
  it("finds each highlight with the columns of its marks", () => {
    const spans = findHighlightSpans("Intro\nDer ==Mietvertrag== und ==die Kaution==.");
    expect(spans).toEqual([
      { line: 1, start: 4, end: 19, text: "Mietvertrag" },
      { line: 1, start: 24, end: 39, text: "die Kaution" }
    ]);
  });

  it("skips code, properties, comments and inline code, keeping the columns", () => {
    const note = [
      "---",
      "title: ==nein==",
      "---",
      "```",
      "==code==",
      "```",
      "%% ==kommentar== %% `==inline==` ==ja==",
      "",
      "    ==eingerückt=="
    ].join("\n");
    const spans = findHighlightSpans(note);
    expect(spans.map((span) => span.text)).toEqual(["ja"]);
    const line = note.split("\n")[6] ?? "";
    const [span] = spans;
    expect(line.slice(span?.start, span?.end)).toBe("==ja==");
  });

  it("does not take == with space inside for a highlight", () => {
    expect(findHighlightSpans("a == b == c")).toEqual([]);
  });
});

describe("HighlightIndex", () => {
  it("holds only notes with highlights, and replaces or forgets them", () => {
    const index = new HighlightIndex();
    index.set("a.md", "Text ==eins== und ==zwei==");
    index.set("b.md", "nichts markiert");
    expect(index.size).toBe(1);
    expect(index.count("a.md")).toBe(2);
    expect(index.count("b.md")).toBe(0);

    index.set("a.md", "jetzt ohne");
    expect(index.count("a.md")).toBe(0);

    index.set("Kunden/x.md", "==x==");
    index.set("Kundenliste.md", "==y==");
    index.deleteUnder("Kunden");
    expect(index.count("Kunden/x.md")).toBe(0);
    expect(index.count("Kundenliste.md")).toBe(1);
    index.delete("Kundenliste.md");
    index.set("c.md", "==z==");
    index.clear();
    expect(index.size).toBe(0);
  });

  it("ignores text that is not a string", () => {
    const index = new HighlightIndex();
    index.set("a.md", 42);
    expect(index.size).toBe(0);
  });

  it("answers a word only from highlighted text, forward matches only", () => {
    const index = new HighlightIndex();
    index.set("a.md", "Der Vertrag steht hier. ==Die Mietvertragsdauer==");
    index.set("b.md", "Vertrag, ungemarkt. ==Kaution==");
    expect([...index.strengths("mietvertrag")]).toEqual([["a.md", 0.9]]);
    expect(index.strengths("kaution").get("b.md")).toBe(1);
    expect(index.strengths("vertrag").has("b.md")).toBe(false);
    expect(index.strengths("").size).toBe(0);
  });

  it("bounds the highlights of one note and the length of each", () => {
    const index = new HighlightIndex();
    const many = Array.from({ length: MAX_HIGHLIGHTS_PER_NOTE + 5 }, (_, i) => `==w${i}==`);
    index.set("many.md", many.join(" "));
    expect(index.count("many.md")).toBe(MAX_HIGHLIGHTS_PER_NOTE);

    index.set("long.md", `==${"a".repeat(MAX_HIGHLIGHT_CHARS)} versteckt==`);
    expect(index.strengths("versteckt").size).toBe(0);
    expect(index.snippets("long.md", []).shown[0]?.text).toHaveLength(MAX_HIGHLIGHT_CHARS);
  });

  it("offers a note's first highlights when no word was typed", () => {
    const index = new HighlightIndex();
    index.set("a.md", "==eins== ==zwei== ==drei== ==vier==");
    const { shown, more } = index.snippets("a.md", []);
    expect(shown.map((span) => span.text)).toEqual(["eins", "zwei", "drei"]);
    expect(more).toBe(1);
    expect(index.snippets("missing.md", []).shown).toEqual([]);
  });

  it("offers the highlights answering most words first, else in order", () => {
    const index = new HighlightIndex();
    index.set(
      "a.md",
      ["==Miete März==", "==nichts==", "==Kaution==", "==Miete und Kaution=="].join("\n")
    );
    const { shown, more } = index.snippets("a.md", ["miete", "kaution"]);
    expect(shown.map((span) => span.text)).toEqual(["Miete und Kaution", "Miete März", "Kaution"]);
    expect(more).toBe(0);
    expect(index.snippets("a.md", ["miete"], 1)).toEqual({
      shown: [{ line: 0, start: 0, end: 14, text: "Miete März" }],
      more: 1
    });
  });
});

describe("locateHighlight", () => {
  const span = { line: 1, start: 4, end: 13, text: "Kaution" };

  it("finds the highlight where it was read", () => {
    const doc = "Kopf\nDie ==Kaution== ist fällig.";
    const range = locateHighlight(doc, span);
    expect(range && doc.slice(range.from, range.to)).toBe("==Kaution==");
  });

  it("finds it nearby after the note changed above it", () => {
    const doc = "Kopf\nneue Zeile\nDie ==Kaution== ist fällig.\nSpäter ==Kaution== wieder.";
    const range = locateHighlight(doc, span);
    expect(range?.from).toBe(doc.indexOf("==Kaution=="));
  });

  it("finds a highlight kept shorter than it was written", () => {
    const text = "a".repeat(10);
    const doc = `==${text}bbb==`;
    expect(locateHighlight(doc, { line: 0, start: 0, end: 0, text })).toEqual({
      from: 0,
      to: doc.length
    });
  });

  it("answers null when the highlight is gone or not closed on its line", () => {
    expect(locateHighlight("Kopf\nDie Kaution ist fällig.", span)).toBeNull();
    expect(locateHighlight("==Kaution\n==", { ...span, line: 9 })).toBeNull();
  });
});

describe("markiert: in the search", () => {
  const fields = (path: string) => searchFields({ path, name: path.split("/").pop() ?? path });
  const marks = new HighlightIndex();
  marks.set("Kunden/Meier.md", "==Mietvertrag unterschrieben== und ==Kaution offen==");
  marks.set("Kunden/Abel.md", "==Kaution erhalten==");
  marks.set("Notizen/Idee.md", "==Vertrag== prüfen");
  const candidates: SearchCandidate[] = [
    "Kunden/Meier.md",
    "Kunden/Abel.md",
    "Notizen/Idee.md",
    "Notizen/Leer.md"
  ].map((path) => ({ path, fields: fields(path), highlights: marks.count(path) }));
  const paths = (raw: string) =>
    rankFiles(raw, candidates, undefined, undefined, marks).map((hit) => hit.path);

  it("lists every note with highlights, in reading order, under each spelling", () => {
    for (const raw of ["markiert:", "Highlight:", "highlights:", "markierung:"]) {
      expect(paths(raw)).toEqual(["Kunden/Abel.md", "Kunden/Meier.md", "Notizen/Idee.md"]);
    }
  });

  it("needs every word answered by a highlight, best first", () => {
    expect(paths("markiert: kaution")).toEqual(["Kunden/Abel.md", "Kunden/Meier.md"]);
    expect(paths("markiert: kaution offen")).toEqual(["Kunden/Meier.md"]);
    expect(paths("markiert: vertrag")).toEqual(["Notizen/Idee.md", "Kunden/Meier.md"]);
    expect(paths("markiert: prüfen")).toEqual([]);
  });

  it("narrows by a second prefix without leaving reading order", () => {
    expect(paths("markiert: pfad:Kunden")).toEqual(["Kunden/Abel.md", "Kunden/Meier.md"]);
  });

  it("answers nothing without a highlight index to ask", () => {
    expect(rankFiles("markiert: kaution", candidates)).toEqual([]);
  });

  it("caps the list at the limit", () => {
    expect(rankFiles("markiert:", candidates, 1, undefined, marks)).toHaveLength(1);
    expect(rankFiles("markiert: kaution", candidates, 1, undefined, marks)).toHaveLength(1);
  });

  it("works after another listing prefix", () => {
    const synced = candidates.map((c) => ({ ...c, synced: c.path.startsWith("Kunden/") }));
    expect(
      rankFiles("sync: markiert: vertrag", synced, undefined, undefined, marks).map((h) => h.path)
    ).toEqual(["Kunden/Meier.md"]);
  });

  it("names the words to pick snippets by", () => {
    expect(highlightWords("markiert: Kaution offen")).toEqual(["kaution", "offen"]);
    expect(highlightWords("markiert:")).toEqual([]);
    expect(highlightWords("markiert: pfad:Kunden")).toEqual([]);
    expect(highlightWords("sync: highlight: miete")).toEqual(["miete"]);
    expect(highlightWords("text: miete")).toBeNull();
    expect(highlightWords("sync: miete")).toBeNull();
    expect(highlightWords("aufgaben: fällig: sync: aufgaben: markiert: x")).toBeNull();
  });

  it("reaches the index through FileSearchIndex", () => {
    const search = new FileSearchIndex(
      {
        files: () => candidates.map(({ path }) => ({ path, name: path.split("/").pop() ?? path })),
        metadata: () => ({})
      },
      undefined,
      marks
    );
    expect(search.search("markiert: kaution", 10).hits.map((hit) => hit.path)).toEqual([
      "Kunden/Abel.md",
      "Kunden/Meier.md"
    ]);
    // Not asked for, the counts are not read.
    expect(search.search("Meier", 10).hits.map((hit) => hit.path)).toEqual(["Kunden/Meier.md"]);
  });
});

describe("BodyLoader feeding the highlights", () => {
  it("hands every read to the highlights and forgets with the text", async () => {
    const files: Record<string, string> = {
      "a.md": "==eins==",
      "Ordner/b.md": "==zwei==",
      "c.md": "==drei=="
    };
    const marks = new HighlightIndex();
    const loader = new BodyLoader(
      new BodyIndex(),
      {
        paths: () => Object.keys(files),
        read: (path) => {
          const text = files[path];
          return text === undefined ? Promise.reject(new Error("gone")) : Promise.resolve(text);
        },
        exists: (path) => path in files
      },
      () => Promise.resolve()
    ).also(marks);

    await loader.ensure();
    expect(marks.size).toBe(3);

    files["a.md"] = "nichts mehr";
    await loader.refresh("a.md");
    expect(marks.count("a.md")).toBe(0);

    loader.forgetUnder("Ordner");
    expect(marks.count("Ordner/b.md")).toBe(0);

    loader.forget("c.md");
    expect(marks.size).toBe(0);

    files["d.md"] = "==vier==";
    delete files["c.md"];
    await loader.ensure();
    expect(marks.count("d.md")).toBe(1);
  });

  it("drops a note that vanished between the listing and the read", async () => {
    const marks = new HighlightIndex();
    marks.set("gone.md", "==alt==");
    const loader = new BodyLoader(
      new BodyIndex(),
      {
        paths: () => ["gone.md"],
        read: () => Promise.reject(new Error("gone")),
        exists: () => false
      },
      () => Promise.resolve()
    ).also(marks);
    await loader.ensure();
    expect(marks.count("gone.md")).toBe(0);
  });

  it("drops a held note the vault no longer lists", async () => {
    const marks = new HighlightIndex();
    const body = new BodyIndex();
    body.set("old.md", "x");
    marks.set("old.md", "==alt==");
    const loader = new BodyLoader(body, { paths: () => [], read: () => Promise.resolve("") }, () =>
      Promise.resolve()
    ).also(marks);
    await loader.ensure();
    expect(marks.count("old.md")).toBe(0);
  });
});
