import { describe, expect, it, vi } from "vitest";

/**
 * Diagnostics answer per protocol, under a deadline each: a server that
 * accepts the connection and then says nothing is exactly the case the route
 * exists to name, and it has to be named rather than become a 504.
 */

const imap = vi.hoisted(() => ({ options: [], hang: false }));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(options) {
      imap.options.push(options);
    }
    connect() {
      if (imap.hang) return new Promise(() => {});
      return Promise.reject(new Error("login refused"));
    }
    async logout() {}
    close() {}
  }
}));

const { diagnose } = await import("./mail.mjs");

const config = {
  imap: { host: "imap.example.com", port: 993, secure: true, auth: {} },
  defaultMailbox: "INBOX",
  upstreamTimeoutMs: 20
};

describe("diagnose", () => {
  it("gives the IMAP client the connection deadline, not only the greeting and socket ones", async () => {
    imap.hang = false;
    await diagnose(config, { verify: async () => {} });
    expect(imap.options.at(-1)).toMatchObject({
      connectionTimeout: 20,
      greetingTimeout: 20,
      socketTimeout: 20
    });
  });

  it("requires STARTTLS when the connection does not start in TLS, so the upgrade cannot be struck", async () => {
    imap.hang = false;
    await diagnose(
      { ...config, imap: { ...config.imap, port: 143, secure: false } },
      { verify: async () => {} }
    );
    expect(imap.options.at(-1)).toMatchObject({ secure: false, doSTARTTLS: true });
  });

  it("asks for no STARTTLS on a connection that is TLS from the start, which imapflow refuses", async () => {
    imap.hang = false;
    await diagnose(config, { verify: async () => {} });
    expect(imap.options.at(-1).secure).toBe(true);
    expect(imap.options.at(-1)).not.toHaveProperty("doSTARTTLS");
  });

  it("answers its own shape when a protocol hangs, naming the protocol", async () => {
    imap.hang = true;
    const result = await diagnose(config, { verify: () => new Promise(() => {}) });
    expect(result.imap).toEqual({ ok: false, error: "IMAP timed out after 0s" });
    expect(result.smtp).toEqual({ ok: false, error: "SMTP timed out after 0s" });
  });

  it("reports each protocol on its own", async () => {
    imap.hang = false;
    const result = await diagnose(config, { verify: async () => {} });
    expect(result.imap).toEqual({ ok: false, error: "login refused" });
    expect(result.smtp).toEqual({ ok: true });
  });
});
