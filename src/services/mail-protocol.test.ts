import { describe, expect, it } from "vitest";
import {
  MAIL_REQUEST_TIMEOUT_MS,
  MAX_MAIL_RESULTS,
  MAX_MESSAGE_TEXT_CHARS,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_ATTACHMENTS,
  MAX_IMPORT_TOTAL_BYTES,
  describeBridgeError,
  fromBase64,
  hasCriteria,
  parseAttachmentsResult,
  parseSearchResult,
  parseSendResult,
  toBase64
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

  it("passes on a send limit's own reason, which names the variable, not a token failure", () => {
    const limited = JSON.stringify({
      error: "The bridge has sent its 60 mails for this hour (MAIL_SEND_PER_HOUR).",
      code: "send_rate_limited"
    });
    expect(describeBridgeError(429, limited)).toMatch(/MAIL_SEND_PER_HOUR/);
    const sender = JSON.stringify({
      error: "The bridge does not send as x@bank.example: … MAIL_FROM_ALLOWED …",
      code: "sender_not_allowed"
    });
    expect(describeBridgeError(403, sender)).toMatch(/MAIL_FROM_ALLOWED/);
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

describe("parseAttachmentsResult", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

  it("decodes the files and keeps what was left out", () => {
    const result = parseAttachmentsResult({
      uid: 7,
      attachments: [
        { filename: "Protokoll 2025.pdf", contentType: "application/pdf", content: toBase64(pdf) }
      ],
      skipped: [{ filename: "setup.exe", reason: "type" }]
    });
    expect(result.attachments).toEqual([{ filename: "Protokoll 2025.pdf", bytes: pdf }]);
    expect(result.skipped).toEqual([{ filename: "setup.exe", reason: "type" }]);
  });

  it("writes no file of a kind a note may not hold, and says so", () => {
    const result = parseAttachmentsResult({
      attachments: [{ filename: "../../evil.js", content: toBase64(pdf) }]
    });
    expect(result.attachments).toEqual([]);
    expect(result.skipped).toEqual([{ filename: "../../evil.js", reason: "type" }]);
  });

  it("makes a name safe again before it becomes a path", () => {
    const result = parseAttachmentsResult({
      attachments: [{ filename: "../.obsidian/Scan#1.pdf", content: toBase64(pdf) }]
    });
    expect(result.attachments[0]?.filename).toBe("Scan-1.pdf");
  });

  it("leaves out content that is not base64", () => {
    const result = parseAttachmentsResult({
      attachments: [{ filename: "a.pdf", content: "not base64!" }]
    });
    expect(result.attachments).toEqual([]);
    expect(result.skipped).toEqual([{ filename: "a.pdf", reason: "type" }]);
  });

  it("refuses an answer beyond the limits", () => {
    const many = Array.from({ length: MAX_IMPORT_ATTACHMENTS + 1 }, () => ({
      filename: "a.pdf",
      content: "QUJD"
    }));
    expect(() => parseAttachmentsResult({ attachments: many })).toThrow(/more than/);

    const huge = "A".repeat(Math.ceil(MAX_IMPORT_ATTACHMENT_BYTES / 3) * 4 + 4);
    expect(() =>
      parseAttachmentsResult({ attachments: [{ filename: "a.pdf", content: huge }] })
    ).toThrow(/size limit/);

    const large = "A".repeat(Math.floor(MAX_IMPORT_ATTACHMENT_BYTES / 3) * 4);
    const count = Math.ceil(MAX_IMPORT_TOTAL_BYTES / MAX_IMPORT_ATTACHMENT_BYTES) + 1;
    const over = Array.from({ length: count }, (_, i) => ({
      filename: `${i}.pdf`,
      content: large
    }));
    expect(() => parseAttachmentsResult({ attachments: over })).toThrow(/total size limit/);
  });

  it("drops a skipped entry that is not one", () => {
    const result = parseAttachmentsResult({
      skipped: [{ filename: "a.pdf", reason: "because" }, { reason: "type" }, "x"]
    });
    expect(result.skipped).toEqual([]);
  });

  it("reads anything else as no files", () => {
    expect(parseAttachmentsResult(null)).toEqual({ attachments: [], skipped: [] });
  });
});

describe("fromBase64", () => {
  it("is the inverse of toBase64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("refuses what is not standard base64", () => {
    for (const text of ["", "abc", "ab-_", "QUJD=A==", "QU JD"]) {
      expect(fromBase64(text)).toBeNull();
    }
  });
});

describe("describeBridgeError, attachments", () => {
  it("passes on which mail, not which setting, for the attachments route's own codes", () => {
    const gone = JSON.stringify({
      code: "message_gone",
      error: "Message 7 is no longer in INBOX."
    });
    expect(describeBridgeError(404, gone)).toBe("Message 7 is no longer in INBOX.");
    const large = JSON.stringify({ code: "message_too_large", error: "The mail is 52 MB." });
    expect(describeBridgeError(413, large)).toBe("The mail is 52 MB.");
  });
});
