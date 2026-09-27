import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import {
  applyPlan,
  planApply,
  refreshStaleness,
  settleStatuses,
  type Suggestion
} from "./suggestion";
import { sourceUrlFromNote } from "./sync-source";
import {
  buildSyncSuggestions,
  hashText,
  hasWaitingUpdate,
  isRemoteChange,
  localState,
  nextSyncRecord,
  normalizeNewlines,
  redrawSyncCards,
  settledByContent,
  splitNote,
  stripRemoteFrontmatter,
  type SyncRecord
} from "./sync-document";

// A card explains itself to a person, so the line is translated; the suite
// fixes a language rather than asserting whichever one happens to be set.
setLanguage("en");

const NOTE = `---
schreibstubeSyncedFrom: https://example.com/a.md
---

# Titel

Erster Absatz.
`;

function record(body: string): SyncRecord {
  return { hash: hashText(body), etag: "", checkedAt: 0 };
}

describe("splitNote", () => {
  it("separates frontmatter from body", () => {
    const parts = splitNote(NOTE);
    expect(parts.frontmatter).toContain("schreibstubeSyncedFrom");
    expect(parts.body).toBe("\n# Titel\n\nErster Absatz.\n");
  });

  it("reconstructs the note exactly", () => {
    const parts = splitNote(NOTE);
    expect(parts.frontmatter + parts.body).toBe(NOTE);
  });

  it("does not count a newline after a block that ends the note", () => {
    // Counted, every card's offset sat one past the end of the note.
    const text = "---\nschreibstubeSyncedFrom: https://example.com/a.md\n---";
    expect(splitNote(text)).toEqual({ frontmatter: text, body: "" });
  });

  it("handles a note with no frontmatter", () => {
    expect(splitNote("# Titel\n")).toEqual({ frontmatter: "", body: "# Titel\n" });
  });

  it("does not treat a horizontal rule as frontmatter", () => {
    const text = "Text\n\n---\n\nMehr\n";
    expect(splitNote(text).frontmatter).toBe("");
  });

  it("treats an unterminated block as body", () => {
    const text = "---\nkaputt: ja\n";
    expect(splitNote(text)).toEqual({ frontmatter: "", body: text });
  });
});

describe("stripRemoteFrontmatter", () => {
  it("removes the remote file's own frontmatter", () => {
    expect(stripRemoteFrontmatter("---\ntitle: Remote\n---\n\n# Inhalt\n")).toBe("\n# Inhalt\n");
  });

  it("leaves a file without frontmatter alone", () => {
    expect(stripRemoteFrontmatter("# Inhalt\n")).toBe("# Inhalt\n");
  });

  it("normalizes CRLF so line endings are not a change", () => {
    expect(stripRemoteFrontmatter("a\r\nb\r\n")).toBe("a\nb\n");
  });
});

describe("normalizeNewlines", () => {
  it("converts CRLF", () => {
    expect(normalizeNewlines("a\r\nb")).toBe("a\nb");
  });
});

describe("hashText", () => {
  it("is stable for the same text", () => {
    expect(hashText("Hallo Welt")).toBe(hashText("Hallo Welt"));
  });

  it("differs for different text", () => {
    expect(hashText("Hallo Welt")).not.toBe(hashText("Hallo  Welt"));
  });

  it("handles empty text", () => {
    expect(hashText("")).toHaveLength(8);
  });
});

describe("localState", () => {
  const body = splitNote(NOTE).body;

  it("is unsynced with no record", () => {
    expect(localState(body, undefined)).toBe("unsynced");
  });

  it("is clean when the body matches the record", () => {
    expect(localState(body, record(body))).toBe("clean");
  });

  it("is diverged after a local edit", () => {
    expect(localState(`${body}Neue Zeile.\n`, record(body))).toBe("diverged");
  });
});

describe("buildSyncSuggestions", () => {
  const body = splitNote(NOTE).body;

  it("returns nothing when the note already matches the source", () => {
    expect(buildSyncSuggestions({ noteText: NOTE, remoteBody: body, state: "clean" })).toEqual([]);
  });

  it("offsets cards past the note's own frontmatter", () => {
    const remote = body.replace("Erster Absatz.", "Erster Absatz, überarbeitet.");
    const [suggestion] = buildSyncSuggestions({
      noteText: NOTE,
      remoteBody: remote,
      state: "clean"
    });
    expect(NOTE.slice(suggestion?.from, suggestion?.to)).toBe(suggestion?.original);
  });

  it("never touches the binding when a card is applied", () => {
    const remote = body.replace("# Titel", "# Neuer Titel");
    const suggestions = buildSyncSuggestions({
      noteText: NOTE,
      remoteBody: remote,
      state: "clean"
    });
    const updated = applyPlan(NOTE, planApply(NOTE, suggestions));
    expect(updated).toContain("schreibstubeSyncedFrom: https://example.com/a.md");
    expect(updated).toContain("# Neuer Titel");
  });

  it("reproduces the source exactly when every card is accepted", () => {
    const remote = "\n# Ganz neu\n\nAnderer Text.\n\nNoch einer.\n";
    const suggestions = buildSyncSuggestions({
      noteText: NOTE,
      remoteBody: remote,
      state: "clean"
    });
    const updated = applyPlan(NOTE, planApply(NOTE, suggestions));
    expect(splitNote(updated).body).toBe(remote);
  });

  it("handles a source that grew a new section", () => {
    const remote = `${body}\n## Neu\n\nInhalt.\n`;
    const suggestions = buildSyncSuggestions({
      noteText: NOTE,
      remoteBody: remote,
      state: "clean"
    });
    expect(splitNote(applyPlan(NOTE, planApply(NOTE, suggestions))).body).toBe(remote);
  });

  it("handles a source that lost a section", () => {
    const long = `${body}\n## Alt\n\nEntfällt.\n`;
    const note = splitNote(NOTE).frontmatter + long;
    const suggestions = buildSyncSuggestions({ noteText: note, remoteBody: body, state: "clean" });
    expect(splitNote(applyPlan(note, planApply(note, suggestions))).body).toBe(body);
  });

  it("marks cards for review when the note diverged locally", () => {
    const remote = body.replace("Erster Absatz.", "Anders.");
    const [suggestion] = buildSyncSuggestions({
      noteText: NOTE,
      remoteBody: remote,
      state: "diverged"
    });
    expect(suggestion?.needsReview).toBe(true);
    expect(suggestion?.note).toContain("Edited locally");
  });

  it("explains the first sync", () => {
    const remote = body.replace("Erster Absatz.", "Anders.");
    const [suggestion] = buildSyncSuggestions({
      noteText: NOTE,
      remoteBody: remote,
      state: "unsynced"
    });
    expect(suggestion?.note).toContain("First comparison");
  });

  it("says nothing extra for a clean note", () => {
    const remote = body.replace("Erster Absatz.", "Anders.");
    const [suggestion] = buildSyncSuggestions({
      noteText: NOTE,
      remoteBody: remote,
      state: "clean"
    });
    expect(suggestion?.note).toBe("");
    expect(suggestion?.needsReview).toBe(false);
  });

  it("fills an empty note from the source", () => {
    const note = "---\nschreibstubeSyncedFrom: https://example.com/a.md\n---\n";
    const remote = "# Inhalt\n\nText.\n";
    const suggestions = buildSyncSuggestions({
      noteText: note,
      remoteBody: remote,
      state: "unsynced"
    });
    expect(splitNote(applyPlan(note, planApply(note, suggestions))).body).toBe(remote);
  });

  it("carries the remote source onto every card", () => {
    const remote = body.replace("Erster Absatz.", "Anders.");
    const suggestions = buildSyncSuggestions({
      noteText: NOTE,
      remoteBody: remote,
      state: "clean"
    });
    expect(suggestions.every((s) => s.source === "remote" && s.category === "update")).toBe(true);
  });
});

describe("nextSyncRecord", () => {
  const body = "Ein Text.\n";
  const remote = "Ein anderer Text.\n";
  const T = Date.UTC(2026, 8, 13, 9, 0);

  function record(over: Partial<SyncRecord> = {}): SyncRecord {
    return { hash: hashText(body), etag: "e1", checkedAt: 0, pendingChanges: 0, ...over };
  }

  it("counts a source seen for the first time as a change", () => {
    const next = nextSyncRecord({
      record: undefined,
      body,
      remoteBody: remote,
      etag: "e2",
      checkedAt: T,
      pendingChanges: 1,
      settled: false
    });

    expect(next.changedAt).toBe(T);
    expect(next.remoteHash).toBe(hashText(remote));
  });

  it("counts nothing for a record that predates the hash, and adopts one", () => {
    // The one case that made the pane say something had come in when nothing
    // had: every note bound before the plugin kept a hash of its source had no
    // baseline, and no baseline was being read as "this is new". It is a fact
    // about the bookkeeping, not about the document.
    const next = nextSyncRecord({
      record: record({ checkedAt: 5 }),
      body,
      remoteBody: remote,
      etag: "e2",
      checkedAt: T,
      pendingChanges: 0,
      settled: true
    });

    expect(next.changedAt).toBeUndefined();
    expect(next.remoteHash).toBe(hashText(remote));
  });

  it("counts the next real change after adopting a hash", () => {
    const adopted = nextSyncRecord({
      record: record({ checkedAt: 5 }),
      body,
      remoteBody: remote,
      etag: "e2",
      checkedAt: T,
      pendingChanges: 0,
      settled: true
    });

    const moved = nextSyncRecord({
      record: adopted,
      body,
      remoteBody: `${remote}\n\nEin Absatz mehr.`,
      etag: "e3",
      checkedAt: T + 1000,
      pendingChanges: 1,
      settled: false
    });

    expect(moved.changedAt).toBe(T + 1000);
  });

  it("counts nothing when the source came back the same", () => {
    const next = nextSyncRecord({
      record: record({ remoteHash: hashText(remote), changedAt: 5 }),
      body,
      remoteBody: remote,
      etag: "e2",
      checkedAt: T,
      pendingChanges: 0,
      settled: true
    });

    expect(next.changedAt).toBe(5);
  });

  it("counts a source whose text moved, whatever the validator said", () => {
    // Once changes are waiting the fetch is unconditional, so "changed" from
    // the response means nothing; the hash is what answers.
    const next = nextSyncRecord({
      record: record({ remoteHash: hashText("etwas anderes"), changedAt: 5 }),
      body,
      remoteBody: remote,
      etag: "e2",
      checkedAt: T,
      pendingChanges: 2,
      settled: false
    });

    expect(next.changedAt).toBe(T);
  });

  it("keeps what it knew when nothing was fetched", () => {
    const next = nextSyncRecord({
      record: record({ remoteHash: "abc", changedAt: 5 }),
      body,
      remoteBody: null,
      etag: "e2",
      checkedAt: T,
      pendingChanges: 0,
      settled: false
    });

    expect(next.remoteHash).toBe("abc");
    expect(next.changedAt).toBe(5);
  });

  it("advances the baseline only once the note matches its source", () => {
    const settled = nextSyncRecord({
      record: record({ hash: "alt" }),
      body,
      remoteBody: remote,
      etag: "e2",
      checkedAt: T,
      pendingChanges: 0,
      settled: true
    });
    const waiting = nextSyncRecord({
      record: record({ hash: "alt" }),
      body,
      remoteBody: remote,
      etag: "e2",
      checkedAt: T,
      pendingChanges: 3,
      settled: false
    });

    expect(settled.hash).toBe(hashText(body));
    expect(waiting.hash).toBe("alt");
  });
});

describe("sourceUrlFromNote", () => {
  it("reads the binding the cache has not caught up with yet", () => {
    const note = [
      "---",
      "schreibstubeSyncedFrom: https://example.test/a.md",
      "---",
      "",
      "Text"
    ].join("\n");

    expect(sourceUrlFromNote(note)).toBe("https://example.test/a.md");
  });

  it("takes the quotes off a value that has them", () => {
    const note = ["---", 'schreibstubeSyncedFrom: "https://example.test/a.md"', "---"].join("\n");

    expect(sourceUrlFromNote(note)).toBe("https://example.test/a.md");
  });

  it("says nothing for a note with no frontmatter or no binding", () => {
    expect(sourceUrlFromNote("Nur Text")).toBeNull();
    expect(sourceUrlFromNote(["---", "title: X", "---"].join("\n"))).toBeNull();
  });
});

describe("what stamps a note's updatedAt", () => {
  const remote = "# Titel\n\nEin Text.\n";

  function record(over: Partial<SyncRecord> = {}): SyncRecord {
    return { hash: "h", etag: "e", checkedAt: 0, pendingChanges: 0, ...over };
  }

  it("says yes to a source never fetched before", () => {
    expect(isRemoteChange(undefined, remote)).toBe(true);
  });

  it("says no to a record that has no baseline to compare against", () => {
    expect(isRemoteChange(record(), remote)).toBe(false);
  });

  it("says no when the source is what it was", () => {
    expect(isRemoteChange(record({ remoteHash: hashText(remote) }), remote)).toBe(false);
  });

  it("says yes when the source is not what it was", () => {
    expect(isRemoteChange(record({ remoteHash: "etwas anderes" }), remote)).toBe(true);
  });

  it("says no when nothing came back at all", () => {
    expect(isRemoteChange(record({ remoteHash: "abc" }), null)).toBe(false);
  });
});

describe("hasWaitingUpdate", () => {
  const base = { etag: "", checkedAt: 1, pendingChanges: 0 };

  it("is true while the source has moved past the note", () => {
    expect(hasWaitingUpdate({ ...base, hash: hashText("old"), remoteHash: hashText("new") })).toBe(
      true
    );
  });

  it("is false once the note is level with the source", () => {
    expect(hasWaitingUpdate({ ...base, hash: hashText("new"), remoteHash: hashText("new") })).toBe(
      false
    );
  });

  it("is false for a note with only edits of its own", () => {
    // Local edits move the note, not the baseline: nothing came from the source.
    const record = nextSyncRecord({
      record: { ...base, hash: hashText("text"), remoteHash: hashText("text") },
      body: "text, edited here",
      remoteBody: "text",
      etag: "e",
      checkedAt: 2,
      pendingChanges: 1,
      settled: false
    });
    expect(hasWaitingUpdate(record)).toBe(false);
  });

  it("is true for a source fetched for the first time into a different note", () => {
    const record = nextSyncRecord({
      record: undefined,
      body: "draft",
      remoteBody: "published",
      etag: "e",
      checkedAt: 2,
      pendingChanges: 1,
      settled: false
    });
    expect(hasWaitingUpdate(record)).toBe(true);
  });

  it("claims nothing for a record that never hashed its source", () => {
    expect(hasWaitingUpdate({ ...base, hash: "h" })).toBe(false);
    expect(hasWaitingUpdate(undefined)).toBe(false);
  });
});

// ── An update taken one card at a time leaves "Extern aktualisiert" ─────────

describe("taking an update one card at a time", () => {
  const note = "---\nschreibstubeSyncedFrom: x\n---\nIntro line.\nOld sentence here.\nEnd.\n";
  const remote = "Intro line.\nNew sentence here.\nEnd.\nAdded paragraph.\n";

  /** Accept one card the way the panel does: plan, apply, settle, re-anchor. */
  function accept(text: string, cards: Suggestion[], card: Suggestion) {
    const plan = planApply(text, [card]);
    const next = applyPlan(text, plan);
    const applied = new Set(plan.changes.map((change) => change.id));
    return { next, cards: refreshStaleness(next, settleStatuses(cards, plan, applied)) };
  }

  it("left the insertion below an accepted card stale when the cards were re-found", () => {
    const cards = buildSyncSuggestions({ noteText: note, remoteBody: remote, state: "clean" });
    const after = accept(note, cards, cards[0]!);
    // The bug this fixes: an insertion placed by the text in front of it
    // loses that text when the card above it is taken, and cannot be taken.
    expect(after.cards.map((card) => card.status)).toEqual(["accepted", "stale"]);
  });

  it("finishes the update when the rest is drawn again, and the note leaves the list", () => {
    const record: SyncRecord = {
      hash: hashText(splitNote(note).body),
      etag: "",
      checkedAt: 1,
      remoteHash: hashText(remote),
      changedAt: 1
    };
    expect(hasWaitingUpdate(record)).toBe(true);

    let text = note;
    let cards = buildSyncSuggestions({ noteText: text, remoteBody: remote, state: "clean" });
    for (let round = 0; round < 5; round++) {
      const next = cards.find((card) => card.source === "remote" && card.status === "pending");
      if (!next) break;
      const step = accept(text, cards, next);
      text = step.next;
      cards = redrawSyncCards(step.cards, { noteText: text, remoteBody: remote, state: "clean" });
      expect(cards.some((card) => card.status === "stale")).toBe(false);
    }

    expect(splitNote(text).body).toBe(remote);
    const settled = settledByContent(record, splitNote(text).body);
    expect(settled).not.toBeNull();
    expect(hasWaitingUpdate(settled!)).toBe(false);
  });

  it("keeps every card that did not come from the source", () => {
    const proofread: Suggestion = {
      id: "p",
      status: "pending",
      kind: "replace",
      source: "llm",
      category: "spelling",
      severity: "suggestion",
      from: 40,
      to: 45,
      original: "Intro",
      replacement: "Intro",
      note: ""
    } as Suggestion;
    const redrawn = redrawSyncCards([proofread], {
      noteText: note,
      remoteBody: remote,
      state: "clean"
    });
    expect(redrawn.filter((card) => card.source !== "remote")).toEqual([proofread]);
    expect(redrawn.filter((card) => card.source === "remote")).toHaveLength(2);
  });
});

describe("settledByContent", () => {
  const record: SyncRecord = {
    hash: hashText("old\n"),
    etag: "e",
    checkedAt: 1,
    pendingChanges: 2,
    remoteHash: hashText("new\n"),
    changedAt: 1
  };

  it("settles a waiting note whose body is the source as last seen, however it got there", () => {
    expect(settledByContent(record, "new\n")).toEqual({
      ...record,
      hash: hashText("new\n"),
      pendingChanges: 0
    });
  });

  it("leaves a note that still differs, and one that was not waiting", () => {
    expect(settledByContent(record, "new")).toBeNull();
    expect(settledByContent({ ...record, hash: record.remoteHash! }, "new\n")).toBeNull();
    expect(settledByContent(undefined, "new\n")).toBeNull();
    const { remoteHash: _unused, ...unhashed } = record;
    expect(settledByContent(unhashed, "new\n")).toBeNull();
  });
});
