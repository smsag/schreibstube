import { describe, expect, it } from "vitest";
import {
  findPassages,
  opensPassageForReading,
  passageCards,
  readPassageOptions,
  type NotePassages
} from "./passages";

const NOTE = [
  "---",
  "status: ==nicht im Text==",
  "---",
  "# Kapitel",
  "",
  "Ein Satz mit ==Markierung== und noch ==einer==.",
  "",
  "> [!Warning] Achtung",
  "> Der Vertrag läuft ==Ende Mai== aus.",
  "> > [!note] innen",
  "> > gehört zum äußeren",
  "",
  "```",
  "> [!tip] im Code",
  "==auch nicht==",
  "```",
  "",
  "`==inline code==` zählt nicht, %% ==Kommentar== %% auch nicht.",
  "",
  "> [!tip]- Zugeklappt",
  "> Text"
].join("\n");

describe("findPassages", () => {
  const found = findPassages(NOTE);

  it("finds every callout with its type, its line and its text as written", () => {
    expect(found.callouts.map((c) => [c.type, c.line])).toEqual([
      ["warning", 7],
      ["tip", 19]
    ]);
    expect(found.callouts[0]?.markdown).toBe(
      "> [!Warning] Achtung\n> Der Vertrag läuft ==Ende Mai== aus.\n> > [!note] innen\n> > gehört zum äußeren"
    );
    expect(found.callouts[1]?.markdown).toBe("> [!tip]- Zugeklappt\n> Text");
  });

  it("finds the lines with highlights, inside callouts too, and none in code, properties or comments", () => {
    expect(found.highlights.map((h) => h.line)).toEqual([5, 8]);
    expect(found.highlights[0]?.markdown).toBe("Ein Satz mit ==Markierung== und noch ==einer==.");
  });

  it("takes a callout further down the same quote for a line of it", () => {
    const quoted = findPassages("> [!note] eins\n> [!tip] noch eins\n> Text");
    expect(quoted.callouts.map((c) => c.type)).toEqual(["note"]);
  });

  it("leaves a callout in a list item and in indented code to them", () => {
    expect(findPassages("- > [!note] im Punkt").callouts).toEqual([]);
    expect(findPassages("Text\n\n    > [!note] Code").callouts).toEqual([]);
  });

  it("reads no highlight from a lone pair of signs or from spaces inside them", () => {
    expect(findPassages("a == b == c, ====, == x").highlights).toEqual([]);
    expect(findPassages("==x==").highlights).toHaveLength(1);
  });

  it("keeps a comment over several lines out, and the lines after it in", () => {
    const text = "%% Anfang\n> [!note] versteckt\n==weg==\nEnde %%\n==da==";
    const passages = findPassages(text);
    expect(passages.callouts).toEqual([]);
    expect(passages.highlights.map((h) => h.line)).toEqual([4]);
  });

  it("reads CRLF text as well", () => {
    expect(findPassages("> [!note] a\r\n> b\r\n\r\n==c==").callouts[0]?.markdown).toBe(
      "> [!note] a\n> b"
    );
  });
});

describe("what counts as code", () => {
  it("keeps every line of an indented code block out, not only its first", () => {
    const text = "Text\n\n    code ==a==\n    more ==b==\n\n    still ==c==\n\nProsa ==d==";
    expect(findPassages(text).highlights.map((h) => h.markdown)).toEqual(["Prosa ==d=="]);
  });

  it("reads an indented paragraph in a list item as the item's, not as code", () => {
    const text = "- Punkt\n\n    Fortsetzung ==wichtig==";
    expect(findPassages(text).highlights.map((h) => h.line)).toEqual([2]);
  });

  it("keeps a code fence inside a callout out", () => {
    const text = "> [!example] Beispiel\n> ```\n> a ==b== c\n> ```\n> danach ==d==";
    const passages = findPassages(text);
    expect(passages.callouts).toHaveLength(1);
    expect(passages.highlights.map((h) => h.line)).toEqual([4]);
  });

  it("does not take `%%` written in inline code for a comment", () => {
    const text = "Escape with `%%` in Obsidian.\n\n> [!tip] danach\n\n==da==";
    const passages = findPassages(text);
    expect(passages.callouts).toHaveLength(1);
    expect(passages.highlights).toHaveLength(1);
  });
});

describe("a highlighted line out of its block", () => {
  const markdownOf = (text: string) => findPassages(text).highlights[0]?.markdown;

  it("drops the quote, list and heading marks, which would draw it as a stray block", () => {
    expect(markdownOf("> > Der Vertrag läuft ==Ende Mai== aus.")).toBe(
      "Der Vertrag läuft ==Ende Mai== aus."
    );
    expect(markdownOf("1. Erstens ==hier==")).toBe("Erstens ==hier==");
    expect(markdownOf("- [x] erledigt ==heute==")).toBe("erledigt ==heute==");
    expect(markdownOf("## Titel ==neu==")).toBe("Titel ==neu==");
  });

  it("writes a table row as its cells", () => {
    expect(markdownOf("| Frist | ==31.05.== |")).toBe("Frist · ==31.05.==");
  });
});

describe("readPassageOptions", () => {
  it("reads the types as a list or a text, forgiving the brackets", () => {
    expect([...readPassageOptions(["Warning", "[!tip]", " "], "callouts").types]).toEqual([
      "warning",
      "tip"
    ]);
    expect([...readPassageOptions("note, todo", undefined).types]).toEqual(["note", "todo"]);
  });

  it("reads a type as the one Obsidian draws it as", () => {
    expect([...readPassageOptions(["caution", "FAQ"], "both").types]).toEqual([
      "warning",
      "question"
    ]);
  });

  it("reads anything else as the defaults: every type, callouts and highlights", () => {
    const options = readPassageOptions(42, "everything");
    expect(options.types.size).toBe(0);
    expect(options.show).toBe("both");
  });

  it("opens notes for reading only when it was set", () => {
    expect(opensPassageForReading(true)).toBe(true);
    expect(opensPassageForReading("true")).toBe(true);
    for (const value of [false, undefined, null, "yes", 1]) {
      expect(opensPassageForReading(value)).toBe(false);
    }
  });
});

describe("passageCards", () => {
  const passages = (types: string[], highlights: number): NotePassages => ({
    callouts: types.map((type, line) => ({ type, line, endLine: line, markdown: `> [!${type}]` })),
    highlights: Array.from({ length: highlights }, (_, index) => ({
      line: 100 + index,
      markdown: "==x=="
    }))
  });
  const notes = [
    { path: "a.md", passages: passages(["warning", "tip"], 2) },
    { path: "b.md", passages: passages(["note"], 0) }
  ];

  it("draws each callout as a card and a note's highlights on one, in the base's order", () => {
    const { cards } = passageCards(notes, readPassageOptions([], "both"));
    expect(cards.map((card) => `${card.path}:${card.kind}`)).toEqual([
      "a.md:callout",
      "a.md:callout",
      "a.md:highlights",
      "b.md:callout"
    ]);
  });

  it("shows only the callout types asked for, and only what the view shows", () => {
    expect(passageCards(notes, readPassageOptions(["note"], "both")).cards).toHaveLength(2);
    expect(passageCards(notes, readPassageOptions([], "callouts")).cards).toHaveLength(3);
    expect(passageCards(notes, readPassageOptions([], "highlights")).cards).toHaveLength(1);
  });

  it("finds a callout written with an alias under the type it is drawn as", () => {
    const aliased = [{ path: "c.md", passages: passages(["caution", "note"], 0) }];
    const { cards } = passageCards(aliased, readPassageOptions(["warning"], "callouts"));
    expect(cards).toHaveLength(1);
  });

  it("leaves a highlight in a shown callout to its callout card", () => {
    const found = findPassages("> [!warning] Frist\n> ==Ende Mai==\n\nSonst ==hier==");
    const note = [{ path: "d.md", passages: found }];
    const both = passageCards(note, readPassageOptions([], "both")).cards;
    expect(both.map((card) => card.kind)).toEqual(["callout", "highlights"]);
    const highlighted = both[1];
    expect(highlighted?.kind === "highlights" ? highlighted.lines.map((l) => l.line) : []).toEqual([
      3
    ]);
    // Not shown as a callout, its highlight is the highlight card's again.
    const tips = passageCards(note, readPassageOptions(["tip"], "both")).cards;
    expect(tips[0]?.kind === "highlights" ? tips[0].lines : []).toHaveLength(2);
  });

  it("stops at the room left and counts what it held back", () => {
    const result = passageCards(notes, readPassageOptions([], "both"), 2);
    expect(result.cards).toHaveLength(2);
    expect(result.held).toBe(2);
  });
});
