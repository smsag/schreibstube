import { describe, expect, it } from "vitest";
import { createConnectionPool } from "./connection-pool.mjs";
import { joinRemote } from "./path.mjs";
import { createShareRoutes, SHARES_FILE, SWEEP_RETRY_MS } from "./share-routes.mjs";
import { decryptPayload } from "./client/share-unlock.mjs";
import { SHARE_INDEX_GUARD } from "./share.mjs";

/**
 * The share routes against a host held in memory: which files a link is,
 * what its record says, and that only the link's own files are ever removed.
 */

const TOKEN = "publish-token-for-the-test-0123";
const AUTH = `Bearer ${TOKEN}`;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function memoryHost({ fail = null } = {}) {
  const files = new Map();
  let logins = 0;
  const state = { down: false };
  const remote = {
    absolute: (relative) => joinRemote("/site", relative),
    stateAbsolute: (relative) => `/state/${relative}`,
    async exists(path) {
      if (files.has(path)) return "-";
      return [...files.keys()].some((name) => name.startsWith(`${path}/`)) ? "d" : false;
    },
    async readJson(path) {
      if (state.down) throw new Error("connection lost");
      return files.has(path) ? JSON.parse(files.get(path).toString("utf8")) : null;
    },
    async writeAbsolute(path, content) {
      files.set(path, Buffer.from(content));
    },
    async writeFile(relative, content) {
      files.set(remote.absolute(relative), Buffer.from(content));
    },
    async remove(relative) {
      if (fail?.(relative)) throw new Error("permission denied");
      files.delete(remote.absolute(relative));
    },
    async pruneEmptyDirectories() {
      return 0;
    },
    onClose() {},
    async end() {}
  };
  const pool = createConnectionPool({
    connect: async () => {
      logins += 1;
      return remote;
    },
    setTimer: () => 0,
    clearTimer: () => {}
  });
  return {
    files,
    pool,
    state,
    get logins() {
      return logins;
    },
    text: (path) => files.get(path)?.toString("utf8")
  };
}

function setup({ htaccess = false, stateInsideRoot = false, fail } = {}) {
  const host = memoryHost({ fail });
  const clock = { at: Date.parse("2026-10-19T12:00:00Z") };
  const logged = [];
  const config = {
    requestTimeoutMs: 30_000,
    publish: {
      token: TOKEN,
      maxSourceBytes: 100_000,
      maxImageBytes: 100_000,
      targets: {
        blog: {
          name: "blog",
          baseUrl: "https://blog.example.com",
          allowHtml: true,
          htaccess,
          stateInsideRoot
        }
      }
    }
  };
  const shares = createShareRoutes(config, {
    now: () => clock.at,
    pool: host.pool,
    log: (level, message) => logged.push({ level, message })
  });
  const call = (method, path, input = {}) => {
    const route = shares.routes.find((entry) => entry.method === method && entry.path === path);
    return route.handler({
      body: input.body,
      query: new URLSearchParams(input.query ?? {}),
      authorization: input.authorization ?? AUTH,
      log: () => {}
    });
  };
  return {
    host,
    clock,
    logged,
    shares,
    share: (body) => call("POST", "/publish/share", { body: { target: "blog", ...body } }),
    list: () => call("GET", "/publish/shares", { query: { target: "blog" } }),
    revoke: (code) => call("POST", "/publish/share/revoke", { body: { target: "blog", code } }),
    record: () => JSON.parse(host.text(`/state/${SHARES_FILE}`))
  };
}

const note = {
  title: "Angebot",
  sourcePath: "Kunden/Angebot.md",
  source: "# Angebot\n\nSiehe ![[bild.png]] und [[Preise]].\n"
};
const picture = { sourcePath: "Anhänge/bild.png", data: PNG.toString("base64") };

describe("POST /publish/share", () => {
  it("writes an open link as one page that carries its pictures", async () => {
    const { host, share, record } = setup();
    const answer = await share({ ...note, assets: [picture] });

    expect(answer).toMatchObject({
      url: `https://blog.example.com/s/${answer.code}/`,
      title: "Angebot",
      protected: false,
      expiresAt: null,
      createdAt: "2026-10-19T12:00:00.000Z"
    });
    const page = host.text(`/site/s/${answer.code}/index.html`);
    expect(page).toContain("<title>Angebot</title>");
    expect(page).toContain("data:image/png;base64,");
    expect(page).toContain("Preise");
    expect(host.files.has(`/site/s/${answer.code}/theme.css`)).toBe(true);
    expect(host.files.has(`/site/s/${answer.code}/unlock.js`)).toBe(false);
    expect(host.text("/site/s/index.html")).toBe(SHARE_INDEX_GUARD);
    expect(record().shares[0]).toMatchObject({
      code: answer.code,
      sourcePath: "Kunden/Angebot.md",
      files: [`s/${answer.code}/index.html`, `s/${answer.code}/theme.css`]
    });
  });

  it("writes a protected link as ciphertext the password opens", async () => {
    const { host, share } = setup();
    const answer = await share({ ...note, password: "korrekt-pferd" });
    const page = host.text(`/site/s/${answer.code}/index.html`);

    expect(answer.protected).toBe(true);
    expect(page).not.toContain("Angebot");
    expect(host.files.has(`/site/s/${answer.code}/unlock.js`)).toBe(true);
    const payload = JSON.parse(/id="share-payload">(.*)<\/script>/.exec(page)[1]);
    const opened = await decryptPayload(payload, "korrekt-pferd");
    expect(opened.html).toContain("<h1");
    expect(opened.title).toBe("Angebot");
  });

  it("writes the closing rule for a host that reads .htaccess", async () => {
    const { host, share } = setup({ htaccess: true });
    const answer = await share({ ...note, expiresAt: "2026-10-26T12:00:00Z" });
    expect(answer.expiresAt).toBe("2026-10-26T12:00:00.000Z");
    expect(host.text(`/site/s/${answer.code}/.htaccess`)).toContain("20261026120000");
  });

  it("guards a state directory inside the web root", async () => {
    const { host, share } = setup({ stateInsideRoot: true });
    await share(note);
    expect(host.text("/state/.htaccess")).toContain("Require all denied");
  });

  it("rewrites a link in place, removing the files it no longer needs", async () => {
    const { host, share, clock, record } = setup();
    const first = await share({ ...note, password: "korrekt-pferd" });
    clock.at += 60_000;
    const second = await share({ ...note, code: first.code, source: "Neu.\n" });

    expect(second.code).toBe(first.code);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe("2026-10-19T12:01:00.000Z");
    expect(second.protected).toBe(false);
    expect(host.files.has(`/site/s/${first.code}/unlock.js`)).toBe(false);
    expect(host.text(`/site/s/${first.code}/index.html`)).toContain("Neu.");
    expect(record().shares).toHaveLength(1);
  });

  it("keeps a file it could not remove in the record, so it is tried again", async () => {
    const { share, record } = setup({ fail: (path) => path.endsWith("unlock.js") });
    const first = await share({ ...note, password: "korrekt-pferd" });
    await share({ ...note, code: first.code });
    expect(record().shares[0].files).toContain(`s/${first.code}/unlock.js`);
  });

  it("refuses a code it does not know, a request that does not check, and another site's token", async () => {
    const { share, shares } = setup();
    await expect(share({ ...note, code: "ABCDEFGHJK" })).rejects.toMatchObject({
      status: 404,
      code: "unknown_share"
    });
    await expect(share({ ...note, password: "kurz" })).rejects.toMatchObject({
      status: 400,
      code: "invalid_share"
    });
    const route = shares.routes.find((entry) => entry.path === "/publish/share");
    await expect(
      route.handler({ body: { target: "blog", ...note }, authorization: "Bearer other", log() {} })
    ).rejects.toMatchObject({ status: 404, code: "unknown_target" });
  });
});

describe("GET /publish/shares", () => {
  it("lists the open links newest first, and takes down those whose time is up", async () => {
    const { host, share, list, clock } = setup();
    const soon = await share({ ...note, title: "Bald", expiresAt: "2026-10-19T13:00:00Z" });
    clock.at += 1_000;
    const later = await share({ ...note, title: "Später" });

    expect((await list()).shares.map((entry) => entry.code)).toEqual([later.code, soon.code]);
    clock.at = Date.parse("2026-10-19T13:00:00Z");
    expect((await list()).shares.map((entry) => entry.code)).toEqual([later.code]);
    expect(host.files.has(`/site/s/${soon.code}/index.html`)).toBe(false);
    expect(host.files.has(`/site/s/${later.code}/index.html`)).toBe(true);
  });
});

describe("POST /publish/share/revoke", () => {
  it("removes the link's files and its record, and nothing else", async () => {
    const { host, share, revoke, list } = setup();
    const kept = await share(note);
    const gone = await share(note);
    await expect(revoke(gone.code)).resolves.toEqual({ code: gone.code, revoked: true });

    expect([...host.files.keys()].some((path) => path.includes(gone.code))).toBe(false);
    expect(host.files.has(`/site/s/${kept.code}/index.html`)).toBe(true);
    expect((await list()).shares.map((entry) => entry.code)).toEqual([kept.code]);
  });

  it("refuses what is not a code, and a code it does not know", async () => {
    const { revoke } = setup();
    await expect(revoke("../x")).rejects.toMatchObject({ status: 400 });
    await expect(revoke("ABCDEFGHJK")).rejects.toMatchObject({ status: 404 });
  });

  it("says when a file stayed, and closes the record so the sweep tries again", async () => {
    const { share, revoke, record } = setup({ fail: (path) => path.endsWith("theme.css") });
    const answer = await share(note);
    await expect(revoke(answer.code)).resolves.toEqual({ code: answer.code, revoked: false });
    expect(record().shares[0]).toMatchObject({
      files: [`s/${answer.code}/theme.css`],
      expiresAt: "1970-01-01T00:00:00.000Z"
    });
  });
});

describe("sweep", () => {
  it("reads each target once, then logs in only when a link is due", async () => {
    const { host, shares, share, clock, logged } = setup();
    await shares.sweep();
    expect(host.logins).toBe(1);
    await shares.sweep();
    expect(host.logins).toBe(1);

    const answer = await share({ ...note, expiresAt: "2026-10-19T12:30:00Z" });
    const before = host.logins;
    await shares.sweep();
    expect(host.logins).toBe(before);

    clock.at = Date.parse("2026-10-19T12:30:00Z");
    await shares.sweep();
    expect(host.files.has(`/site/s/${answer.code}/index.html`)).toBe(false);
    expect(logged.some((entry) => entry.message.includes("expired"))).toBe(true);
  });

  it("waits before it tries a host it could not reach again", async () => {
    const { shares, clock, logged, host } = setup();
    host.state.down = true;
    await shares.sweep();
    expect(logged.at(-1)).toMatchObject({ level: "warn" });

    const logins = host.logins;
    clock.at += SWEEP_RETRY_MS - 1;
    await shares.sweep();
    expect(host.logins).toBe(logins);
  });

  it("runs on a timer that can be stopped", () => {
    const { shares } = setup();
    const stop = shares.start(1_000_000);
    expect(typeof stop).toBe("function");
    stop();
  });
});
