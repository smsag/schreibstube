import { describe, expect, it } from "vitest";
import { isUnconfirmed, sendMessage, SendUnconfirmedError, sentMailboxFor } from "./mail.mjs";
import { TimeoutError } from "./timeout.mjs";

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
    upstreamTimeoutMs: 1000,
    ...overrides
  };
}

function recorder(answer = { accepted: [], rejected: [] }) {
  const calls = [];
  return {
    calls,
    async sendMail(payload) {
      calls.push(payload);
      return answer;
    }
  };
}

async function send(request, configOverrides = {}, answer) {
  const transport = recorder(answer);
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

  it("ignores an id the caller tries to supply: the bridge's own is the one it returns", async () => {
    const { result, raw } = await send({ ...minimal, messageId: "<fest@example.com>" });
    expect(result.messageId).not.toBe("<fest@example.com>");
    expect(raw).not.toContain("<fest@example.com>");
    expect(raw).toContain(`Message-ID: ${result.messageId}`);
  });

  it("takes its domain from the From the message carries", async () => {
    const { result } = await send({ ...minimal, from: "Büro <buero@alias.example.org>" });
    expect(result.messageId).toMatch(/@alias\.example\.org>$/);
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

  it("keeps a quoted name with a comma as one envelope recipient", async () => {
    const { payload } = await send({
      ...minimal,
      to: '"Seitz, Steffen" <s@example.com>, b@example.com'
    });
    expect(payload.envelope.to).toEqual(["s@example.com", "b@example.com"]);
  });

  it("puts a group's members into the envelope", async () => {
    const { payload } = await send({ ...minimal, to: "Team: a@example.com, b@example.com;" });
    expect(payload.envelope.to).toEqual(["a@example.com", "b@example.com"]);
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

  it("lets the caller set the From header", async () => {
    const { raw } = await send({ ...minimal, from: "Andere <andere@example.com>" });
    expect(raw).toContain("From: Andere <andere@example.com>");
  });

  it("keeps the mailbox's own address as the envelope sender under an alias", async () => {
    const { payload } = await send({ ...minimal, from: "Andere <andere@example.com>" });
    expect(payload.envelope.from).toBe("post@example.com");
  });

  it("quotes a display name with a comma instead of reading two senders", async () => {
    const { raw } = await send({ ...minimal, from: "Seitz, Steffen <s@example.com>" });
    expect(raw).toContain('From: "Seitz, Steffen" <s@example.com>');
  });

  it("encodes a display name with an umlaut", async () => {
    const { raw } = await send({ ...minimal, from: "Jürgen Müller <jm@example.com>" });
    expect(raw).toMatch(/^From: =\?UTF-8\?.+\?= <jm@example\.com>$/m);
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

describe("sendMessage, deadlines", () => {
  const never = () => new Promise(() => {});

  it("reports a delivered message as sent when filing in Sent hangs", async () => {
    const transport = recorder();
    const result = await sendMessage(
      config({ sentMailbox: "Sent", upstreamTimeoutMs: 20 }),
      transport,
      minimal,
      { fileInSent: never }
    );
    expect(transport.calls).toHaveLength(1);
    expect(result.filedInSent).toBe(false);
    expect(result.messageId).toMatch(/^<.+>$/);
  });

  it("reports a delivered message as sent when filing in Sent fails", async () => {
    const result = await sendMessage(config({ sentMailbox: "Sent" }), recorder(), minimal, {
      fileInSent: async () => {
        throw new Error("APPEND refused");
      }
    });
    expect(result.filedInSent).toBe(false);
  });

  it("gives the filing leg a deadline of its own, after delivery", async () => {
    let filedAfterSend = false;
    const transport = recorder();
    const result = await sendMessage(
      config({ sentMailbox: "Sent", upstreamTimeoutMs: 30 }),
      {
        async sendMail(payload) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return transport.sendMail(payload);
        }
      },
      minimal,
      {
        fileInSent: async () => {
          filedAfterSend = transport.calls.length === 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return true;
        }
      }
    );
    // 20 ms and 20 ms: each leg fits its own 30 ms, together they would not.
    expect(filedAfterSend).toBe(true);
    expect(result.filedInSent).toBe(true);
  });

  it("fails when delivery itself does not answer", async () => {
    await expect(
      sendMessage(config({ upstreamTimeoutMs: 20 }), { sendMail: never }, minimal)
    ).rejects.toThrow(/Send timed out/);
  });
});

describe("sentMailboxFor, asking the server", () => {
  const account = (overrides = {}) =>
    config({
      sentMailbox: null,
      imap: { host: "imap.example.com", port: 993, auth: { user: "post@example.com" } },
      ...overrides
    });

  const server = (mailboxes, capabilities = ["IMAP4REV1", "SPECIAL-USE"]) => {
    const calls = { list: 0 };
    return {
      calls,
      capabilities: new Map(capabilities.map((name) => [name, true])),
      async list() {
        calls.list += 1;
        return mailboxes;
      }
    };
  };

  const sentItems = {
    path: "Sent Items",
    specialUse: "\\Sent",
    specialUseSource: "extension",
    flags: new Set(["\\Sent"])
  };

  it("uses SENT_MAILBOX without asking the server", async () => {
    const client = server([sentItems]);
    expect(await sentMailboxFor(account({ sentMailbox: "Ausgang" }), client, new Map())).toEqual({
      mailbox: "Ausgang",
      filedByServer: false
    });
    expect(client.calls.list).toBe(0);
  });

  it("asks once per account and remembers the answer", async () => {
    const cache = new Map();
    const client = server([sentItems]);
    expect((await sentMailboxFor(account(), client, cache)).mailbox).toBe("Sent Items");
    expect((await sentMailboxFor(account(), client, cache)).mailbox).toBe("Sent Items");
    expect(client.calls.list).toBe(1);
  });

  it("reads Gmail from the capabilities the connection reported", async () => {
    const client = server([{ ...sentItems, path: "[Gmail]/Sent Mail" }], ["X-GM-EXT-1"]);
    expect(await sentMailboxFor(account(), client, new Map())).toEqual({
      mailbox: null,
      filedByServer: true
    });
  });

  it("falls back for this send, and asks again next time, when LIST fails", async () => {
    const cache = new Map();
    const failing = {
      capabilities: new Map(),
      async list() {
        throw new Error("LIST refused");
      }
    };
    expect((await sentMailboxFor(account(), failing, cache)).mailbox).toBe("Sent");
    expect(cache.size).toBe(0);
  });
});

describe("sendMessage, what the server refused", () => {
  it("reports the recipients the server turned down", async () => {
    const { result } = await send(
      { ...minimal, cc: ["weg@example.com"] },
      {},
      {
        accepted: ["kunde@example.com"],
        rejected: ["weg@example.com"]
      }
    );
    expect(result.rejected).toEqual(["weg@example.com"]);
  });

  it("reports none when the server says nothing about refusals", async () => {
    const { result } = await send(minimal, {}, {});
    expect(result.rejected).toEqual([]);
  });
});

describe("sendMessage, a send whose outcome is unknown", () => {
  function failing(err) {
    return {
      async sendMail() {
        throw err;
      }
    };
  }

  it("says so when its own deadline ran out", async () => {
    await expect(
      sendMessage(config(), failing(new TimeoutError("Send", 1000)), minimal)
    ).rejects.toBeInstanceOf(SendUnconfirmedError);
  });

  it("says so when the connection dropped or fell silent while the server held the message", async () => {
    // nodemailer's own shapes: a socket closed by the far end, and its socket
    // timeout. Neither names the command that was in flight.
    const dropped = Object.assign(new Error("Connection closed unexpectedly"), {
      code: "ECONNECTION",
      command: "CONN"
    });
    await expect(sendMessage(config(), failing(dropped), minimal)).rejects.toBeInstanceOf(
      SendUnconfirmedError
    );
    const silent = Object.assign(new Error("Timeout"), { code: "ETIMEDOUT", command: "CONN" });
    expect(isUnconfirmed(silent)).toBe(true);
    expect(isUnconfirmed(Object.assign(new Error("read ECONNRESET"), { code: "ESOCKET" }))).toBe(
      true
    );
    expect(isUnconfirmed(Object.assign(new Error("write EPIPE"), { code: "ESOCKET" }))).toBe(true);
  });

  it("reports a refusal the server answered as the failure it is", async () => {
    const refused = Object.assign(new Error("554 rejected"), {
      command: "DATA",
      responseCode: 554
    });
    await expect(sendMessage(config(), failing(refused), minimal)).rejects.toBe(refused);
    const login = Object.assign(new Error("535 auth"), {
      command: "AUTH PLAIN",
      responseCode: 535
    });
    expect(isUnconfirmed(login)).toBe(false);
    // A server that hangs up with a word is a server that answered.
    const terminated = Object.assign(new Error("Server terminates connection. response=421 busy"), {
      code: "ECONNECTION",
      command: "EHLO",
      responseCode: 421
    });
    expect(isUnconfirmed(terminated)).toBe(false);
  });

  it("does not mistake a line that never opened for one that dropped", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:465"), {
      code: "ECONNECTION",
      command: "CONN"
    });
    expect(isUnconfirmed(refused)).toBe(false);
    expect(
      isUnconfirmed(Object.assign(new Error("Greeting never received"), { code: "ETIMEDOUT" }))
    ).toBe(false);
    expect(isUnconfirmed(new Error("Connection closed unexpectedly"))).toBe(false);
  });
});

describe("sendMessage, the copy in Sent", () => {
  const filedLater = (result) => ({ fileInSent: async () => result });

  it("says in the log why the copy was not filed, and still reports the send", async () => {
    const lines = [];
    const log = (level, message) => lines.push(`${level}: ${message}`);
    const result = await sendMessage(config(), recorder(), minimal, {
      fileInSent: async () => {
        throw new Error("APPEND refused: no such mailbox");
      },
      log
    });
    expect(result.filedInSent).toBe(false);
    expect(lines).toEqual([
      expect.stringMatching(/^warn: sent copy of <.*> not filed: APPEND refused/)
    ]);
  });

  it("names the deadline when the Sent folder did not answer in time", async () => {
    const lines = [];
    const result = await sendMessage(config({ upstreamTimeoutMs: 10 }), recorder(), minimal, {
      fileInSent: () => new Promise(() => {}),
      log: (level, message) => lines.push(`${level}: ${message}`)
    });
    expect(result.filedInSent).toBe(false);
    expect(lines[0]).toMatch(/^warn: .*Filing in Sent timed out/);
  });

  it("reports a filed copy without a word in the log", async () => {
    const lines = [];
    const result = await sendMessage(config(), recorder(), minimal, {
      ...filedLater(true),
      log: (...args) => lines.push(args)
    });
    expect(result.filedInSent).toBe(true);
    expect(lines).toEqual([]);
  });
});

describe("sendMessage, pictures", () => {
  it("attaches them to the bytes that are delivered, and so to the copy in Sent", async () => {
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
    const { raw } = await send({
      ...minimal,
      attachments: [{ filename: "abbildung-1.png", contentType: "image/png", content }]
    });
    expect(raw).toContain("Content-Type: image/png; name=abbildung-1.png");
    expect(raw).toContain(content.toString("base64"));
  });

  it("sends a plain text mail when there are none", async () => {
    const { raw } = await send({ ...minimal, attachments: [] });
    expect(raw).not.toContain("multipart");
  });
});
