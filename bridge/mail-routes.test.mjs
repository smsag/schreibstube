import { describe, expect, it } from "vitest";
import { createMailRoutes, MAX_EXCLUDE, validateSearch, validateSend } from "./mail-routes.mjs";
import { parseFromAllowed } from "./mail-policy.mjs";
import { TimeoutError } from "./timeout.mjs";

/**
 * The send route's answers, with the SMTP leg replaced: what matters here is
 * which failure the plugin is told about, since that decides whether a person
 * sends the mail again.
 */
function sendRoute(sendMail, mailOverrides = {}, { now, log = () => {} } = {}) {
  const config = {
    upstreamTimeoutMs: 1000,
    requestTimeoutMs: 1000,
    mail: {
      from: "Schreibstube <post@example.com>",
      sentMailbox: "",
      maxTextChars: 40_000,
      maxBodyBytes: 1_000_000,
      ...mailOverrides
    }
  };
  const routes = createMailRoutes(config, { transport: { sendMail }, ...(now ? { now } : {}) });
  const route = routes.find((candidate) => candidate.path === "/send");
  return (body) => route.handler({ body, log });
}

const delivered = async () => ({ accepted: ["kunde@example.com"], rejected: [] });

const valid = { to: ["kunde@example.com"], subject: "Angebot", text: "Guten Tag" };

describe("POST /send", () => {
  it("answers a send the server never confirmed as unconfirmed, not failed", async () => {
    const send = sendRoute(async () => {
      throw new TimeoutError("Send", 1000);
    });
    await expect(send(valid)).rejects.toMatchObject({ status: 504, code: "send_unconfirmed" });
  });

  it("answers a refusal the server gave as a failure", async () => {
    const send = sendRoute(async () => {
      throw Object.assign(new Error("535 authentication failed"), {
        command: "AUTH PLAIN",
        responseCode: 535
      });
    });
    await expect(send(valid)).rejects.toMatchObject({ status: 502, code: "upstream_error" });
  });

  it("returns the refused recipients of a send that went out", async () => {
    const send = sendRoute(async () => ({ accepted: ["kunde@example.com"], rejected: ["x@y.de"] }));
    await expect(send(valid)).resolves.toMatchObject({ rejected: ["x@y.de"] });
  });

  it("refuses a picture it cannot vouch for rather than send the mail without it", async () => {
    let sent = false;
    const send = sendRoute(async () => {
      sent = true;
      return { accepted: [], rejected: [] };
    });
    const attachments = [{ filename: "a.png", contentType: "image/png", content: "bm90IGEgcG5n" }];
    await expect(send({ ...valid, attachments })).rejects.toMatchObject({
      status: 400,
      code: "invalid_request"
    });
    expect(sent).toBe(false);
  });

  it("logs an upstream failure by its codes, never by the server's words, which name recipients", async () => {
    const send = sendRoute(async () => {
      throw Object.assign(
        new Error("Can't send mail - all recipients were rejected: 550 <kunde@example.com>"),
        { code: "EENVELOPE", responseCode: 550 }
      );
    });
    const err = await send(valid).catch((caught) => caught);
    expect(err).toMatchObject({ status: 502, code: "upstream_error" });
    // `detail` is what the server logs for a 5xx; the message goes to the caller.
    expect(err.detail).toBe("Send failed: EENVELOPE 550 Error");
    expect(err.detail).not.toContain("@");
    expect(err.message).toContain("kunde@example.com");
  });

  it("logs an unconfirmed send by the codes of what interrupted it", async () => {
    const send = sendRoute(async () => {
      throw Object.assign(new Error("Connection closed unexpectedly by kunde@example.com"), {
        code: "ECONNECTION"
      });
    });
    const err = await send(valid).catch((caught) => caught);
    expect(err).toMatchObject({ status: 504, code: "send_unconfirmed" });
    expect(err.detail).toBe("Send unconfirmed: ECONNECTION Error");
  });

  it("sends as MAIL_FROM, and as an address the operator allowed, but as no other", async () => {
    const send = sendRoute(delivered, {
      fromAllowed: parseFromAllowed("buero@example.org,@team.example.de", "post@example.com")
    });
    await expect(send(valid)).resolves.toHaveProperty("messageId");
    await expect(send({ ...valid, from: "Büro <BUERO@example.org>" })).resolves.toHaveProperty(
      "messageId"
    );
    await expect(send({ ...valid, from: "wer@team.example.de" })).resolves.toHaveProperty(
      "messageId"
    );
    await expect(send({ ...valid, from: "Bank <security@bank.example>" })).rejects.toMatchObject({
      status: 403,
      code: "sender_not_allowed",
      message: expect.stringContaining("MAIL_FROM_ALLOWED")
    });
  });

  it("allows only MAIL_FROM when the operator named nothing else", async () => {
    let sent = 0;
    const send = sendRoute(async () => {
      sent += 1;
      return { accepted: [], rejected: [] };
    });
    await expect(send({ ...valid, from: "andere@example.com" })).rejects.toMatchObject({
      status: 403
    });
    expect(sent).toBe(0);
  });

  it("refuses more recipients than MAX_RECIPIENTS, counting to, cc and bcc together", async () => {
    const send = sendRoute(delivered, { maxRecipients: 3 });
    await expect(
      send({ ...valid, to: ["a@example.com", "b@example.com"], bcc: ["c@example.com"] })
    ).resolves.toHaveProperty("messageId");
    await expect(
      send({ ...valid, to: "a@example.com, b@example.com", cc: "c@example.com", bcc: "d@x.de" })
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("At most 3") });
  });

  it("sends at most MAIL_SEND_PER_HOUR mails an hour, and says when the next may go", async () => {
    let time = 0;
    const send = sendRoute(delivered, { sendPerHour: 2 }, { now: () => time });
    await send(valid);
    await send(valid);
    const err = await send(valid).catch((caught) => caught);
    expect(err).toMatchObject({ status: 429, code: "send_rate_limited" });
    expect(err.headers).toEqual({ "retry-after": "3600" });
    time += 3_600_001;
    await expect(send(valid)).resolves.toHaveProperty("messageId");
  });

  it("spends no budget on a request it refuses before sending", async () => {
    const send = sendRoute(delivered, { sendPerHour: 1 });
    await expect(send({ ...valid, subject: "" })).rejects.toMatchObject({ status: 400 });
    await expect(send({ ...valid, from: "x@bank.example" })).rejects.toMatchObject({
      status: 403
    });
    await expect(send(valid)).resolves.toHaveProperty("messageId");
  });

  it("reads a larger body on the send route than on any other", () => {
    const routes = createMailRoutes(
      {
        upstreamTimeoutMs: 1000,
        requestTimeoutMs: 1000,
        mail: { from: "a@b.de", sentMailbox: "", maxTextChars: 40_000, maxBodyBytes: 1_000_000 }
      },
      { transport: { sendMail: async () => ({}) } }
    );
    const limit = (path) => routes.find((route) => route.path === path).maxBytes;
    expect(limit("/send")).toBeGreaterThan(10_000_000);
    expect(limit("/search")).toBe(1_000_000);
  });
});

describe("validateSend", () => {
  const ok = { to: ["kunde@example.com"], subject: "Angebot", text: "Guten Tag" };
  const check = (body) => validateSend(body, 40_000);

  it("reads recipients as the envelope will, so a name with a comma stays one address", () => {
    expect(check({ ...ok, to: ['"Seitz, Steffen" <s@example.com>'] })).toBeNull();
    expect(check({ ...ok, to: "a@example.com, b@example.com" })).toBeNull();
  });

  it("refuses a recipient with no address in it, rather than sending to nobody", () => {
    expect(check({ ...ok, to: ["Steffen Seitz"] })).toMatch(/must be an address/);
    expect(check({ ...ok, to: ["kunde@example.com", "niemand"] })).toMatch(/must be an address/);
    expect(check({ ...ok, to: [], cc: '"Nur ein Name"' })).toMatch(/must be an address|required/);
  });

  it("refuses a recipient field of the wrong type or length", () => {
    expect(check({ ...ok, to: 5 })).toMatch(/to must be a string/);
    expect(check({ ...ok, to: ["kunde@example.com", 7] })).toMatch(/to must be a string/);
    expect(check({ ...ok, cc: { address: "x@y.de" } })).toMatch(/cc must be a string/);
    expect(check({ ...ok, bcc: ["x".repeat(999)] })).toMatch(/bcc exceeds/);
  });

  it("bounds the subject to one header line", () => {
    expect(check({ ...ok, subject: "x".repeat(998) })).toBeNull();
    expect(check({ ...ok, subject: "x".repeat(999) })).toMatch(/Subject exceeds the 998/);
  });

  it("type-checks and bounds the thread headers", () => {
    expect(check({ ...ok, inReplyTo: "<a@b.de>", references: ["<a@b.de>"] })).toBeNull();
    expect(check({ ...ok, inReplyTo: ["<a@b.de>"] })).toMatch(/inReplyTo must be a string/);
    expect(check({ ...ok, inReplyTo: "x".repeat(999) })).toMatch(/inReplyTo must be a string/);
    expect(check({ ...ok, references: "<a@b.de>" })).toMatch(/references must be a list/);
    expect(check({ ...ok, references: [1] })).toMatch(/Every reference must be a string/);
    expect(check({ ...ok, references: ["x".repeat(999)] })).toMatch(/Every reference/);
    expect(check({ ...ok, references: Array(101).fill("<a@b.de>") })).toMatch(/at most 100/);
    expect(check({ ...ok, inReplyTo: null, references: null })).toBeNull();
  });
});

describe("validateSearch", () => {
  it("type-checks the thread lookup like every other criterion", () => {
    expect(validateSearch({ criteria: { references: ["<a@b.de>"] } })).toMatch(
      /criteria.references must be a string/
    );
    expect(validateSearch({ criteria: { references: "<a@b.de>" } })).toBeNull();
  });

  it("bounds the Message-IDs a search may step past", () => {
    expect(validateSearch({ exclude: ["<a@b.de>", "uid:7"] })).toBeNull();
    expect(validateSearch({ exclude: Array(MAX_EXCLUDE).fill("<a@b.de>") })).toBeNull();
    expect(validateSearch({ exclude: Array(MAX_EXCLUDE + 1).fill("<a@b.de>") })).toMatch(
      /at most 500/
    );
    expect(validateSearch({ exclude: "<a@b.de>" })).toMatch(/exclude must be a list/);
    expect(validateSearch({ exclude: [5] })).toMatch(/Every excluded Message-ID/);
    expect(validateSearch({ exclude: ["x".repeat(999)] })).toMatch(/Every excluded Message-ID/);
  });

  it("bounds the mailbox name", () => {
    expect(validateSearch({ mailbox: "x".repeat(255) })).toBeNull();
    expect(validateSearch({ mailbox: "x".repeat(256) })).toMatch(/mailbox exceeds the 255/);
    expect(validateSearch({ mailbox: 5 })).toMatch(/mailbox must be a string/);
  });
});
