import { describe, expect, it } from "vitest";
import { sendMessage } from "./mail.mjs";

/**
 * Characterisation tests for the send path.
 *
 * `sendMessage` takes its transport as an argument, so the whole path runs
 * without a network: nodemailer compiles the message to bytes in memory, and a
 * fake transport records what would have gone out. Filing the sent copy is
 * switched off with an empty `sentMailbox`, which is the one configuration that
 * skips IMAP entirely.
 */

function config(overrides = {}) {
  return {
    from: "Schreibstube <post@example.com>",
    sentMailbox: "",
    maxTextChars: 40_000,
    ...overrides
  };
}

function recorder() {
  const calls = [];
  return {
    calls,
    async sendMail(payload) {
      calls.push(payload);
      return { accepted: [] };
    }
  };
}

async function send(request, configOverrides = {}) {
  const transport = recorder();
  const result = await sendMessage(config(configOverrides), transport, request);
  const payload = transport.calls[0];
  return { result, payload, raw: payload.raw.toString("utf8") };
}

const minimal = { to: "kunde@example.com", subject: "Angebot", text: "Guten Tag" };

describe("sendMessage, the Message-ID", () => {
  it("generates one in the From domain when the caller supplies none", async () => {
    const { result } = await send(minimal);
    expect(result.messageId).toMatch(/^<[0-9a-f-]{36}@example\.com>$/);
  });

  it("puts the returned id into the bytes that are sent", async () => {
    const { result, raw } = await send(minimal);
    expect(raw).toContain(`Message-ID: ${result.messageId}`);
  });

  it("generates a fresh id per send", async () => {
    const [first, second] = await Promise.all([send(minimal), send(minimal)]);
    expect(first.result.messageId).not.toBe(second.result.messageId);
  });

  it("honours an id supplied by the caller, trimmed", async () => {
    const { result, raw } = await send({ ...minimal, messageId: " <fest@example.com> " });
    expect(result.messageId).toBe("<fest@example.com>");
    expect(raw).toContain("Message-ID: <fest@example.com>");
  });

  it("falls back to localhost when the From carries no domain", async () => {
    const { result } = await send(minimal, { from: "post" });
    expect(result.messageId).toMatch(/@localhost>$/);
  });
});

describe("sendMessage, recipients", () => {
  it("writes To and Cc headers", async () => {
    const { raw } = await send({ ...minimal, cc: ["innendienst@example.com"] });
    expect(raw).toContain("To: kunde@example.com");
    expect(raw).toContain("Cc: innendienst@example.com");
  });

  it("never writes a Bcc header, because the same bytes are filed in Sent", async () => {
    const { raw } = await send({ ...minimal, bcc: ["blind@example.com"] });
    expect(raw).not.toMatch(/^Bcc:/im);
    expect(raw).not.toContain("blind@example.com");
  });

  it("carries blind recipients in the SMTP envelope instead", async () => {
    const { payload } = await send({ ...minimal, bcc: ["blind@example.com"] });
    expect(payload.envelope.to).toContain("blind@example.com");
  });

  it("puts every recipient class into the envelope", async () => {
    const { payload } = await send({
      ...minimal,
      cc: ["innendienst@example.com"],
      bcc: ["blind@example.com"]
    });
    expect(payload.envelope.to).toEqual([
      "kunde@example.com",
      "innendienst@example.com",
      "blind@example.com"
    ]);
  });

  it("reduces display-name forms to bare addresses in the envelope", async () => {
    const { payload } = await send({ ...minimal, to: "Kunde GmbH <kunde@example.com>" });
    expect(payload.envelope.to).toEqual(["kunde@example.com"]);
    expect(payload.envelope.from).toBe("post@example.com");
  });

  it("splits a comma-separated recipient string for the envelope", async () => {
    const { payload } = await send({ ...minimal, to: "a@example.com, b@example.com" });
    expect(payload.envelope.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("joins an array of recipients into one header", async () => {
    const { raw } = await send({ ...minimal, to: ["a@example.com", " b@example.com "] });
    expect(raw).toContain("To: a@example.com, b@example.com");
  });

  it("drops empty entries rather than writing a stray separator", async () => {
    const { raw } = await send({ ...minimal, to: ["a@example.com", "", "   "] });
    expect(raw).toContain("To: a@example.com");
    expect(raw).not.toContain("To: a@example.com,");
  });
});

describe("sendMessage, the rest of the message", () => {
  it("uses the configured From", async () => {
    const { raw } = await send(minimal);
    expect(raw).toContain("From: Schreibstube <post@example.com>");
  });

  it("lets the caller override the From", async () => {
    const { raw, payload } = await send({ ...minimal, from: "Andere <andere@example.com>" });
    expect(raw).toContain("From: Andere <andere@example.com>");
    expect(payload.envelope.from).toBe("andere@example.com");
  });

  it("ignores a blank From override", async () => {
    const { raw } = await send({ ...minimal, from: "   " });
    expect(raw).toContain("From: Schreibstube <post@example.com>");
  });

  it("carries the subject and the body", async () => {
    const { raw } = await send({ ...minimal, subject: "Angebot 4711", text: "Guten Tag" });
    expect(raw).toContain("Subject: Angebot 4711");
    expect(raw).toContain("Guten Tag");
  });

  it("writes threading headers when replying", async () => {
    const { raw } = await send({
      ...minimal,
      inReplyTo: "<original@example.com>",
      references: ["<original@example.com>"]
    });
    expect(raw).toContain("In-Reply-To: <original@example.com>");
    expect(raw).toContain("References: <original@example.com>");
  });

  it("omits threading headers when there is nothing to thread", async () => {
    const { raw } = await send({ ...minimal, inReplyTo: "", references: [] });
    expect(raw).not.toMatch(/^In-Reply-To:/im);
    expect(raw).not.toMatch(/^References:/im);
  });

  it("reports the send time as an ISO timestamp", async () => {
    const { result } = await send(minimal);
    expect(result.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("reports no Sent copy when filing is switched off", async () => {
    const { result } = await send(minimal);
    expect(result.filedInSent).toBe(false);
  });
});
