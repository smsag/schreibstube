import { describe, expect, it } from "vitest";
import {
  buildEndpoint,
  describeBridgeError,
  hasCriteria,
  normalizeBaseUrl,
  parseSearchResult,
  parseSendResult
} from "./mail-protocol";

describe("normalizeBaseUrl", () => {
  it("accepts an https URL and strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://bridge.example.app///")).toEqual({
      ok: true,
      url: "https://bridge.example.app"
    });
  });

  it("keeps a path prefix so the bridge can live behind a sub-path", () => {
    expect(normalizeBaseUrl("https://example.app/mail/")).toEqual({
      ok: true,
      url: "https://example.app/mail"
    });
  });

  it("rejects plain http for a hosted bridge", () => {
    const result = normalizeBaseUrl("http://bridge.example.app");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/https/i);
    }
  });

  it("allows plain http on loopback for local testing", () => {
    expect(normalizeBaseUrl("http://localhost:8080")).toEqual({
      ok: true,
      url: "http://localhost:8080"
    });
    expect(normalizeBaseUrl("http://127.0.0.1:8080").ok).toBe(true);
  });

  it("rejects a non-HTTP scheme", () => {
    expect(normalizeBaseUrl("ftp://example.app").ok).toBe(false);
  });

  it("reports an empty setting as unconfigured", () => {
    const result = normalizeBaseUrl("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/no bridge URL/i);
    }
  });

  it("rejects a value that is not a URL at all", () => {
    expect(normalizeBaseUrl("bridge.example.app").ok).toBe(false);
  });
});

describe("buildEndpoint", () => {
  it("joins without doubling the separator", () => {
    expect(buildEndpoint("https://x.app", "/send")).toBe("https://x.app/send");
    expect(buildEndpoint("https://x.app", "send")).toBe("https://x.app/send");
  });
});

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
    expect(result.messages[0].uid).toBe(42);
    expect(result.messages[0].subject).toBe("Re: Angebot");
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
      filedInSent: true
    });
  });

  it("throws when the Message-ID is missing, since replies could never be found", () => {
    expect(() => parseSendResult({ sentAt: "now" })).toThrow(/Message-ID/i);
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
    expect(describeBridgeError(502, '{"error":"Search failed: ENOTFOUND"}')).toMatch(
      /ENOTFOUND/
    );
  });

  it("falls back to the raw body when the response is not JSON", () => {
    expect(describeBridgeError(500, "<html>gateway</html>")).toMatch(/gateway/);
  });
});
