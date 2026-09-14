import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import { applyPlan, planApply } from "./suggestion";
import { sourceUrlFromNote } from "./sync-source";
import {
  buildSyncSuggestions,
  hashText,
  isRemoteChange,
  localState,
  nextSyncRecord,
  normalizeNewlines,
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
