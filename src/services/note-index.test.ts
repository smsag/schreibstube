import { describe, expect, it } from "vitest";
import { scanHeadings } from "./heading-index";
import {
  applyLineEdit,
  buildNoteIndex,
  collapseEdit,
  MAX_INDEX_ENTRIES,
  parseNoteIndexOptions
} from "./note-index";

const never = () => false;

describe("buildNoteIndex", () => {
  it("lists the note's headings to the depth asked for, with their lines", () => {
    const note = [
      "# Exposé",
      "",
      "```schreibstube-index",
      "```",
      "## Lage",
      "### Mikrolage",
      "## Preis"
    ].join("\n");
    expect(buildNoteIndex(note, 2, never)).toEqual({
      kind: "entries",
      entries: [
        { text: "Exposé", line: 0, indent: 0 },
        { text: "Lage", line: 4, indent: 1 },
        { text: "Preis", line: 6, indent: 1 }
      ]
    });
  });

  it("lists headings above the block as well as below it", () => {
    const note = "## Vorher\n\n```schreibstube-index\n```\n\n## Nachher";
    const plan = buildNoteIndex(note, 2, never);
    expect(plan.kind === "entries" && plan.entries.map((e) => e.text)).toEqual([
      "Vorher",
      "Nachher"
    ]);
  });

  it("passes over headings in fences and frontmatter, and drops their markup", () => {
    const note = [
      "---",
      "# yaml",
      "---",
      "```sh",
      "# prompt",
      "```",
      "## **Fett** und [Link](x)"
    ].join("\n");
    const plan = buildNoteIndex(note, 2, never);
    expect(plan.kind === "entries" && plan.entries).toEqual([
      { text: "Fett und Link", line: 6, indent: 0 }
    ]);
  });

  it("keeps two headings with the same words apart by their lines", () => {
    const plan = buildNoteIndex("## Notizen\ntext\n## Notizen", 2, never);
    expect(plan.kind === "entries" && plan.entries.map((e) => e.line)).toEqual([0, 2]);
  });

  it("is empty when no heading is shallow enough", () => {
    expect(buildNoteIndex("### Tief\ntext", 2, never)).toEqual({ kind: "empty" });
  });

  it("refuses a list longer than the limit and names a depth that fits", () => {
    const note = [
      "# Teil",
      ...Array.from({ length: MAX_INDEX_ENTRIES }, (_, i) => `## Abschnitt ${i}`)
    ].join("\n");
    expect(buildNoteIndex(note, 2, never)).toEqual({
      kind: "too-long",
      count: MAX_INDEX_ENTRIES + 1,
      fits: 1
    });
  });

  it("gives up when the time is up, rather than holding the editor", () => {
    const note = Array.from({ length: 2000 }, (_, i) => `## H${i}`).join("\n");
    expect(buildNoteIndex(note, 2, () => true)).toEqual({ kind: "too-slow" });
  });

  it("finishes a short note without looking at the clock", () => {
    let looked = 0;
    const plan = buildNoteIndex("## A\n## B", 2, () => {
      looked += 1;
      return true;
    });
    expect(plan.kind).toBe("entries");
    expect(looked).toBe(0);
  });
});

describe("scanHeadings", () => {
  it("looks at the clock as it goes, and stops when told to", () => {
    const note = Array.from({ length: 1000 }, (_, i) => `## H${i}`).join("\n");
    let looked = 0;
    const result = scanHeadings(note, () => {
      looked += 1;
      return looked === 2;
    });
    expect(result).toBeNull();
    expect(looked).toBe(2);
  });
});

describe("parseNoteIndexOptions", () => {
  it("does not read a setting past the first twenty lines", () => {
    const source = [...Array.from({ length: 20 }, () => "// filler"), "depth: 4"].join("\n");
    expect(parseNoteIndexOptions(source)).toEqual({
      depth: 2,
      collapsed: false,
      unreadableLine: 21
    });
  });
});

describe("collapseEdit", () => {
  const note = ["# Titel", "```schreibstube-index", "depth: 3", "```", "text"].join("\n");

  it("adds the collapsed line to fold the index", () => {
    expect(collapseEdit(note, 1, 3, "depth: 3", true)).toEqual({
      fromLine: 2,
      toLine: 3,
      text: "depth: 3\ncollapsed: true\n",
      source: "depth: 3\ncollapsed: true",
      block: { lineStart: 1, lineEnd: 4 }
    });
  });

  it("takes the line out again to unfold it, whatever it said", () => {
    const folded = note.replace("depth: 3", "depth: 3\n  Collapsed: true");
    expect(collapseEdit(folded, 1, 4, "depth: 3\n  Collapsed: true", false)).toEqual({
      fromLine: 2,
      toLine: 4,
      text: "depth: 3\n",
      source: "depth: 3",
      block: { lineStart: 1, lineEnd: 3 }
    });
  });

  it("does not write a second collapsed line", () => {
    const folded = note.replace("depth: 3", "collapsed: false\ndepth: 3");
    expect(collapseEdit(folded, 1, 4, "collapsed: false\ndepth: 3", true)?.text).toBe(
      "depth: 3\ncollapsed: true\n"
    );
  });

  it("writes into an empty block", () => {
    const empty = "~~~~schreibstube-index\n~~~~";
    expect(collapseEdit(empty, 0, 1, "", true)).toMatchObject({
      fromLine: 1,
      toLine: 1,
      text: "collapsed: true\n"
    });
    expect(collapseEdit(empty, 0, 1, "", false)).toMatchObject({
      fromLine: 1,
      toLine: 1,
      text: ""
    });
  });

  it("keeps the line inside a list item, at the block's indent", () => {
    // Unindented, the line ended the list item, closed the fence early, and
    // the indented closing fence opened a new one that swallowed the note.
    const listed = "- Objekt\n\n  ```schreibstube-index\n  depth: 3\n  ```\n\nMehr";
    const edit = collapseEdit(listed, 0, 4, "depth: 3", true);
    expect(edit && applyLineEdit(listed, edit)).toBe(
      "- Objekt\n\n  ```schreibstube-index\n  depth: 3\n  collapsed: true\n  ```\n\nMehr"
    );
  });

  it("keeps the line inside a callout, behind its marks", () => {
    const quoted = "> [!note] Inhalt\n> ```schreibstube-index\n> collapsed: true\n> ```\n\nText";
    const edit = collapseEdit(quoted, 0, 3, "collapsed: true", false);
    expect(edit && applyLineEdit(quoted, edit)).toBe(
      "> [!note] Inhalt\n> ```schreibstube-index\n> ```\n\nText"
    );
    const open = edit && applyLineEdit(quoted, edit);
    const again = open && collapseEdit(open, 0, 2, "", true);
    expect(again && applyLineEdit(open, again)).toBe(quoted);
  });

  it("finds the block pressed among others in the same section by its text", () => {
    const two = [
      "- ```schreibstube-index",
      "  depth: 1",
      "  ```",
      "- ```schreibstube-index",
      "  depth: 3",
      "  ```"
    ].join("\n");
    const edit = collapseEdit(two, 0, 5, "depth: 3", true);
    expect(edit).toMatchObject({ fromLine: 4, toLine: 5, text: "  depth: 3\n  collapsed: true\n" });
  });

  it("writes nothing when the block pressed cannot be told apart, or is gone", () => {
    const twins = "```schreibstube-index\n```\n\n```schreibstube-index\n```";
    expect(collapseEdit(twins, 0, 4, "", true)).toBeNull();
    expect(collapseEdit(note, 1, 3, "depth: 2", true)).toBeNull();
    expect(
      collapseEdit(note.replace("schreibstube-index", "js"), 1, 3, "depth: 3", true)
    ).toBeNull();
    expect(collapseEdit(note, 1, 2, "depth: 3", true)).toBeNull();
    expect(collapseEdit("```schreibstube-index\n~~~", 0, 1, "", true)).toBeNull();
    expect(collapseEdit("````schreibstube-index\n```", 0, 1, "", true)).toBeNull();
    expect(collapseEdit("```schreibstube-index\n``` text", 0, 1, "", true)).toBeNull();
  });

  it("passes over an index block quoted in another fence", () => {
    const quoted = "````md\n```schreibstube-index\n```\n````";
    expect(collapseEdit(quoted, 0, 3, "", true)).toBeNull();
  });
});

describe("applyLineEdit", () => {
  it("folds the block in the note and leaves the rest alone", () => {
    const note = "# T\n```schreibstube-index\ndepth: 3\n```\ntext";
    const edit = collapseEdit(note, 1, 3, "depth: 3", true);
    expect(edit && applyLineEdit(note, edit)).toBe(
      "# T\n```schreibstube-index\ndepth: 3\ncollapsed: true\n```\ntext"
    );
  });

  it("unfolds an emptied block to no body at all", () => {
    const note = "```schreibstube-index\ncollapsed: true\n```";
    const edit = collapseEdit(note, 0, 2, "collapsed: true", false);
    expect(edit && applyLineEdit(note, edit)).toBe("```schreibstube-index\n```");
  });

  it("keeps a note's Windows line endings", () => {
    const note = "```schreibstube-index\r\n```\r\ntext";
    const edit = collapseEdit(note, 0, 1, "", true);
    expect(edit && applyLineEdit(note, edit)).toBe(
      "```schreibstube-index\r\ncollapsed: true\r\n```\r\ntext"
    );
  });
});
