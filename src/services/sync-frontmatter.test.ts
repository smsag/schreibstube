import { describe, expect, it } from "vitest";
import { applyPlan, planApply } from "./suggestion";
import { buildSyncSuggestions, splitNote } from "./sync-document";
import {
  firstHeading,
  formatUpdatedAt,
  planFrontmatterEdit,
  planSyncFrontmatter,
  SYNC_TITLE_KEY,
  SYNC_UPDATED_KEY
} from "./sync-frontmatter";

const NOW = new Date(2026, 8, 13, 7, 5, 9);

function plan(overrides: Partial<Parameters<typeof planSyncFrontmatter>[0]> = {}) {
  return planSyncFrontmatter({
    frontmatter: undefined,
    remoteBody: "# Exposé Musterstraße 4\n\nEin Text.\n",
    noteBody: "",
    remoteChanged: false,
    now: NOW,
    ...overrides
  });
}

describe("the title a check writes", () => {
  it("is the document's first heading", () => {
    expect(plan()).toEqual({ [SYNC_TITLE_KEY]: "Exposé Musterstraße 4" });
  });

  it("survives whatever the person put there", () => {
    // The rule this feature turns on: a title in the file belongs to whoever
    // wrote it, and a check on a timer must never undo that.
    const kept = plan({ frontmatter: { title: "Mein eigener Titel" } });

    expect(kept[SYNC_TITLE_KEY]).toBeUndefined();
  });

  it("is written for a note whose title key is empty or not a title", () => {
    // YAML turns a bare key into null, and neither a list nor a boolean is a
    // name — none of them is something to leave a note called.
    expect(plan({ frontmatter: { title: null } })[SYNC_TITLE_KEY]).toBe("Exposé Musterstraße 4");
    expect(plan({ frontmatter: { title: "  " } })[SYNC_TITLE_KEY]).toBe("Exposé Musterstraße 4");
    expect(plan({ frontmatter: { title: ["a"] } })[SYNC_TITLE_KEY]).toBe("Exposé Musterstraße 4");
  });

  it("falls back to the note's own heading when nothing was fetched", () => {
    const fromNote = plan({ remoteBody: null, noteBody: "# Was die Notiz sagt\n" });

    expect(fromNote[SYNC_TITLE_KEY]).toBe("Was die Notiz sagt");
  });

  it("writes nothing when neither side names the document", () => {
    expect(plan({ remoteBody: "Nur Text, keine Überschrift.\n", noteBody: "" })).toEqual({});
  });

  it("ignores a heading inside a code fence, as the heading stack does", () => {
    const fenced = plan({ remoteBody: "```bash\n# nur ein Kommentar\n```\n\n# Der Titel\n" });

    expect(fenced[SYNC_TITLE_KEY]).toBe("Der Titel");
  });

  it("takes the heading as it reads, without its markup", () => {
    expect(firstHeading("# Ein **fetter** [Link](https://x.test)\n")).toBe("Ein fetter Link");
  });

  it("leaves out the HTML a README puts in its heading", () => {
    // GitHub READMEs put their logo inline, and the tag became the title.
    expect(firstHeading('# <img src="assets/logo.svg" alt="" width="28"> Pythia\n')).toBe("Pythia");
  });

  it("is no title when the heading is nothing but HTML", () => {
    expect(firstHeading('# <img src="logo.svg">\n')).toBeNull();
  });

  it("takes the first level-one heading, not a deeper one above it", () => {
    expect(firstHeading("## Unterpunkt\n\n# Der Titel\n")).toBe("Der Titel");
  });
});

describe("the date a check writes", () => {
  it("is stamped when the source changed", () => {
    expect(plan({ remoteChanged: true })[SYNC_UPDATED_KEY]).toBe("2026-09-13T07:05:09");
  });

  it("is left alone when the source did not", () => {
    expect(plan({ remoteChanged: false })[SYNC_UPDATED_KEY]).toBeUndefined();
  });

  it("is stamped over whatever is there, unlike the title", () => {
    // The date says when the document last changed, which is not an opinion
    // somebody can hold: if the source moved, the date moves.
    const stamped = plan({
      frontmatter: { title: "Bleibt", updatedAt: "2001-01-01T00:00:00" },
      remoteChanged: true
    });

    expect(stamped[SYNC_UPDATED_KEY]).toBe("2026-09-13T07:05:09");
    expect(stamped[SYNC_TITLE_KEY]).toBeUndefined();
  });

  it("is written the way Obsidian reads a datetime, and sorts as text", () => {
    const early = formatUpdatedAt(new Date(2026, 0, 2, 3, 4, 5));
    const late = formatUpdatedAt(new Date(2026, 8, 13, 7, 5, 9));

    expect(early).toBe("2026-01-02T03:04:05");
    expect(early < late).toBe(true);
  });
});

describe("the date on a source seen for the first time", () => {
  it("is stamped, because a document arriving is the version a note starts from", () => {
    // Read literally, "after the first change" would leave a note with no date
    // at all until its source happened to move, which may be never.
    expect(plan({ remoteChanged: true })[SYNC_UPDATED_KEY]).toBe("2026-09-13T07:05:09");
  });
});

const BOUND =
  "---\nschreibstubeSyncedFrom: https://raw.githubusercontent.com/o/r/main/README.md\n---\n";

function edit(noteText: string, plan: Parameters<typeof planFrontmatterEdit>[1]): string | null {
  const change = planFrontmatterEdit(noteText, plan);
  return change === null
    ? null
    : noteText.slice(0, change.from) + change.text + noteText.slice(change.to);
}

describe("properties written into an open note", () => {
  it("are added at the end of the block, the rest left as it was spelled", () => {
    expect(edit(BOUND, { title: "Pythia", updatedAt: "2026-09-17T09:55:06" })).toBe(
      "---\nschreibstubeSyncedFrom: https://raw.githubusercontent.com/o/r/main/README.md\n" +
        "title: Pythia\nupdatedAt: 2026-09-17T09:55:06\n---\n"
    );
  });

  it("replace the date that is there", () => {
    const note = "---\nupdatedAt: 2001-01-01T00:00:00\ntags: [a]\n---\nText\n";

    expect(edit(note, { updatedAt: "2026-09-17T09:55:06" })).toBe(
      "---\nupdatedAt: 2026-09-17T09:55:06\ntags: [a]\n---\nText\n"
    );
  });

  it("never replace a title the editor already holds", () => {
    // The metadata cache can lag behind the editor; the text is the truth.
    expect(planFrontmatterEdit("---\ntitle: Meiner\n---\n", { title: "Pythia" })).toBeNull();
    expect(edit("---\ntitle:\n---\n", { title: "Pythia" })).toBe("---\ntitle: Pythia\n---\n");
  });

  it("quote a title YAML would read as something else", () => {
    expect(edit(BOUND, { title: "Pythia: KI im Vault" })).toContain(
      'title: "Pythia: KI im Vault"\n'
    );
    expect(edit(BOUND, { title: "2026" })).toContain('title: "2026"\n');
    expect(edit(BOUND, { title: "Exposé Musterstraße 4" })).toContain(
      "title: Exposé Musterstraße 4\n"
    );
  });

  it("are left to Obsidian when the note has no block or the key spans lines", () => {
    expect(planFrontmatterEdit("# Nur Text\n", { title: "X" })).toBeNull();
    expect(planFrontmatterEdit("---\nupdatedAt:\n  - a\n---\n", { updatedAt: "x" })).toBeNull();
  });

  it("leave a whole accepted document in the note on a first sync", () => {
    // The note this was found on: bound, empty, and the source a README. The
    // properties go in first, the cards are measured after, and accepting
    // every card leaves the note holding the document below its properties.
    const readme = '# <img src="logo.svg"> Pythia\n\nAn Obsidian plugin.\n\n---\n\nMore.\n';
    const noted = edit(BOUND, { title: "Pythia", updatedAt: "2026-09-17T09:55:06" }) ?? "";
    const cards = buildSyncSuggestions({ noteText: noted, remoteBody: readme, state: "unsynced" });
    const accepted = applyPlan(noted, planApply(noted, cards));

    expect(splitNote(accepted)).toEqual({ frontmatter: noted, body: readme });
  });
});
