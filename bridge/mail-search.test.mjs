import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterisation tests for the search path.
 *
 * ImapFlow is replaced by a fake that records what it was asked for and replays
 * a fixed set of messages. Everything above the protocol — query construction,
 * the result window, parsing and truncation — is exercised for real, including
 * mailparser.
 */

const imap = vi.hoisted(() => ({
  uids: [],
  sources: new Map(),
  opened: [],
  queries: [],
  released: 0,
  loggedOut: 0,
  failSearch: null
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    async connect() {}

    async getMailboxLock(mailbox) {
      imap.opened.push(mailbox);
      return {
        release: () => {
          imap.released += 1;
        }
      };
    }

    async search(query) {
      imap.queries.push(query);
      if (imap.failSearch) throw new Error(imap.failSearch);
      return imap.uids;
    }

    async *fetch(window) {
      for (const uid of window) {
        yield { uid, source: Buffer.from(imap.sources.get(uid) ?? "") };
      }
    }

    async logout() {
      imap.loggedOut += 1;
    }

    close() {}
  }
}));

const { searchMessages } = await import("./mail.mjs");

function config(overrides = {}) {
  return {
    imap: { host: "imap.example.com", port: 993, secure: true, auth: {} },
    defaultMailbox: "INBOX",
    maxResults: 50,
    maxTextChars: 40_000,
    ...overrides
  };
}

/** A minimal but genuine RFC 5322 message, so mailparser does real work. */
function message({
  uid,
  subject = "Betreff",
  date = "Mon, 07 Sep 2026 10:12:00 +0000",
  headers = "",
  body = "Inhalt"
}) {
  imap.uids.push(uid);
  imap.sources.set(
    uid,
    [
      `From: Absender <absender@example.com>`,
      `To: post@example.com`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      `Message-ID: <${uid}@example.com>`,
      ...(headers ? [headers] : []),
      "",
      body
    ].join("\r\n")
  );
}

beforeEach(() => {
  imap.uids = [];
  imap.sources = new Map();
  imap.opened = [];
  imap.queries = [];
  imap.released = 0;
  imap.loggedOut = 0;
  imap.failSearch = null;
});

describe("searchMessages, the mailbox", () => {
  it("falls back to the configured default", async () => {
    const result = await searchMessages(config(), {});
    expect(result.mailbox).toBe("INBOX");
    expect(imap.opened).toEqual(["INBOX"]);
  });

  it("uses and trims a requested mailbox", async () => {
    const result = await searchMessages(config(), { mailbox: "  Archiv  " });
    expect(result.mailbox).toBe("Archiv");
  });

  it("releases the lock and logs out on the way", async () => {
    await searchMessages(config(), {});
    expect(imap.released).toBe(1);
    expect(imap.loggedOut).toBe(1);
  });

  it("still releases and logs out when the search fails", async () => {
    imap.failSearch = "NO [AUTHENTICATIONFAILED]";
    await expect(searchMessages(config(), {})).rejects.toThrow("AUTHENTICATIONFAILED");
    expect(imap.released).toBe(1);
    expect(imap.loggedOut).toBe(1);
  });

  it("returns an empty result without fetching when nothing matches", async () => {
    const result = await searchMessages(config(), {});
    expect(result).toEqual({ messages: [], mailbox: "INBOX", truncated: false });
  });
});

describe("searchMessages, the query", () => {
  async function queryFor(criteria) {
    await searchMessages(config(), { criteria });
    return imap.queries[0];
  }

  it("matches everything when no criterion is given", async () => {
    expect(await queryFor({})).toEqual({ all: true });
  });

  it("ignores blank criteria", async () => {
    expect(await queryFor({ from: "  ", subject: "" })).toEqual({ all: true });
  });

  it("trims the text criteria", async () => {
    expect(await queryFor({ from: " a@example.com " })).toEqual({ from: "a@example.com" });
  });

  it("combines distinct criteria into one object, which IMAP ANDs", async () => {
    expect(await queryFor({ from: "a@example.com", subject: "Angebot", text: "Objekt" })).toEqual({
      from: "a@example.com",
      subject: "Angebot",
      text: "Objekt"
    });
  });

  it("parses a since date", async () => {
    const query = await queryFor({ since: "2026-09-01" });
    expect(query.since).toEqual(new Date("2026-09-01"));
  });

  it("drops an unparseable since date rather than searching on NaN", async () => {
    expect(await queryFor({ since: "irgendwann" })).toEqual({ all: true });
  });

  it("looks for a thread in both References and In-Reply-To", async () => {
    expect(await queryFor({ references: " <a@example.com> " })).toEqual({
      or: [
        { header: { references: "<a@example.com>" } },
        { header: { "in-reply-to": "<a@example.com>" } }
      ]
    });
  });
});

describe("searchMessages, the result window", () => {
  function withMessages(count) {
    for (let uid = 1; uid <= count; uid += 1) {
      message({ uid, subject: `Betreff ${uid}` });
    }
  }

  it("defaults to the newest twenty-five", async () => {
    withMessages(30);
    const result = await searchMessages(config(), {});
    expect(result.messages).toHaveLength(25);
    expect(result.messages.map((m) => m.uid)).toContain(30);
    expect(result.messages.map((m) => m.uid)).not.toContain(5);
    expect(result.truncated).toBe(true);
  });

  it("honours a requested limit", async () => {
    withMessages(10);
    const result = await searchMessages(config(), { limit: 3 });
    expect(result.messages.map((m) => m.uid)).toEqual([8, 9, 10]);
  });

  it("caps a requested limit at maxResults", async () => {
    withMessages(10);
    const result = await searchMessages(config({ maxResults: 4 }), { limit: 999 });
    expect(result.messages).toHaveLength(4);
  });

  it("treats a negative or unparseable limit as the default, never as an offset", async () => {
    withMessages(30);
    for (const limit of [-5, 0, "abc", null]) {
      imap.queries = [];
      const result = await searchMessages(config(), { limit });
      expect(result.messages).toHaveLength(25);
      expect(result.messages.map((m) => m.uid)).toContain(30);
    }
  });

  it("reports no truncation when the window covers every match", async () => {
    withMessages(3);
    const result = await searchMessages(config(), { limit: 10 });
    expect(result.truncated).toBe(false);
  });
});

describe("searchMessages, the parsed message", () => {
  it("returns the fields the plugin reads", async () => {
    message({
      uid: 7,
      subject: "Angebot 4711",
      date: "Mon, 07 Sep 2026 10:12:00 +0000",
      headers: "In-Reply-To: <original@example.com>\r\nReferences: <original@example.com>",
      body: "Guten Tag"
    });

    const [msg] = (await searchMessages(config(), {})).messages;
    expect(msg).toEqual({
      uid: 7,
      messageId: "<7@example.com>",
      inReplyTo: "<original@example.com>",
      references: ["<original@example.com>"],
      from: '"Absender" <absender@example.com>',
      to: "post@example.com",
      subject: "Angebot 4711",
      date: "2026-09-07T10:12:00.000Z",
      text: "Guten Tag",
      truncated: false
    });
  });

  it("returns references as an array even for a single one", async () => {
    message({ uid: 1, headers: "References: <a@example.com>" });
    const [msg] = (await searchMessages(config(), {})).messages;
    expect(msg.references).toEqual(["<a@example.com>"]);
  });

  it("returns an empty array when there are no references", async () => {
    message({ uid: 1 });
    const [msg] = (await searchMessages(config(), {})).messages;
    expect(msg.references).toEqual([]);
  });

  it("sorts the window oldest first", async () => {
    message({ uid: 1, date: "Mon, 07 Sep 2026 12:00:00 +0000" });
    message({ uid: 2, date: "Mon, 07 Sep 2026 08:00:00 +0000" });
    const result = await searchMessages(config(), {});
    expect(result.messages.map((m) => m.uid)).toEqual([2, 1]);
  });

  it("truncates the body at the configured limit and says so", async () => {
    message({ uid: 1, body: "Ein längerer Text" });
    const [msg] = (await searchMessages(config({ maxTextChars: 5 }), {})).messages;
    expect(msg.text).toBe("Ein l");
    expect(msg.truncated).toBe(true);
  });

  it("falls back to stripped HTML for a message with no plain part", async () => {
    imap.uids.push(1);
    imap.sources.set(
      1,
      [
        "From: absender@example.com",
        "To: post@example.com",
        "Subject: HTML",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<div><p>Erste Zeile</p><p>Zweite &amp; letzte</p><script>weg()</script></div>"
      ].join("\r\n")
    );

    const [msg] = (await searchMessages(config(), {})).messages;
    expect(msg.text).toBe("Erste Zeile\n\nZweite & letzte");
  });
});

describe("a search body the caller got wrong", () => {
  it("is answered as a bad request, not as a bad gateway", async () => {
    const { createMailRoutes } = await import("./mail-routes.mjs");
    const routes = createMailRoutes({
      mail: { ...config(), smtp: { host: "smtp.example.com", port: 465, secure: true, auth: {} } },
      upstreamTimeoutMs: 1000
    });
    const search = routes.find((route) => route.path === "/search");

    for (const body of [
      { mailbox: 5 },
      { criteria: { from: 1 } },
      { criteria: "kunde" },
      { criteria: { since: "irgendwann" } }
    ]) {
      // A wrongly typed field used to reach the IMAP call, throw a TypeError
      // there, and come back as a 502 quoting the bridge's own source.
      const error = await search.handler({ body, log: () => {} }).catch((err) => err);
      expect(error.status).toBe(400);
      expect(error.code).toBe("invalid_request");
    }
  });
});
