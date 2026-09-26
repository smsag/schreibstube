import { describe, expect, it } from "vitest";
import {
  BridgeError,
  buildEndpoint,
  extractCode,
  extractError,
  normalizeBaseUrl
} from "./bridge-protocol";

/** The URL, the credential and the error shape every capability shares. */

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

describe("extractError", () => {
  it("reads the message out of a bridge error body", () => {
    expect(extractError('{"error":"Unauthorized.","code":"unauthorized"}')).toBe("Unauthorized.");
  });

  it("falls back to the raw body when a proxy answered instead", () => {
    expect(extractError("<html>502</html>")).toBe("<html>502</html>");
  });

  it("truncates a body that is not worth showing in full", () => {
    expect(extractError("x".repeat(500))).toHaveLength(200);
  });
});

describe("extractCode", () => {
  it("reads the bridge's stable code", () => {
    expect(extractCode('{"error":"SFTP failed.","code":"sftp_error","requestId":"req_1"}')).toBe(
      "sftp_error"
    );
  });

  it("is empty for a body that is not the bridge's", () => {
    expect(extractCode("<html>Bad Gateway</html>")).toBe("");
    expect(extractCode('{"code":5}')).toBe("");
  });
});

describe("BridgeError", () => {
  it("keeps the wording for the person and the status for the code", () => {
    const error = new BridgeError("the web host error — SFTP failed.", 502, "sftp_error");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("the web host error — SFTP failed.");
    expect(error.status).toBe(502);
    expect(error.code).toBe("sftp_error");
  });
});
