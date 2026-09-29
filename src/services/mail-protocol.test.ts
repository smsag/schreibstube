import { describe, expect, it } from "vitest";
import {
  MAIL_REQUEST_TIMEOUT_MS,
  MAX_MAIL_RESULTS,
  MAX_MESSAGE_TEXT_CHARS,
  describeBridgeError,
  hasCriteria,
  parseSearchResult,
  parseSendResult
} from "./mail-protocol";

describe("hasCriteria", () => {
  it("is false for an empty or blank-only search", () => {
    expect(hasCriteria({})).toBe(false);
    expect(hasCriteria({ from: "  ", subject: "" })).toBe(false);
  });

  it("is true as soon as one field carries a value", () => {
    expect(hasCriteria({ subject: "Angebot" })).toBe(true);
  });
});

describe("parseSearchResult", () => {
  it("maps a well-formed response", () => {
    const result = parseSearchResult({
      mailbox: "INBOX",
      truncated: true,
      messages: [
        {
          uid: 42,
          messageId: "<a@b.de>",
          inReplyTo: "<orig@b.de>",
          references: ["<orig@b.de>"],
          from: "Kunde <k@example.com>",
          to: "me@b.de",
          subject: "Re: Angebot",
          date: "2026-09-07T10:12:00.000Z",
          text: "Passt.",
          truncated: false
        }
      ]
    });

    expect(result.mailbox).toBe("INBOX");
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.uid).toBe(42);
    expect(result.messages[0]?.subject).toBe("Re: Angebot");
  });

  it("survives a malformed or partial response", () => {
    const result = parseSearchResult({ messages: [{}, null, 7] });
    expect(result.mailbox).toBe("INBOX");
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toMatchObject({ uid: 0, messageId: null, references: [] });
  });

  it("treats a missing messages array as no results", () => {
    expect(parseSearchResult({}).messages).toEqual([]);
    expect(parseSearchResult(null).messages).toEqual([]);
  });

  it("keeps no more messages than a search may answer with", () => {
    const messages = Array.from({ length: MAX_MAIL_RESULTS + 10 }, (_, uid) => ({ uid }));
    expect(parseSearchResult({ messages }).messages).toHaveLength(MAX_MAIL_RESULTS);
  });

  it("cuts a body the bridge should already have cut, and says so", () => {
    const [message] = parseSearchResult({
      messages: [{ text: "x".repeat(MAX_MESSAGE_TEXT_CHARS + 1) }]
    }).messages;
    expect(message?.text).toHaveLength(MAX_MESSAGE_TEXT_CHARS);
    expect(message?.truncated).toBe(true);
  });

  it("bounds the headers and the reference list", () => {
    const [message] = parseSearchResult({
      messages: [
        {
          subject: "s".repeat(600),
          from: "f".repeat(600),
          to: "t".repeat(600),
          references: Array.from({ length: 80 }, (_, i) => `<r${i}@b.de>`)
        }
      ]
    }).messages;
    expect(message?.subject).toHaveLength(500);
    expect(message?.from).toHaveLength(500);
    expect(message?.to).toHaveLength(500);
    expect(message?.references).toHaveLength(50);
  });

  it("drops an identifier or a date that is not one, keeping the message", () => {
    const [message] = parseSearchResult({
      messages: [
        {
          messageId: "no brackets",
          inReplyTo: "<has space@b.de>",
          references: ["<ok@b.de>", "<bad", "<>"],
          date: "gestern"
        }
      ]
    }).messages;
    expect(message).toMatchObject({
      messageId: null,
      inReplyTo: null,
      references: ["<ok@b.de>"],
      date: null
    });
  });
});

describe("parseSendResult", () => {
  it("returns the Message-ID the bridge generated", () => {
    const result = parseSendResult({
      messageId: "<x@b.de>",
      sentAt: "2026-09-07T10:00:00.000Z",
      filedInSent: true
    });
    expect(result).toEqual({
      messageId: "<x@b.de>",
      sentAt: "2026-09-07T10:00:00.000Z",
      filedInSent: true,
      rejected: []
    });
  });

  it("reads the recipients the server refused", () => {
    const result = parseSendResult({ messageId: "<x@b.de>", rejected: ["weg@b.de"] });
    expect(result.rejected).toEqual(["weg@b.de"]);
  });

  it("keeps only plausible entries from a refusal list", () => {
    const result = parseSendResult({
      messageId: "<x@b.de>",
      rejected: ["weg@b.de", 7, "", "x".repeat(400)]
    });
    expect(result.rejected).toEqual(["weg@b.de"]);
  });

  it("reads no refusals from a bridge that does not report them", () => {
    expect(parseSendResult({ messageId: "<x@b.de>" }).rejected).toEqual([]);
  });

  it("throws when the Message-ID is missing, since replies could never be found", () => {
    expect(() => parseSendResult({ sentAt: "2026-09-07T10:00:00.000Z" })).toThrow(/Message-ID/i);
  });

  it("throws on a Message-ID that no reply could cite", () => {
    expect(() => parseSendResult({ messageId: "x@b.de" })).toThrow(/malformed Message-ID/);
    expect(() => parseSendResult({ messageId: "<a b@b.de>" })).toThrow(/malformed Message-ID/);
    expect(() => parseSendResult({ messageId: `<${"x".repeat(999)}>` })).toThrow(
      /malformed Message-ID/
    );
  });

  it("throws on a send time that is not a date", () => {
    expect(() => parseSendResult({ messageId: "<x@b.de>", sentAt: "now" })).toThrow(/not a date/);
  });
});

describe("describeBridgeError", () => {
  it("explains an auth failure in terms of the setting to fix", () => {
    expect(describeBridgeError(401, '{"error":"Unauthorized."}')).toMatch(/token/i);
  });

  it("explains a 404 as a URL problem", () => {
    expect(describeBridgeError(404, "")).toMatch(/URL/i);
  });

  it("surfaces the bridge's own message for a mail server failure", () => {
    expect(describeBridgeError(502, '{"error":"Search failed: ENOTFOUND"}')).toMatch(/ENOTFOUND/);
  });

  it("explains a throttled bridge rather than echoing the status", () => {
    expect(describeBridgeError(429, '{"error":"Too many failed attempts."}')).toMatch(/wait/i);
  });

  it("explains a restarting bridge", () => {
    expect(describeBridgeError(503, '{"error":"Bridge is shutting down."}')).toMatch(/restarting/i);
  });

  it("names what timed out", () => {
    expect(describeBridgeError(504, '{"error":"The request took too long."}')).toMatch(
      /timed out/i
    );
  });

  it("falls back to the raw body when the response is not JSON", () => {
    expect(describeBridgeError(500, "<html>gateway</html>")).toMatch(/gateway/);
  });
});

describe("MAIL_REQUEST_TIMEOUT_MS", () => {
  it("outlasts the 45 s a default bridge allows a send and its filing", () => {
    expect(MAIL_REQUEST_TIMEOUT_MS).toBeGreaterThan(45_000);
  });
});
