import { beforeEach, describe, expect, it, vi } from "vitest";
import MailComposer from "nodemailer/lib/mail-composer";

/**
 * The attachments route, from the request to the answer, with only ImapFlow
 * replaced. The messages are genuine multipart mails built by nodemailer and
 * read by mailparser, so what is kept is what a real mail would give.
 */

const imap = vi.hoisted(() => ({
  messages: new Map(),
  fetched: [],
  failConnect: null,
  released: 0,
  loggedOut: 0
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    async connect() {
      if (imap.failConnect) throw new Error(imap.failConnect);
    }

    async getMailboxLock() {
      return {
        release: () => {
          imap.released += 1;
        }
      };
    }

    async fetchOne(uid, query, options) {
      imap.fetched.push({ uid, query, options });
      const source = imap.messages.get(Number(uid));
      if (!source) return false;
      return query.source
        ? { uid: Number(uid), source }
        : { uid: Number(uid), size: source.length };
    }

    async logout() {
      imap.loggedOut += 1;
    }

    close() {}
  }
}));

const { createMailRoutes, validateAttachmentsRequest } = await import("./mail-routes.mjs");
const { MAX_IMPORT_MESSAGE_BYTES } = await import("./mail-import.mjs");

async function mail(uid, attachments, html = "<p>Sehr geehrter Herr Seitz</p>") {
  const source = await new MailComposer({
    from: "info@nascor-hausverwaltung.de",
    to: "steffen@smsag.de",
    subject: "AW: Fristsetzung",
    text: "Sehr geehrter Herr Seitz",
    html,
    attachments
  })
    .compile()
    .build();
  imap.messages.set(uid, source);
}

function attachmentsRoute() {
  const config = {
    upstreamTimeoutMs: 1000,
    requestTimeoutMs: 1000,
    mail: {
      imap: { host: "imap.example.com", port: 993, secure: true, auth: {} },
      defaultMailbox: "INBOX",
      maxTextChars: 40_000,
      maxBodyBytes: 1_000_000
    }
  };
  const route = createMailRoutes(config, { transport: {} }).find(
    (candidate) => candidate.path === "/attachments"
  );
  const lines = [];
  return {
    route,
    lines,
    call: (body) => route.handler({ body, log: (level, text) => lines.push([level, text]) })
  };
}

beforeEach(() => {
  imap.messages = new Map();
  imap.fetched = [];
  imap.failConnect = null;
  imap.released = 0;
  imap.loggedOut = 0;
});

describe("POST /attachments", () => {
  it("hands over the files a mail was sent with, in base64", async () => {
    const pdf = Buffer.from("%PDF-1.7 Protokoll");
    await mail(7, [
      { filename: "Protokoll 2025.pdf", content: pdf, contentType: "application/pdf" }
    ]);
    const { call, lines } = attachmentsRoute();

    const result = await call({ uid: 7 });

    expect(result).toEqual({
      uid: 7,
      attachments: [
        {
          filename: "Protokoll 2025.pdf",
          contentType: "application/pdf",
          content: pdf.toString("base64")
        }
      ],
      skipped: []
    });
    expect(lines).toEqual([["info", "attachments of 7: 1 handed over, 0 left out"]]);
    expect(imap.released).toBe(1);
    expect(imap.loggedOut).toBe(1);
  });

  it("leaves a signature's logo out and names what it cannot hand over", async () => {
    await mail(
      8,
      [
        {
          filename: "image001.png",
          content: Buffer.alloc(3_000, 1),
          contentType: "image/png",
          cid: "image001.png@01DD"
        },
        { filename: "Termin.ics", content: "BEGIN:VCALENDAR", contentType: "text/calendar" },
        { filename: "Foto.jpg", content: Buffer.alloc(5_000, 2), contentType: "image/jpeg" }
      ],
      '<p>Gruß</p><img src="cid:image001.png@01DD">'
    );
    const { call } = attachmentsRoute();

    const result = await call({ uid: 8, mailbox: "INBOX" });

    expect(result.attachments.map((entry) => entry.filename)).toEqual(["Foto.jpg"]);
    expect(result.skipped).toEqual([{ filename: "Termin.ics", reason: "type" }]);
  });

  it("asks the size first and does not download a mail too large to hold", async () => {
    imap.messages.set(9, { length: MAX_IMPORT_MESSAGE_BYTES + 1 });
    const { call } = attachmentsRoute();

    await expect(call({ uid: 9 })).rejects.toMatchObject({
      status: 413,
      code: "message_too_large"
    });
    expect(imap.fetched.map((entry) => Object.keys(entry.query))).toEqual([["uid", "size"]]);
    expect(imap.fetched[0].options).toEqual({ uid: true });
  });

  it("says a message that has moved since the search is gone", async () => {
    const { call } = attachmentsRoute();
    await expect(call({ uid: 404 })).rejects.toMatchObject({ status: 404, code: "message_gone" });
  });

  it("answers a server that cannot be reached as a bad gateway", async () => {
    imap.failConnect = "ECONNREFUSED";
    const { call } = attachmentsRoute();
    await expect(call({ uid: 1 })).rejects.toMatchObject({
      status: 502,
      code: "upstream_error",
      message: "Fetching attachments failed: ECONNREFUSED"
    });
  });

  it("refuses a request that names no message", async () => {
    const { call } = attachmentsRoute();
    await expect(call({ uid: "7" })).rejects.toMatchObject({ status: 400 });
    expect(imap.fetched).toEqual([]);
  });

  it("gives itself longer than a search", () => {
    const { route } = attachmentsRoute();
    expect(route.timeoutMs).toBe(2 * 1000 + 5_000);
  });
});

describe("validateAttachmentsRequest", () => {
  it("takes a UID and an optional mailbox", () => {
    expect(validateAttachmentsRequest({ uid: 246544 })).toBeNull();
    expect(validateAttachmentsRequest({ uid: 1, mailbox: "Archiv" })).toBeNull();
  });

  it("refuses anything that is not a UID", () => {
    for (const uid of [undefined, 0, -1, 1.5, "7", 2 ** 32]) {
      expect(validateAttachmentsRequest({ uid })).toMatch(/uid must be/);
    }
  });

  it("refuses a mailbox that is not a short string", () => {
    expect(validateAttachmentsRequest({ uid: 1, mailbox: 3 })).toMatch(/mailbox must be/);
    expect(validateAttachmentsRequest({ uid: 1, mailbox: "x".repeat(300) })).toMatch(/limit/);
  });
});
