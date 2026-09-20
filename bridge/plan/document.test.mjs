import { describe, expect, it } from "vitest";
import {
  checkDocument,
  DocumentError,
  emptyDocument,
  MAX_ANCHORS,
  MAX_BLOCKS,
  MAX_COMPLETIONS,
  MAX_DEADLINES,
  MAX_DOCUMENT_BYTES,
  MAX_MEMBERS,
  MAX_QUEUE
} from "./document.mjs";

/**
 * The document arrives from four writers and one of them is a text editor, so
 * these tests are mostly about what is refused. The rule they enforce
 * throughout: a wrong shape is an error, never a coercion, and the error names
 * the field without quoting what was in it.
 */

const MEMBER = { key: "a1b2", text: "Kapitel lesen", path: "Notizen/Buch.md", remind: false };

const BLOCK = {
  uid: "block-1",
  tag: "schreiben",
  title: "Vormittag",
  start: "2026-09-20T08:00:00Z",
  end: "2026-09-20T10:00:00Z",
  calendar: "arbeit",
  members: [MEMBER]
};

const ANCHOR = { path: "Notizen/Buch.md", hash: "deadbeef", text: "Kapitel lesen", ordinal: 0 };

function document(overrides = {}) {
  return { ...emptyDocument(), ...overrides };
}

function rejects(overrides, pattern) {
  expect(() => checkDocument(document(overrides))).toThrow(pattern);
}

describe("checkDocument, the whole document", () => {
  it("accepts the empty document, so a vault that has never planned can save", () => {
    expect(checkDocument(emptyDocument())).toEqual(emptyDocument());
  });

  it("hands back exactly what it was given, filling nothing in", () => {
    const given = document({ blocks: [BLOCK] });
    expect(checkDocument(given)).toBe(given);
    expect(given.blocks[0].members[0].done).toBeUndefined();
  });

  it("throws a DocumentError rather than a bare Error", () => {
    expect(() => checkDocument(null)).toThrow(DocumentError);
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, undefined, [], "plan", 7, true]) {
      expect(() => checkDocument(value)).toThrow(/document must be an object/);
    }
  });

  it("refuses a key it does not know, naming the ones it does", () => {
    rejects({ notizen: {} }, /document has a key that is not one of: v, deadlines/);
  });

  it("refuses a document missing a section, so a save cannot drop one", () => {
    const incomplete = emptyDocument();
    delete incomplete.anchors;
    expect(() => checkDocument(incomplete)).toThrow(/document is missing anchors/);
  });

  it("refuses a version it was not written for", () => {
    rejects({ v: 2 }, /document.v must be 1/);
    rejects({ v: "1" }, /document.v must be 1/);
  });

  it("refuses a document larger than the stored limit", () => {
    const wide = document({
      anchors: Object.fromEntries(
        Array.from({ length: MAX_ANCHORS }, (_, index) => [
          `k${index}`,
          { ...ANCHOR, text: "x".repeat(400) }
        ])
      )
    });
    expect(Buffer.byteLength(JSON.stringify(wide))).toBeGreaterThan(MAX_DOCUMENT_BYTES);
    expect(() => checkDocument(wide)).toThrow(/exceeds the \d+ byte limit/);
  });

  it("never quotes a value back in its message", () => {
    const secret = "Termin beim Arzt am Dienstag";
    try {
      checkDocument(document({ blocks: [{ ...BLOCK, start: secret }] }));
      expect.unreachable();
    } catch (err) {
      expect(err.message).not.toContain(secret);
      expect(err.message).toContain("blocks[0].start");
    }
  });
});

describe("checkDocument, deadlines", () => {
  it("accepts a tag with slashes, underscores and dashes", () => {
    const deadlines = { "buch/kapitel_3-neu": { date: "2026-12-01" } };
    expect(checkDocument(document({ deadlines }))).toBeTruthy();
  });

  it("accepts an optional capacity inside its range", () => {
    for (const capacity of [1, 25, 50]) {
      expect(checkDocument(document({ deadlines: { a: { date: "2026-01-01", capacity } } })));
    }
  });

  it("refuses a capacity outside its range, and one that is not whole", () => {
    for (const capacity of [0, 51, 2.5, "3", null]) {
      rejects({ deadlines: { a: { date: "2026-01-01", capacity } } }, /capacity/);
    }
  });

  it("refuses a key that is not a tag, without repeating it", () => {
    for (const key of ["mit leerzeichen", "umlaut-ä", "a".repeat(201), "punkt.punkt"]) {
      try {
        checkDocument(document({ deadlines: { [key]: { date: "2026-01-01" } } }));
        expect.unreachable();
      } catch (err) {
        expect(err.message).toMatch(/deadlines has a key that is not a tag/);
        expect(err.message).not.toContain(key);
      }
    }
  });

  it("refuses a date that is not a date, and one that does not exist", () => {
    rejects({ deadlines: { a: { date: "01.12.2026" } } }, /must be a date, as YYYY-MM-DD/);
    rejects({ deadlines: { a: { date: "2026-02-30" } } }, /is not a date that exists/);
    rejects({ deadlines: { a: { date: "2026-13-01" } } }, /is not a date that exists/);
  });

  it("refuses a deadline that is not an object, or carries an unknown key", () => {
    rejects({ deadlines: { a: "2026-01-01" } }, /must be an object/);
    rejects(
      { deadlines: { a: { date: "2026-01-01", farbe: "rot" } } },
      /not one of: date, capacity/
    );
  });

  it("refuses more deadlines than it will hold", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_DEADLINES + 1 }, (_, i) => [`t${i}`, { date: "2026-01-01" }])
    );
    rejects({ deadlines: many }, /deadlines holds more than 200 entries/);
  });

  it("refuses deadlines that is not an object at all", () => {
    rejects({ deadlines: [] }, /deadlines must be an object/);
  });
});

describe("checkDocument, blocks", () => {
  it("accepts a block with one member", () => {
    expect(checkDocument(document({ blocks: [BLOCK] }))).toBeTruthy();
  });

  it("accepts an empty title, because a block may be untitled", () => {
    expect(checkDocument(document({ blocks: [{ ...BLOCK, title: "" }] }))).toBeTruthy();
  });

  it("refuses an empty uid or calendar", () => {
    rejects({ blocks: [{ ...BLOCK, uid: "" }] }, /blocks\[0\].uid must not be empty/);
    rejects({ blocks: [{ ...BLOCK, calendar: "" }] }, /blocks\[0\].calendar must not be empty/);
  });

  it("refuses a start or end that is not an ISO moment", () => {
    for (const value of ["2026-09-20", "20.09.2026 08:00", "gestern", 0, null]) {
      rejects({ blocks: [{ ...BLOCK, start: value }] }, /blocks\[0\].start must be an ISO/);
    }
  });

  it("accepts the ISO spellings a client actually sends", () => {
    for (const start of [
      "2026-09-20T08:00Z",
      "2026-09-20T08:00:00Z",
      "2026-09-20T08:00:00.123Z",
      "2026-09-20T08:00:00+02:00",
      "2026-09-20T08:00:00"
    ]) {
      expect(checkDocument(document({ blocks: [{ ...BLOCK, start }] }))).toBeTruthy();
    }
  });

  it("refuses a moment that parses as a shape but not as a time", () => {
    rejects({ blocks: [{ ...BLOCK, start: "2026-09-31T08:00:00Z" }] }, /moment that exists/);
  });

  it("refuses a tag that is not a tag", () => {
    rejects({ blocks: [{ ...BLOCK, tag: "zwei wörter" }] }, /blocks\[0\].tag must be a tag/);
  });

  it("refuses a title beyond its limit", () => {
    rejects({ blocks: [{ ...BLOCK, title: "x".repeat(501) }] }, /exceeds 500 characters/);
  });

  it("refuses more blocks than it will hold", () => {
    rejects({ blocks: Array.from({ length: MAX_BLOCKS + 1 }, () => BLOCK) }, /blocks holds more/);
  });

  it("refuses blocks that is not an array", () => {
    rejects({ blocks: {} }, /blocks must be an array/);
  });
});

describe("checkDocument, block members", () => {
  const withMembers = (members) => ({ blocks: [{ ...BLOCK, members }] });

  it("refuses a key that is not a task key", () => {
    for (const key of ["a_b", "a b", "a".repeat(65), "ä"]) {
      rejects(withMembers([{ ...MEMBER, key }]), /members\[0\].key must be a task key/);
    }
  });

  it("requires remind to be a boolean rather than anything truthy", () => {
    rejects(withMembers([{ ...MEMBER, remind: "ja" }]), /remind must be true or false/);
    rejects(withMembers([{ ...MEMBER, remind: 1 }]), /remind must be true or false/);
  });

  it("allows done to be absent, but not to be a string", () => {
    expect(checkDocument(document(withMembers([{ ...MEMBER, done: true }])))).toBeTruthy();
    rejects(withMembers([{ ...MEMBER, done: "true" }]), /done must be true or false/);
  });

  it("names the member that failed, not just the block", () => {
    rejects(withMembers([MEMBER, { ...MEMBER, path: 7 }]), /blocks\[0\].members\[1\].path/);
  });

  it("refuses more members than it will hold", () => {
    const many = Array.from({ length: MAX_MEMBERS + 1 }, () => MEMBER);
    rejects(withMembers(many), /members holds more than 200/);
  });

  it("refuses a member that is missing a required field", () => {
    const without = { ...MEMBER };
    delete without.remind;
    rejects(withMembers([without]), /is missing remind/);
  });
});

describe("checkDocument, anchors", () => {
  it("accepts an anchor at ordinal zero", () => {
    expect(checkDocument(document({ anchors: { abc: ANCHOR } }))).toBeTruthy();
  });

  it("refuses a negative or fractional ordinal", () => {
    rejects({ anchors: { abc: { ...ANCHOR, ordinal: -1 } } }, /ordinal must be a whole number/);
    rejects({ anchors: { abc: { ...ANCHOR, ordinal: 1.5 } } }, /ordinal must be a whole number/);
  });

  it("refuses a key that is not a task key, without repeating it", () => {
    try {
      checkDocument(document({ anchors: { "pfad/zur/notiz": ANCHOR } }));
      expect.unreachable();
    } catch (err) {
      expect(err.message).toMatch(/anchors has a key that is not a task key/);
      expect(err.message).not.toContain("pfad");
    }
  });

  it("refuses a path or hash beyond its limit", () => {
    rejects({ anchors: { a: { ...ANCHOR, path: "x".repeat(401) } } }, /path exceeds 400/);
    rejects({ anchors: { a: { ...ANCHOR, hash: "x".repeat(65) } } }, /hash exceeds 64/);
  });

  it("refuses more anchors than it will hold", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_ANCHORS + 1 }, (_, i) => [`k${i}`, ANCHOR])
    );
    rejects({ anchors: many }, /anchors holds more than 2000/);
  });
});

describe("checkDocument, queue", () => {
  const entry = { seq: 1, op: "upsert", key: "a1" };

  it("accepts the two operations and nothing else", () => {
    expect(checkDocument(document({ queue: [entry] }))).toBeTruthy();
    expect(checkDocument(document({ queue: [{ ...entry, op: "delete" }] }))).toBeTruthy();
    rejects({ queue: [{ ...entry, op: "patch" }] }, /op must be "upsert" or "delete"/);
  });

  it("keeps a cleared due date distinguishable from an absent one", () => {
    expect(checkDocument(document({ queue: [{ ...entry, due: null }] }))).toBeTruthy();
    expect(checkDocument(document({ queue: [{ ...entry, due: "2026-03-01" }] }))).toBeTruthy();
    rejects({ queue: [{ ...entry, due: "morgen" }] }, /due must be a date/);
  });

  it("refuses a sequence number that is not a counter", () => {
    rejects({ queue: [{ ...entry, seq: -1 }] }, /seq must be a whole number/);
    rejects({ queue: [{ ...entry, seq: "1" }] }, /seq must be a whole number/);
  });

  it("bounds the optional fields", () => {
    rejects({ queue: [{ ...entry, notes: "x".repeat(4001) }] }, /notes exceeds 4000/);
    rejects({ queue: [{ ...entry, list: "x".repeat(201) }] }, /list exceeds 200/);
    rejects({ queue: [{ ...entry, title: 5 }] }, /title must be a string/);
    rejects({ queue: [{ ...entry, done: "x" }] }, /done must be true or false/);
  });

  it("refuses more queued operations than it will hold", () => {
    rejects({ queue: Array.from({ length: MAX_QUEUE + 1 }, () => entry) }, /queue holds more/);
  });
});

describe("checkDocument, acked and completions", () => {
  const completion = { key: "a1", done: true, at: "2026-09-20T09:00:00Z" };

  it("accepts an acknowledgement counter of zero", () => {
    expect(checkDocument(document({ acked: 0 }))).toBeTruthy();
  });

  it("refuses an acknowledgement counter that is not a counter", () => {
    rejects({ acked: -1 }, /document.acked must be a whole number/);
    rejects({ acked: null }, /document.acked must be a whole number/);
  });

  it("accepts a completion and requires every field of it", () => {
    expect(checkDocument(document({ completions: [completion] }))).toBeTruthy();
    const without = { ...completion };
    delete without.done;
    rejects({ completions: [without] }, /completions\[0\] is missing done/);
  });

  it("refuses a completion timestamp that is not a moment", () => {
    rejects({ completions: [{ ...completion, at: "2026-09-20" }] }, /completions\[0\].at must be/);
  });

  it("refuses more completions than it will hold", () => {
    const many = Array.from({ length: MAX_COMPLETIONS + 1 }, () => completion);
    rejects({ completions: many }, /completions holds more than 500/);
  });
});
