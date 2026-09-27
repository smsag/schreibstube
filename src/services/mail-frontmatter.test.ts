import { describe, expect, it } from "vitest";
import {
  parseAddressList,
  readMailFields,
  splitAddresses,
  stripFrontmatter,
  validateSendable
} from "./mail-frontmatter";

describe("parseAddressList", () => {
  it("accepts a comma-separated string", () => {
    expect(parseAddressList("a@x.de, b@y.de")).toEqual(["a@x.de", "b@y.de"]);
  });

  it("accepts a YAML list", () => {
    expect(parseAddressList(["a@x.de", " b@y.de "])).toEqual(["a@x.de", "b@y.de"]);
  });

  it("returns nothing for a missing or non-string value", () => {
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList(42)).toEqual([]);
    expect(parseAddressList(",  ,")).toEqual([]);
  });
});

describe("splitAddresses", () => {
  it("keeps a comma inside a quoted name", () => {
    expect(splitAddresses('"Seitz, Steffen" <s@x.de>, b@x.de')).toEqual([
      '"Seitz, Steffen" <s@x.de>',
      "b@x.de"
    ]);
  });

  it("drops the empty pieces around stray commas", () => {
    expect(splitAddresses(" a@x.de, ,b@x.de, ")).toEqual(["a@x.de", "b@x.de"]);
  });
});

describe("readMailFields", () => {
  it("reads when a send was left unconfirmed, as YAML's date or as text", () => {
    expect(
      readMailFields({ schreibstubeSendUnconfirmed: new Date("2026-09-25T08:35:00Z") })
        .unconfirmedAt
    ).toBe("2026-09-25T08:35:00.000Z");
    expect(
      readMailFields({ schreibstubeSendUnconfirmed: "2026-09-25T08:35:00Z" }).unconfirmedAt
    ).toBe("2026-09-25T08:35:00Z");
  });

  it("splits list items that hold several addresses", () => {
    expect(readMailFields({ schreibstubeTo: ["a@x.de, b@x.de"] }).to).toEqual(["a@x.de", "b@x.de"]);
  });

  it("reads the full contract", () => {
    const fields = readMailFields({
      schreibstubeTo: "kunde@example.com",
      schreibstubeCc: ["innen@example.de"],
      schreibstubeFrom: " Büro <buero@example.de> ",
      schreibstubeSubject: " Angebot Objekt 4711 ",
      schreibstubeMessageId: "<7f3a@example.de>",
      schreibstubeMergedIds: ["<r1@example.com>"]
    });

    expect(fields).toEqual({
      to: ["kunde@example.com"],
      cc: ["innen@example.de"],
      from: "Büro <buero@example.de>",
      subject: "Angebot Objekt 4711",
      messageId: "<7f3a@example.de>",
      mergedIds: ["<r1@example.com>"],
      unconfirmedAt: null
    });
  });

  it("re-adds angle brackets an editor may have stripped from the Message-ID", () => {
    expect(readMailFields({ schreibstubeMessageId: "7f3a@example.de" }).messageId).toBe(
      "<7f3a@example.de>"
    );
  });

  it("defaults cleanly for a note with no frontmatter", () => {
    expect(readMailFields(undefined)).toEqual({
      to: [],
      cc: [],
      from: "",
      subject: "",
      messageId: null,
      mergedIds: [],
      unconfirmedAt: null
    });
  });
});

describe("validateSendable", () => {
  const base = {
    to: ["a@x.de"],
    cc: [],
    from: "",
    subject: "Hi",
    messageId: null,
    mergedIds: [],
    unconfirmedAt: null
  };

  it("accepts a complete note", () => {
    expect(validateSendable(base)).toEqual({ ok: true });
  });

  it("accepts a note addressed only via cc", () => {
    expect(validateSendable({ ...base, to: [], cc: ["a@x.de"] })).toEqual({ ok: true });
  });

  it("requires a recipient", () => {
    const result = validateSendable({ ...base, to: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/recipient/i);
      expect(result.missing).toBe(true);
    }
  });

  it("requires a subject", () => {
    const result = validateSendable({ ...base, subject: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/subject/i);
      expect(result.missing).toBe(true);
    }
  });

  it("catches a malformed address before it reaches the bridge", () => {
    const result = validateSendable({ ...base, to: ["not-an-address"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not-an-address/);
      // A wrong address is not something a property set could add.
      expect(result.missing).toBe(false);
    }
  });

  it("accepts a sender of the note's own, with or without a name", () => {
    expect(validateSendable({ ...base, from: "buero@x.de" })).toEqual({ ok: true });
    expect(validateSendable({ ...base, from: "Büro <buero@x.de>" })).toEqual({ ok: true });
  });

  it.each([
    ["a name alone", "Steffen Seitz"],
    ["two addresses", "a@x.de, b@x.de"]
  ])("refuses %s as the sender, naming the key", (_, from) => {
    const result = validateSendable({ ...base, from });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("schreibstubeFrom");
      expect(result.missing).toBe(false);
    }
  });

  it("accepts a sender whose quoted name holds a comma", () => {
    expect(validateSendable({ ...base, from: '"Seitz, Steffen" <s@x.de>' })).toEqual({ ok: true });
  });

  it("accepts a recipient whose quoted name holds a comma", () => {
    const fields = readMailFields({
      schreibstubeTo: '"Seitz, Steffen" <s@x.de>',
      schreibstubeSubject: "Hi"
    });
    expect(validateSendable(fields)).toEqual({ ok: true });
  });

  it("accepts a display-name form", () => {
    expect(validateSendable({ ...base, to: ["Max Muster <max@example.de>"] })).toEqual({
      ok: true
    });
  });
});

describe("stripFrontmatter", () => {
  it("removes the frontmatter block", () => {
    const note =
      "---\nschreibstubeTo: a@x.de\nschreibstubeSubject: Hi\n---\n\nDear all,\n\nregards";
    expect(stripFrontmatter(note)).toBe("Dear all,\n\nregards");
  });

  it("handles the '...' terminator", () => {
    expect(stripFrontmatter("---\nschreibstubeTo: a@x.de\n...\nBody")).toBe("Body");
  });

  it("handles CRLF line endings", () => {
    expect(stripFrontmatter("---\r\nschreibstubeTo: a@x.de\r\n---\r\nBody")).toBe("Body");
  });

  it("leaves a note without frontmatter untouched", () => {
    expect(stripFrontmatter("Just a note")).toBe("Just a note");
  });

  it("keeps the whole note when frontmatter is unterminated, rather than sending nothing", () => {
    const broken = "---\nschreibstubeTo: a@x.de\nno terminator";
    expect(stripFrontmatter(broken)).toBe(broken);
  });

  it("does not mistake a horizontal rule inside the body for frontmatter", () => {
    expect(stripFrontmatter("Body\n\n---\n\nMore")).toBe("Body\n\n---\n\nMore");
  });
});
