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
  envelopes: new Map(),
  scans: [],
  opened: [],
  queries: [],
  released: 0,
  loggedOut: 0,
  failSearch: null,
  broken: new Set(),
  refuseSearch: null,
  serverFinds: null,
  capabilities: [],
  withinAtSearch: [],
  fetchNothing: false
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(options) {
      this.options = options;
    }

    async connect() {}

    async getMailboxLock(mailbox) {
      imap.opened.push(mailbox);
      this.mailbox = { path: mailbox, exists: imap.uids.length, uidNext: imap.uids.length + 1 };
      this.capabilities = new Map(imap.capabilities.map((name) => [name, true]));
      return {
        release: () => {
          imap.released += 1;
        }
      };
    }

    async search(query) {
      imap.queries.push(query);
      imap.withinAtSearch.push(this.capabilities.has("WITHIN"));
      if (imap.failSearch) throw new Error(imap.failSearch);
      // What imapflow does with a NO or BAD: log it, answer false.
      if (imap.refuseSearch) {
        this.options.logger.warn?.({ err: imap.refuseSearch, cid: "c1" });
        return false;
      }
      // A server whose search answers with less than the mailbox holds.
      if (imap.serverFinds) return imap.serverFinds;
      return imap.uids;
    }

    async *fetch(window, items, options) {
      // What imapflow does when no mailbox is selected: yield nothing.
      if (imap.fetchNothing) return;
      // Without `uid: true` the ids are sequence numbers, as the scan sends.
      const byUid = options?.uid === true;
      if (items.envelope) imap.scans.push({ window, items, byUid });
      for (const id of window) {
        const uid = byUid ? id : imap.uids[id - 1];
        // A message the server will not hand over fails the whole command,
        // after the ones before it have already arrived.
        if (imap.broken.has(uid)) throw new Error("NO [SERVERBUG] Internal error");
        yield items.envelope
          ? { uid, ...imap.envelopes.get(uid) }
          : { uid, source: Buffer.from(imap.sources.get(uid) ?? "") };
      }
    }

    async logout() {
      imap.loggedOut += 1;
    }

    close() {}
  }
}));

const {
  HTML_TEXT_RATIO,
  MAX_REFUSAL_CHARS,
  fetchEach,
  htmlToText,
  ignoreWithin,
  refusalMessage,
  searchMessages
} = await import("./mail.mjs");
const { MAX_FALLBACK_SCAN } = await import("./mail-match.mjs");

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
  imap.envelopes.set(uid, {
    envelope: {
      from: [{ name: "Absender", address: "absender@example.com" }],
      to: [{ address: "post@example.com" }],
      subject
    },
    internalDate: new Date(date),
    headers: Buffer.from(headers ? `${headers}\r\n` : "")
  });
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
  imap.envelopes = new Map();
  imap.scans = [];
  imap.broken = new Set();
  imap.opened = [];
  imap.queries = [];
  imap.released = 0;
  imap.loggedOut = 0;
  imap.failSearch = null;
  imap.refuseSearch = null;
  imap.serverFinds = null;
  imap.capabilities = [];
  imap.withinAtSearch = [];
  imap.fetchNothing = false;
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

  it("still refuses a body-text search the server refused, with its reason", async () => {
    message({ uid: 1 });
    imap.refuseSearch = Object.assign(new Error("Command failed"), {
      serverResponseCode: "BADCHARSET",
      response: "SEARCH\r\n  failed: unsupported"
    });
    await expect(searchMessages(config(), { criteria: { text: "Objekt" } })).rejects.toThrow(
      "The mail server refused the search: BADCHARSET SEARCH failed: unsupported"
    );
    expect(imap.released).toBe(1);
    expect(imap.loggedOut).toBe(1);
  });

  it("says so when a refusal came without a reason", async () => {
    imap.refuseSearch = {};
    await expect(searchMessages(config(), { criteria: { text: "Objekt" } })).rejects.toThrow(
      /^The mail server refused the search\.$/
    );
  });

  it("reports matches the server would not hand over", async () => {
    message({ uid: 1 });
    message({ uid: 2 });
    imap.fetchNothing = true;
    await expect(searchMessages(config(), {})).rejects.toThrow(
      "The mail server found 2 message(s) but returned none of them."
    );
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

describe("searchMessages, when the server refuses to search", () => {
  const refused = () => {
    imap.refuseSearch = Object.assign(new Error("Command failed"), { response: "NO busy" });
  };

  it("still returns the mail since a date, read from the newest messages", async () => {
    message({ uid: 1, date: "Mon, 21 Sep 2026 09:00:00 +0000" });
    message({ uid: 2, subject: "AW: Fristsetzung", date: "Mon, 28 Sep 2026 13:18:27 +0000" });
    message({ uid: 3, date: "Tue, 29 Sep 2026 08:00:00 +0000" });
    refused();
    const notes = [];

    const result = await searchMessages(
      config(),
      { criteria: { since: "2026-09-25" } },
      (level, text) => notes.push([level, text])
    );

    expect(result.messages.map((m) => m.uid)).toEqual([2, 3]);
    expect(result.truncated).toBe(false);
    expect(notes).toEqual([
      [
        "warn",
        "The mail server refused the search: NO busy; matching the newest 2000 messages instead"
      ],
      [
        "info",
        "search in INBOX (exists 3, uidNext 4, within no) on since: server found refused, own check found 2"
      ]
    ]);
  });

  it("matches the other criteria too", async () => {
    message({ uid: 1, subject: "Rechnung" });
    message({ uid: 2, subject: "AW: Fristsetzung", headers: "In-Reply-To: <a@localhost>" });
    refused();

    const bySubject = await searchMessages(config(), { criteria: { subject: "fristsetzung" } });
    expect(bySubject.messages.map((m) => m.uid)).toEqual([2]);

    const byThread = await searchMessages(config(), { criteria: { references: "<a@localhost>" } });
    expect(byThread.messages.map((m) => m.uid)).toEqual([2]);
  });

  it("reads only the newest messages, and says older ones went unread", async () => {
    for (let uid = 1; uid <= MAX_FALLBACK_SCAN + 5; uid += 1) {
      imap.uids.push(uid);
      imap.envelopes.set(uid, { envelope: { subject: "Rechnung" }, internalDate: new Date() });
    }
    refused();

    const result = await searchMessages(config(), { criteria: { subject: "Fristsetzung" } });

    const scan = imap.scans[0];
    expect(scan.byUid).toBe(false);
    expect(scan.window).toHaveLength(MAX_FALLBACK_SCAN);
    expect(scan.window[0]).toBe(6);
    expect(scan.items).toMatchObject({ uid: true, envelope: true, internalDate: true });
    expect(result).toEqual({ messages: [], mailbox: "INBOX", truncated: true });
  });

  it("returns nothing from an empty mailbox without reading", async () => {
    refused();
    const result = await searchMessages(config(), { criteria: { since: "2026-09-25" } });
    expect(result).toEqual({ messages: [], mailbox: "INBOX", truncated: false });
    expect(imap.scans).toEqual([]);
  });
});

describe("searchMessages, when the server finds nothing", () => {
  it("checks the newest messages itself and returns what it finds", async () => {
    message({ uid: 1, date: "Mon, 21 Sep 2026 09:00:00 +0000" });
    message({ uid: 2, subject: "AW: Fristsetzung", date: "Mon, 28 Sep 2026 13:18:27 +0000" });
    imap.serverFinds = [];
    const notes = [];

    const result = await searchMessages(
      config(),
      { criteria: { since: "2026-09-25" } },
      (level, text) => notes.push([level, text])
    );

    expect(result.messages.map((m) => m.uid)).toEqual([2]);
    expect(notes).toEqual([
      [
        "info",
        "search in INBOX (exists 2, uidNext 3, within no) on since: server found 0, own check found 1"
      ]
    ]);
  });

  it("takes an empty answer to a body-text search as it is", async () => {
    message({ uid: 1 });
    imap.serverFinds = [];
    const result = await searchMessages(config(), { criteria: { text: "Objekt" } });
    expect(result.messages).toEqual([]);
    expect(imap.scans).toEqual([]);
  });

  it("does not check again when the server found something", async () => {
    message({ uid: 1 });
    const notes = [];
    await searchMessages(config(), { criteria: { since: "2026-09-01" } }, (level, text) =>
      notes.push(text)
    );
    expect(imap.scans).toEqual([]);
    expect(notes[0]).toMatch(/server found 1, own check found not needed$/);
  });

  it("reports a refusal and whether the server offered WITHIN, naming criteria only", async () => {
    message({ uid: 1, subject: "Fristsetzung" });
    imap.capabilities = ["WITHIN"];
    imap.refuseSearch = {};
    const notes = [];
    await searchMessages(
      config(),
      { criteria: { subject: "Fristsetzung", from: "info@nascor.de", text: " " } },
      (level, text) => notes.push(text)
    );
    expect(notes[1]).toBe(
      "search in INBOX (exists 1, uidNext 2, within yes) on from+subject: server found refused, own check found 0"
    );
  });
});

describe("searchMessages, a message the server will not hand over", () => {
  function sinceTheTwentyFifth(count) {
    for (let uid = 1; uid <= count; uid += 1) {
      message({ uid, date: "Mon, 28 Sep 2026 13:18:27 +0000" });
    }
  }

  it("is left out of the scan, and the rest still found", async () => {
    sinceTheTwentyFifth(9);
    imap.serverFinds = [];
    imap.broken = new Set([4]);
    const notes = [];

    // The broken one fails the envelope scan, so it never reaches the bodies.
    const result = await searchMessages(
      config(),
      { criteria: { since: "2026-09-25" } },
      (level, text) => notes.push([level, text])
    );

    expect(result.messages.map((m) => m.uid)).toEqual([1, 2, 3, 5, 6, 7, 8, 9]);
    expect(notes).toContainEqual([
      "warn",
      "skipped 1 message(s) the server would not hand over (sequence number 4)"
    ]);
  });

  it("is left out of the bodies when the server's own search named it", async () => {
    sinceTheTwentyFifth(5);
    imap.broken = new Set([2]);
    const notes = [];

    const result = await searchMessages(config(), {}, (level, text) => notes.push([level, text]));

    expect(result.messages.map((m) => m.uid)).toEqual([1, 3, 4, 5]);
    expect(notes).toContainEqual([
      "warn",
      "skipped 1 message(s) the server would not hand over (UID 2)"
    ]);
  });

  it("names the first few and counts the rest", async () => {
    sinceTheTwentyFifth(30);
    imap.broken = new Set(Array.from({ length: 12 }, (_, i) => i + 1));
    const notes = [];
    await searchMessages(config(), { limit: 30 }, (level, text) => notes.push(text));
    expect(notes).toContain(
      "skipped 12 message(s) the server would not hand over (UID 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 2 more)"
    );
  });
});

describe("fetchEach", () => {
  it("still fails when the connection itself is gone", async () => {
    const client = {
      usable: false,
      // eslint-disable-next-line require-yield
      async *fetch() {
        throw new Error("Connection closed");
      }
    };
    await expect(
      fetchEach(client, [1, 2], {}, {}, () => {}, { seen: new Set(), skipped: [] })
    ).rejects.toThrow("Connection closed");
  });
});

describe("searchMessages, a server that advertises WITHIN", () => {
  it("is searched with SINCE all the same, and the log still says it offered WITHIN", async () => {
    message({ uid: 1, date: "Mon, 28 Sep 2026 13:18:27 +0000" });
    imap.capabilities = ["WITHIN", "IMAP4rev1"];
    const notes = [];

    const result = await searchMessages(
      config(),
      { criteria: { since: "2026-09-25" } },
      (level, text) => notes.push(text)
    );

    expect(imap.withinAtSearch).toEqual([false]);
    expect(imap.queries[0]).toEqual({ since: new Date("2026-09-25") });
    expect(result.messages.map((m) => m.uid)).toEqual([1]);
    expect(notes[0]).toMatch(/within yes\) on since: server found 1, own check found not needed$/);
  });
});

describe("ignoreWithin", () => {
  it("drops WITHIN and says whether it was there", () => {
    const client = {
      capabilities: new Map([
        ["WITHIN", true],
        ["IDLE", true]
      ])
    };
    expect(ignoreWithin(client)).toBe(true);
    expect([...client.capabilities.keys()]).toEqual(["IDLE"]);
    expect(ignoreWithin(client)).toBe(false);
  });

  it("leaves a client without a capability map alone", () => {
    expect(ignoreWithin({})).toBe(false);
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

describe("htmlToText", () => {
  it("reads only a few times the text limit of a huge HTML body before the regexes", () => {
    const limit = 10;
    const html = `<p>${"a".repeat(5)}</p>${"<b></b>".repeat(20)}<p>zzz</p>`;
    const text = htmlToText(html, limit);
    expect(text).toBe("aaaaa");
    expect(html.length).toBeGreaterThan(HTML_TEXT_RATIO * limit);
    expect(htmlToText("<p>Hallo</p><p>Welt</p>", 40_000)).toBe("Hallo\nWelt");
  });
});

describe("refusalMessage", () => {
  it("takes the most recent logged error", () => {
    const warnings = [
      { err: { response: "first" } },
      { msg: "no error" },
      { err: { response: "last" } }
    ];
    expect(refusalMessage("Refused", warnings)).toBe("Refused: last");
  });

  it("falls back to the error's own message", () => {
    expect(refusalMessage("Refused", [{ err: new Error("Connection closed") }])).toBe(
      "Refused: Connection closed"
    );
  });

  it("bounds what the server said", () => {
    const message = refusalMessage("Refused", [{ err: { response: "x".repeat(5000) } }]);
    expect(message).toHaveLength("Refused: ".length + MAX_REFUSAL_CHARS);
  });

  it("ends in a full stop when there is nothing to add", () => {
    expect(refusalMessage("Refused", [])).toBe("Refused.");
  });
});
