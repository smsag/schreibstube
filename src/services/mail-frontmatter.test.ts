import { describe, expect, it } from "vitest";
import {
  parseAddressList,
  readMailFields,
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

describe("readMailFields", () => {
  it("reads the full contract", () => {
    const fields = readMailFields({
      to: "kunde@example.com",
      cc: ["innen@example.de"],
      subject: " Angebot Objekt 4711 ",
      message_id: "<7f3a@example.de>",
      merged_ids: ["<r1@example.com>"]
    });

    expect(fields).toEqual({
      to: ["kunde@example.com"],
      cc: ["innen@example.de"],
      subject: "Angebot Objekt 4711",
      messageId: "<7f3a@example.de>",
      mergedIds: ["<r1@example.com>"]
    });
  });

  it("re-adds angle brackets an editor may have stripped from the Message-ID", () => {
    expect(readMailFields({ message_id: "7f3a@example.de" }).messageId).toBe(
      "<7f3a@example.de>"
    );
  });

  it("defaults cleanly for a note with no frontmatter", () => {
    expect(readMailFields(undefined)).toEqual({
      to: [],
      cc: [],
      subject: "",
      messageId: null,
      mergedIds: []
    });
  });
});

describe("validateSendable", () => {
  const base = { to: ["a@x.de"], cc: [], subject: "Hi", messageId: null, mergedIds: [] };

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
    }
  });

  it("requires a subject", () => {
    const result = validateSendable({ ...base, subject: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/subject/i);
    }
  });

  it("catches a malformed address before it reaches the bridge", () => {
    const result = validateSendable({ ...base, to: ["not-an-address"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not-an-address/);
    }
  });

  it("accepts a display-name form", () => {
    expect(validateSendable({ ...base, to: ["Max Muster <max@example.de>"] })).toEqual({
      ok: true
    });
  });
});

describe("stripFrontmatter", () => {
  it("removes the frontmatter block", () => {
    const note = "---\nto: a@x.de\nsubject: Hi\n---\n\nDear all,\n\nregards";
    expect(stripFrontmatter(note)).toBe("Dear all,\n\nregards");
  });

  it("handles the '...' terminator", () => {
    expect(stripFrontmatter("---\nto: a@x.de\n...\nBody")).toBe("Body");
  });

  it("handles CRLF line endings", () => {
    expect(stripFrontmatter("---\r\nto: a@x.de\r\n---\r\nBody")).toBe("Body");
  });

  it("leaves a note without frontmatter untouched", () => {
    expect(stripFrontmatter("Just a note")).toBe("Just a note");
  });

  it("keeps the whole note when frontmatter is unterminated, rather than sending nothing", () => {
    const broken = "---\nto: a@x.de\nno terminator";
    expect(stripFrontmatter(broken)).toBe(broken);
  });

  it("does not mistake a horizontal rule inside the body for frontmatter", () => {
    expect(stripFrontmatter("Body\n\n---\n\nMore")).toBe("Body\n\n---\n\nMore");
  });
});
