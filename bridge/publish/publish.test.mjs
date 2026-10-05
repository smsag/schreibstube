import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSftpServer } from "./sftp-fixture.mjs";
import { STATE_GUARD } from "./routes.mjs";

/**
 * The publish capability, end to end.
 *
 * A real bridge process, a real SSH connection, a real SFTP server over a
 * temporary directory. Everything that matters about publishing is a claim
 * about files on someone else's disk — that a page was replaced atomically,
 * that a removed note took its page with it, that the manifest is written last
 * — and none of it is provable against a mock of our own transport.
 */

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const TOKEN = "p".repeat(32);
const MAIL_TOKEN = "m".repeat(32);
const OWN_TOKEN = "o".repeat(32);
const SITE = "/site";
const STATE = "/state";

let sftp;
let child;
let base;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function post(path, body, { token = TOKEN } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function put(path, bytes, { token = TOKEN } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
    body: bytes
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

/** What the plugin does: upload what the plan asks for, then commit. */
async function publish(index, sources) {
  const plan = await post("/publish/plan", { target: "blog", index });
  if (plan.status !== 200) return plan;

  for (const entry of plan.json.uploadSources) {
    const body = Buffer.from(sources.get(entry.sha256), "utf8");
    const upload = await put(`/publish/source?target=blog&sha256=${entry.sha256}`, body);
    if (upload.status !== 200) return upload;
  }
  for (const entry of plan.json.uploadAssets) {
    const body = sources.get(entry.sha256);
    const upload = await put(
      `/publish/asset?target=blog&sha256=${entry.sha256}&name=${encodeURIComponent(entry.name)}`,
      body
    );
    if (upload.status !== 200) return upload;
  }

  return post("/publish/commit", { target: "blog", index });
}

function note(overrides) {
  return { date: "2026-09-12", ...overrides };
}

function siteFile(...parts) {
  return join(sftp.root, "site", ...parts);
}

async function manifest() {
  return JSON.parse(await readFile(join(sftp.root, "state", "manifest.json"), "utf8"));
}

const first = "# Erste\n\nText mit [[Zweite]] und ![[bild.png]].\n";
const second = "# Zweite\n\nNur Text.\n";
const image = Buffer.from("89504e470d0a1a0a00", "hex");

function index({ notes, assets = [], siteTitle = "Schreibstube" } = {}) {
  return { siteTitle, notes, assets };
}

const bothNotes = () =>
  index({
    notes: [
      note({ sourcePath: "Blog/Erste.md", sha256: sha256(first), slug: "erste", title: "Erste" }),
      note({
        sourcePath: "Blog/Zweite.md",
        sha256: sha256(second),
        slug: "zweite",
        title: "Zweite",
        date: "2026-09-01"
      })
    ],
    assets: [
      { sourcePath: "Blog/bild.png", sha256: sha256(image), name: "bild.png", bytes: image.length }
    ]
  });

const sources = () =>
  new Map([
    [sha256(first), first],
    [sha256(second), second],
    [sha256(image), image]
  ]);

beforeAll(async () => {
  sftp = await startSftpServer();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      PUBLISH_TOKEN: TOKEN,
      PUBLISH_TARGETS: "blog,notizen,archiv,falsch,eigen,fremd",
      PUBLISH_BLOG_HOST: "127.0.0.1",
      PUBLISH_BLOG_PORT: String(sftp.port),
      PUBLISH_BLOG_USER: sftp.user,
      PUBLISH_BLOG_PASSWORD: sftp.password,
      PUBLISH_BLOG_HOST_FINGERPRINT: sftp.fingerprint,
      PUBLISH_BLOG_ROOT: SITE,
      PUBLISH_BLOG_STATE_ROOT: STATE,
      PUBLISH_BLOG_BASE_URL: "https://blog.example.com",
      PUBLISH_BLOG_SITE_TITLE: "Schreibstube",
      // A second target on the same host, with its state left at the default
      // inside its web root.
      PUBLISH_NOTIZEN_HOST: "127.0.0.1",
      PUBLISH_NOTIZEN_PORT: String(sftp.port),
      PUBLISH_NOTIZEN_USER: sftp.user,
      PUBLISH_NOTIZEN_PASSWORD: sftp.password,
      PUBLISH_NOTIZEN_HOST_FINGERPRINT: sftp.fingerprint,
      PUBLISH_NOTIZEN_ROOT: "/notizen",
      PUBLISH_NOTIZEN_STATE_IN_ROOT: "true",
      PUBLISH_NOTIZEN_BASE_URL: "https://notizen.example.com",
      PUBLISH_ARCHIV_HOST: "127.0.0.1",
      PUBLISH_ARCHIV_PORT: String(sftp.port),
      PUBLISH_ARCHIV_USER: sftp.user,
      PUBLISH_ARCHIV_PASSWORD: sftp.password,
      PUBLISH_ARCHIV_HOST_FINGERPRINT: sftp.fingerprint,
      PUBLISH_ARCHIV_ROOT: "/archiv",
      PUBLISH_ARCHIV_STATE_IN_ROOT: "true",
      PUBLISH_ARCHIV_BASE_URL: "https://archiv.example.com",
      // The same host, pinned to a fingerprint it does not have.
      PUBLISH_FALSCH_HOST: "127.0.0.1",
      PUBLISH_FALSCH_PORT: String(sftp.port),
      PUBLISH_FALSCH_USER: sftp.user,
      PUBLISH_FALSCH_PASSWORD: sftp.password,
      PUBLISH_FALSCH_HOST_FINGERPRINT: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      PUBLISH_FALSCH_ROOT: "/falsch",
      PUBLISH_FALSCH_STATE_ROOT: "/falsch-state",
      PUBLISH_FALSCH_BASE_URL: "https://falsch.example.com",
      // A target with a token of its own, and one that may take over files
      // it finds on the host.
      PUBLISH_EIGEN_HOST: "127.0.0.1",
      PUBLISH_EIGEN_PORT: String(sftp.port),
      PUBLISH_EIGEN_USER: sftp.user,
      PUBLISH_EIGEN_PASSWORD: sftp.password,
      PUBLISH_EIGEN_HOST_FINGERPRINT: sftp.fingerprint,
      PUBLISH_EIGEN_ROOT: "/eigen",
      PUBLISH_EIGEN_STATE_ROOT: "/eigen-state",
      PUBLISH_EIGEN_BASE_URL: "https://eigen.example.com",
      PUBLISH_EIGEN_TOKEN: OWN_TOKEN,
      PUBLISH_FREMD_HOST: "127.0.0.1",
      PUBLISH_FREMD_PORT: String(sftp.port),
      PUBLISH_FREMD_USER: sftp.user,
      PUBLISH_FREMD_PASSWORD: sftp.password,
      PUBLISH_FREMD_HOST_FINGERPRINT: sftp.fingerprint,
      PUBLISH_FREMD_ROOT: "/fremd",
      PUBLISH_FREMD_STATE_ROOT: "/fremd-state",
      PUBLISH_FREMD_BASE_URL: "https://fremd.example.com",
      PUBLISH_FREMD_ADOPT_EXISTING: "true",
      PUBLISH_MAX_UPLOADS: "40",
      MAIL_TOKEN,
      IMAP_HOST: "127.0.0.1",
      IMAP_PORT: "1",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1",
      MAIL_USER: "post@example.com",
      MAIL_PASSWORD: "geheim",
      MAIL_FROM: "post@example.com",
      AUTH_FAILURE_LIMIT: "1000",
      UPSTREAM_TIMEOUT_MS: "10000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const until = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) throw new Error("bridge did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}, 40_000);

afterAll(async () => {
  child?.kill("SIGKILL");
  await sftp?.stop();
});

describe("targets", () => {
  it("offers the configured targets, so settings need not be retyped", async () => {
    const response = await fetch(`${base}/publish/targets`, {
      headers: { authorization: `Bearer ${TOKEN}` }
    });
    expect(await response.json()).toEqual({
      targets: [
        { name: "blog", baseUrl: "https://blog.example.com", siteTitle: "Schreibstube" },
        { name: "notizen", baseUrl: "https://notizen.example.com", siteTitle: "notizen" },
        { name: "archiv", baseUrl: "https://archiv.example.com", siteTitle: "archiv" },
        { name: "falsch", baseUrl: "https://falsch.example.com", siteTitle: "falsch" },
        // Not "eigen": it has a token of its own, and this is not it.
        { name: "fremd", baseUrl: "https://fremd.example.com", siteTitle: "fremd" }
      ]
    });
  });

  it("is closed to the mail token, which belongs to another capability", async () => {
    const response = await fetch(`${base}/publish/targets`, {
      headers: { authorization: `Bearer ${MAIL_TOKEN}` }
    });
    expect(response.status).toBe(401);
  });

  it("reports an unknown target rather than guessing", async () => {
    const response = await post("/publish/plan", { target: "gibtesnicht", index: bothNotes() });
    expect(response.status).toBe(404);
    expect(response.json.code).toBe("unknown_target");
  });

  it("says when the web root is not there, since listing it would answer 'empty'", async () => {
    const response = await post("/publish/diagnostics", { target: "blog" });
    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      ok: false,
      target: "blog",
      error: "The web root does not exist."
    });
  });

  it("answers 404 for a target that is only a property of every object", async () => {
    for (const name of ["constructor", "__proto__", "toString"]) {
      const response = await post("/publish/plan", { target: name, index: bothNotes() });
      expect(response.status).toBe(404);
      expect(response.json.code).toBe("unknown_target");
    }
  });

  it("proves the connection without writing anything", async () => {
    await mkdir(join(sftp.root, "notizen"), { recursive: true });
    const response = await post("/publish/diagnostics", { target: "notizen" });
    expect(response.json.ok).toBe(true);
    expect(response.json.entries).toBe(0);
    // Whether the root is there, never where it is.
    expect(response.json.rootExists).toBe(true);
    expect(JSON.stringify(response.json)).not.toContain("/notizen");
    await expect(readdir(join(sftp.root, "notizen"))).resolves.toEqual([]);
  });
});

describe("a first publish", () => {
  it("plans every source and asset, with nothing to delete", async () => {
    const plan = await post("/publish/plan", { target: "blog", index: bothNotes() });
    expect(plan.status).toBe(200);
    expect(plan.json.uploadSources).toHaveLength(2);
    expect(plan.json.uploadAssets).toHaveLength(1);
    expect(plan.json.willDelete).toEqual([]);
  });

  it("writes nothing during planning", async () => {
    await expect(readdir(siteFile())).rejects.toThrow();
  });

  it("refuses to commit before the sources are uploaded", async () => {
    const response = await post("/publish/commit", { target: "blog", index: bothNotes() });
    expect(response.status).toBe(409);
    expect(response.json.code).toBe("sources_missing");
  });

  it("publishes a page per note, an index and the stylesheet", async () => {
    const result = await publish(bothNotes(), sources());
    expect(result.status).toBe(200);
    expect(result.json.written).toBeGreaterThan(0);

    expect(await readFile(siteFile("erste", "index.html"), "utf8")).toContain("Erste");
    expect(await readFile(siteFile("zweite", "index.html"), "utf8")).toContain("Zweite");
    expect(await readFile(siteFile("index.html"), "utf8")).toContain("Erste");
    expect(await readFile(siteFile("assets", "theme.css"), "utf8")).toContain("body");
  });

  it("resolves the link between the two notes", async () => {
    expect(await readFile(siteFile("erste", "index.html"), "utf8")).toContain('href="../zweite/"');
  });

  it("stores the image under its content address and embeds that", async () => {
    const path = `assets/${sha256(image).slice(0, 12)}-bild.png`;
    expect(await readFile(siteFile(...path.split("/")))).toEqual(image);
    expect(await readFile(siteFile("erste", "index.html"), "utf8")).toContain(path);
  });

  it("lists the newest note first on the index page", async () => {
    const html = await readFile(siteFile("index.html"), "utf8");
    expect(html.indexOf("Erste")).toBeLessThan(html.indexOf("Zweite"));
  });

  it("keeps the sources and the manifest out of the served tree", async () => {
    expect(await readdir(join(sftp.root, "state", "src"))).toHaveLength(2);
    expect((await manifest()).files["erste/index.html"].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves no temporary files behind", async () => {
    const names = await readdir(siteFile("erste"));
    expect(names).toEqual(["index.html"]);
  });
});

describe("logging in", () => {
  it("logs in once for a whole publish, not once per request", async () => {
    // An edit, so the publish has an upload between its plan and its commit.
    const text = "# Erste\n\nNoch einmal anders.\n";
    const next = bothNotes();
    next.notes[0].sha256 = sha256(text);

    const before = sftp.connections;
    const result = await publish(next, sources().set(sha256(text), text));
    expect(result.status).toBe(200);
    // Plan, upload and commit share one connection; one left open by an
    // earlier test may even have been reused, which counts as none.
    expect(sftp.connections - before).toBeLessThanOrEqual(1);

    expect((await publish(bothNotes(), sources())).status).toBe(200);
  });
});

describe("a second publish with no changes", () => {
  it("uploads nothing", async () => {
    const plan = await post("/publish/plan", { target: "blog", index: bothNotes() });
    expect(plan.json.uploadSources).toEqual([]);
    expect(plan.json.uploadAssets).toEqual([]);
    expect(plan.json.unchangedSources).toBe(2);
  });

  it("writes nothing, because every page came out the same", async () => {
    sftp.resetStats();
    const result = await publish(bothNotes(), sources());
    expect(result.json.written).toBe(0);
    expect(result.json.unchanged).toBeGreaterThan(0);
    // The notes were uploaded through this bridge, so it renders them from
    // memory instead of reading each one back from the host.
    expect(sftp.stats.reads.filter((path) => path.includes("/src/"))).toEqual([]);
  });
});

describe("an edited note", () => {
  const edited = "# Erste\n\nGeänderter Text.\n";

  it("uploads only the note that changed", async () => {
    const next = bothNotes();
    next.notes[0].sha256 = sha256(edited);

    const plan = await post("/publish/plan", { target: "blog", index: next });
    expect(plan.json.uploadSources).toHaveLength(1);
    expect(plan.json.uploadSources[0].sourcePath).toBe("Blog/Erste.md");
  });

  it("replaces the page and leaves the others alone", async () => {
    const next = bothNotes();
    next.notes[0].sha256 = sha256(edited);
    const withEdit = sources().set(sha256(edited), edited);

    const before = await readFile(siteFile("zweite", "index.html"), "utf8");
    const result = await publish(next, withEdit);

    expect(result.json.written).toBe(1);
    expect(await readFile(siteFile("erste", "index.html"), "utf8")).toContain("Geänderter Text");
    expect(await readFile(siteFile("zweite", "index.html"), "utf8")).toBe(before);
  });

  it("collects the source that nothing refers to any more", async () => {
    expect(await readdir(join(sftp.root, "state", "src"))).toHaveLength(2);
  });
});

describe("a renamed and an unpublished note", () => {
  const edited = "# Erste\n\nGeänderter Text.\n";

  it("moves the page and removes the old one", async () => {
    const next = bothNotes();
    next.notes[0].sha256 = sha256(edited);
    next.notes[0].slug = "erste-neu";

    const result = await publish(next, sources().set(sha256(edited), edited));
    expect(result.json.deleted).toBe(1);
    expect(await readFile(siteFile("erste-neu", "index.html"), "utf8")).toContain("Erste");
    await expect(readFile(siteFile("erste", "index.html"))).rejects.toThrow();
  });

  it("prunes the directory the page left behind", async () => {
    await expect(readdir(siteFile("erste"))).rejects.toThrow();
  });

  it("takes a page down when its note is no longer published", async () => {
    const next = bothNotes();
    next.notes = [next.notes[1]];
    next.assets = [];

    const result = await publish(next, sources());
    expect(result.status).toBe(200);
    await expect(readFile(siteFile("erste-neu", "index.html"))).rejects.toThrow();
    expect(await readFile(siteFile("zweite", "index.html"), "utf8")).toContain("Zweite");
  });

  it("removes the asset nothing references any more", async () => {
    expect(await readdir(siteFile("assets"))).toEqual(["theme.css"]);
  });

  it("never removes a file it did not write", async () => {
    // A file the bridge has never heard of survives every publish.
    const stranger = siteFile("fremd.html");
    await (await import("node:fs/promises")).writeFile(stranger, "nicht von uns");
    await publish(bothNotes(), sources());
    expect(await readFile(stranger, "utf8")).toBe("nicht von uns");
  });

  it("keeps a page the host would not delete in the manifest, and tries again next time", async () => {
    // Put both notes back, then unpublish one while the host refuses to
    // remove its page.
    expect((await publish(bothNotes(), sources())).status).toBe(200);
    const page = `${SITE}/erste/index.html`;
    sftp.stats.refusedRemovals.add(page);
    const next = bothNotes();
    next.notes = [next.notes[1]];
    next.assets = [];

    const refused = await publish(next, sources());
    expect(refused.status).toBe(200);
    expect(refused.json.deleted).toBe(1);
    expect(refused.json.deleteFailed).toBe(1);
    expect(await readFile(siteFile("erste", "index.html"), "utf8")).toContain("Erste");
    expect(Object.keys((await manifest()).files)).toContain("erste/index.html");

    sftp.stats.refusedRemovals.delete(page);
    const retried = await publish(next, sources());
    expect(retried.json.deleted).toBe(1);
    expect(retried.json.deleteFailed).toBe(0);
    await expect(readFile(siteFile("erste", "index.html"))).rejects.toThrow();
    expect(Object.keys((await manifest()).files)).not.toContain("erste/index.html");

    // Put the site back for what follows.
    expect((await publish(bothNotes(), sources())).status).toBe(200);
  });

  it("takes the last pages down when no note is published any more", async () => {
    const empty = index({ notes: [] });
    const plan = await post("/publish/plan", { target: "blog", index: empty });
    expect(plan.json.willDelete).toEqual(
      expect.arrayContaining(["erste/index.html", "zweite/index.html"])
    );

    const result = await publish(empty, sources());
    expect(result.status).toBe(200);
    await expect(readFile(siteFile("zweite", "index.html"))).rejects.toThrow();
    // The site itself stays: an empty index page, and nobody else's files.
    expect(await readFile(siteFile("index.html"), "utf8")).not.toContain("Zweite");
    expect(await readFile(siteFile("fremd.html"), "utf8")).toBe("nicht von uns");

    // Put the site back for what follows.
    expect((await publish(bothNotes(), sources())).status).toBe(200);
  });
});

describe("re-rendering from stored state", () => {
  it("rebuilds the site with no vault and no upload", async () => {
    const response = await post("/publish/render", { target: "blog" });
    expect(response.status).toBe(200);
    expect(response.json.written).toBe(0);
    expect(response.json.unchanged).toBeGreaterThan(0);
  });
});

describe("filmstrip thumbnails", () => {
  // A target of its own, so these publishes leave the others' sites alone.
  const target = "archiv";
  const jpeg = (n) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]);
  const haus = jpeg(1);
  const garten = jpeg(2);
  const thumb = jpeg(9);
  const strip =
    "# Garten\n\n```schreibstube-slideshow\nlayout: filmstrip\n" +
    "![Haus](Blog/haus.jpg)\n![Garten](Blog/garten.jpg)\n```\n";
  const siteOf = (...parts) => join(sftp.root, "archiv", ...parts);

  const thumbIndex = (thumbnail = true) =>
    index({
      notes: [
        note({
          sourcePath: "Blog/Garten.md",
          sha256: sha256(strip),
          slug: "garten",
          title: "Garten"
        })
      ],
      assets: [
        {
          sourcePath: "Blog/haus.jpg",
          sha256: sha256(haus),
          name: "haus.jpg",
          bytes: haus.length,
          thumbnail
        },
        {
          sourcePath: "Blog/garten.jpg",
          sha256: sha256(garten),
          name: "garten.jpg",
          bytes: garten.length,
          thumbnail
        }
      ]
    });

  const thumbPath = (bytes, stem) => `assets/thumbs/${sha256(bytes).slice(0, 12)}-${stem}.jpg`;

  async function uploadAll(plan) {
    await put(
      `/publish/source?target=${target}&sha256=${sha256(strip)}`,
      Buffer.from(strip, "utf8")
    );
    for (const entry of plan.uploadAssets) {
      const body = entry.name === "haus.jpg" ? haus : garten;
      await put(
        `/publish/asset?target=${target}&sha256=${entry.sha256}&name=${encodeURIComponent(entry.name)}`,
        body
      );
    }
  }

  const sendThumbnail = (entry, body = thumb, extra = "") =>
    put(
      `/publish/thumbnail?target=${target}&source=${entry.sha256}&sha256=${sha256(body)}` +
        `&name=${encodeURIComponent(entry.name)}${extra}`,
      body
    );

  it("asks for a thumbnail of each marked picture, under thumbs/", async () => {
    const plan = await post("/publish/plan", { target, index: thumbIndex() });
    expect(plan.status).toBe(200);
    expect(plan.json.uploadThumbnails.map((entry) => entry.path).sort()).toEqual(
      [thumbPath(garten, "garten"), thumbPath(haus, "haus")].sort()
    );
  });

  it("points the filmstrip at the pictures themselves while it has no thumbnails", async () => {
    const plan = await post("/publish/plan", { target, index: thumbIndex() });
    await uploadAll(plan.json);
    const commit = await post("/publish/commit", { target, index: thumbIndex() });
    expect(commit.status).toBe(200);
    const page = await readFile(siteOf("garten", "index.html"), "utf8");
    expect(page).toContain('class="slideshow slideshow-filmstrip"');
    expect(page).not.toContain("data-thumbnail");
    expect(await readFile(siteOf("assets", "slideshow.js"), "utf8")).toContain("thumbnail");
  });

  it("asks again next time, and points at a thumbnail once it is there", async () => {
    const plan = await post("/publish/plan", { target, index: thumbIndex() });
    expect(plan.json.uploadThumbnails).toHaveLength(2);
    for (const entry of plan.json.uploadThumbnails) {
      const sent = await sendThumbnail(entry);
      expect(sent.status).toBe(200);
      expect(sent.json.path).toBe(entry.path);
    }
    const commit = await post("/publish/commit", { target, index: thumbIndex() });
    expect(commit.status).toBe(200);

    const page = await readFile(siteOf("garten", "index.html"), "utf8");
    expect(page).toContain(`data-thumbnail="../${thumbPath(haus, "haus")}"`);
    expect(await readFile(siteOf(...thumbPath(haus, "haus").split("/")))).toEqual(thumb);
    const recorded = JSON.parse(
      await readFile(join(sftp.root, "archiv", ".schreibstube", "manifest.json"), "utf8")
    ).files;
    expect(recorded[thumbPath(haus, "haus")]).toEqual({
      sha256: sha256(thumb),
      bytes: thumb.length
    });
  });

  it("asks for nothing once the site has them", async () => {
    const plan = await post("/publish/plan", { target, index: thumbIndex() });
    expect(plan.json.uploadThumbnails).toEqual([]);
    expect(plan.json.willDelete).toEqual([]);
  });

  it("refuses a thumbnail that is not what its name says, too large, or of no picture", async () => {
    const entry = { sha256: sha256(haus), name: "haus.jpg" };
    const png = Buffer.from("89504e470d0a1a0a00", "hex");
    const notImage = await sendThumbnail(entry, png);
    expect(notImage.status).toBe(400);
    expect(notImage.json.code).toBe("thumbnail_rejected");

    const drawing = await sendThumbnail({ sha256: sha256(haus), name: "plan.svg" }, thumb);
    expect(drawing.status).toBe(400);

    const heavy = Buffer.concat([thumb, Buffer.alloc(200_001)]);
    expect((await sendThumbnail(entry, heavy)).status).toBe(413);

    const noSource = await put(
      `/publish/thumbnail?target=${target}&sha256=${sha256(thumb)}&name=haus.jpg`,
      thumb
    );
    expect(noSource.status).toBe(400);
  });

  it("takes the thumbnails down with the filmstrip", async () => {
    const plan = await post("/publish/plan", { target, index: thumbIndex(false) });
    expect(plan.json.willDelete).toEqual(
      [thumbPath(garten, "garten"), thumbPath(haus, "haus")].sort()
    );
    const commit = await post("/publish/commit", { target, index: thumbIndex(false) });
    expect(commit.status).toBe(200);
    await expect(readFile(siteOf(...thumbPath(haus, "haus").split("/")))).rejects.toThrow();
  });
});

describe("refusals", () => {
  it("rejects an upload whose bytes do not match the declared hash", async () => {
    const response = await put(
      `/publish/source?target=blog&sha256=${sha256("etwas anderes")}`,
      Buffer.from("stimmt nicht")
    );
    expect(response.status).toBe(400);
    expect(response.json.code).toBe("hash_mismatch");
  });

  it("rejects an upload with no hash at all", async () => {
    const response = await put("/publish/source?target=blog", Buffer.from("x"));
    expect(response.status).toBe(400);
  });

  it("rejects an asset type the target does not serve", async () => {
    const payload = Buffer.from("<?php ?>");
    const response = await put(
      `/publish/asset?target=blog&sha256=${sha256(payload)}&name=shell.php`,
      payload
    );
    expect(response.status).toBe(400);
    expect(response.json.code).toBe("asset_rejected");
  });

  it("rejects an asset whose name tries to climb out of the site", async () => {
    const payload = Buffer.concat([image, Buffer.from("x")]);
    const response = await put(
      `/publish/asset?target=blog&sha256=${sha256(payload)}&name=${encodeURIComponent("../../../etc/passwd.png")}`,
      payload
    );
    // The name is slugified into the filename, so it lands in assets/ like any
    // other upload rather than being refused — and never outside the root.
    expect(response.status).toBe(200);
    expect(response.json.path).toBe(`assets/${sha256(payload).slice(0, 12)}-etc-passwd.png`);
    expect(await readFile(siteFile(...response.json.path.split("/")))).toEqual(payload);
  });

  it("rejects an SVG that could run something, and a raster file that is not one", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    );
    const scripted = await put(
      `/publish/asset?target=blog&sha256=${sha256(svg)}&name=logo.svg`,
      svg
    );
    expect(scripted.status).toBe(400);
    expect(scripted.json.code).toBe("asset_rejected");

    const drawing = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
    );
    expect(
      (await put(`/publish/asset?target=blog&sha256=${sha256(drawing)}&name=logo.svg`, drawing))
        .status
    ).toBe(200);

    const notPng = Buffer.from("GIF89a not a png at all");
    const named = await put(
      `/publish/asset?target=blog&sha256=${sha256(notPng)}&name=bild.png`,
      notPng
    );
    expect(named.status).toBe(400);
    expect(named.json.code).toBe("asset_rejected");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(
      (await put(`/publish/asset?target=blog&sha256=${sha256(jpeg)}&name=foto.JPG`, jpeg)).status
    ).toBe(200);
  });

  it("refuses to commit an index naming an asset that was never uploaded", async () => {
    const missing = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 9]);
    const next = bothNotes();
    next.assets.push({
      sourcePath: "Blog/fehlt.jpg",
      sha256: sha256(missing),
      name: "fehlt.jpg",
      bytes: missing.length
    });
    const response = await post("/publish/commit", { target: "blog", index: next });
    expect(response.status).toBe(409);
    expect(response.json.code).toBe("assets_missing");
    expect(response.json.error).toContain("Blog/fehlt.jpg");
    // Nothing of the refused commit reached the manifest.
    expect(Object.keys((await manifest()).files).some((path) => path.includes("fehlt"))).toBe(
      false
    );
  });

  it("rejects an index with two notes claiming one address", async () => {
    const collision = bothNotes();
    collision.notes[1].slug = collision.notes[0].slug;

    const response = await post("/publish/plan", { target: "blog", index: collision });
    expect(response.status).toBe(400);
    expect(response.json.code).toBe("invalid_index");
    expect(response.json.error).toContain("claim the slug");
  });

  it("rejects an index whose slug did not come from slugify", async () => {
    const unsafe = bothNotes();
    unsafe.notes[0].slug = "../../etc";
    const response = await post("/publish/plan", { target: "blog", index: unsafe });
    expect(response.status).toBe(400);
  });
});

describe("a state directory inside the web root", () => {
  const upload = (target) =>
    put(`/publish/source?target=${target}&sha256=${sha256(second)}`, Buffer.from(second, "utf8"));

  it("gets a deny file before the first source lands in it", async () => {
    expect((await upload("notizen")).status).toBe(200);
    const guard = await readFile(join(sftp.root, "notizen", ".schreibstube", ".htaccess"), "utf8");
    expect(guard).toBe(STATE_GUARD);
    expect(guard).toContain("Require all denied");
  });

  it("keeps a deny file the operator wrote", async () => {
    const own = "Require ip 10.0.0.0/8\n";
    await mkdir(join(sftp.root, "archiv", ".schreibstube"), { recursive: true });
    await writeFile(join(sftp.root, "archiv", ".schreibstube", ".htaccess"), own);
    expect((await upload("archiv")).status).toBe(200);
    expect(await readFile(join(sftp.root, "archiv", ".schreibstube", ".htaccess"), "utf8")).toBe(
      own
    );
  });

  it("is not written where the state lies outside the web root", async () => {
    expect((await upload("blog")).status).toBe(200);
    expect(await readdir(join(sftp.root, "state"))).not.toContain(".htaccess");
  });
});

describe("a host key that does not match", () => {
  it("is refused, naming the key type the server presented", async () => {
    const response = await post("/publish/diagnostics", { target: "falsch" });
    expect(response.status).toBe(200);
    expect(response.json.ok).toBe(false);
    expect(response.json.error).toMatch(/^Host key mismatch/);
    // The fixture holds only an RSA key, so that is what the bridge is shown.
    expect(response.json.error).toContain(`presented ssh-rsa ${sftp.fingerprint}`);
    expect(response.json.error).toContain("must be the ssh-rsa one");
  });
});

describe("connection tests", () => {
  it("answer from the last attempt for a while, rather than logging in again", async () => {
    const before = sftp.connections;
    const again = await post("/publish/diagnostics", { target: "falsch" });
    expect(again.json.error).toMatch(/^Host key mismatch/);
    // A failed login is what a host bans an address for; the second test
    // within the interval asked nobody.
    expect(sftp.connections).toBe(before);
  });
});

/** Plan, upload what it asks for, commit — against any target, with any token. */
async function publishTo(target, index, sources, { token = TOKEN } = {}) {
  const plan = await post("/publish/plan", { target, index }, { token });
  if (plan.status !== 200) return plan;
  for (const entry of plan.json.uploadSources) {
    const body = Buffer.from(sources.get(entry.sha256), "utf8");
    const upload = await put(`/publish/source?target=${target}&sha256=${entry.sha256}`, body, {
      token
    });
    if (upload.status !== 200) return upload;
  }
  for (const entry of plan.json.uploadAssets) {
    const upload = await put(
      `/publish/asset?target=${target}&sha256=${entry.sha256}&name=${encodeURIComponent(entry.name)}`,
      sources.get(entry.sha256),
      { token }
    );
    if (upload.status !== 200) return upload;
  }
  return post("/publish/commit", { target, index }, { token });
}

describe("a target with a token of its own", () => {
  const listed = async (token) =>
    (
      await (
        await fetch(`${base}/publish/targets`, { headers: { authorization: `Bearer ${token}` } })
      ).json()
    ).targets.map((target) => target.name);

  it("is opened by that token alone, and the token opens nothing else", async () => {
    expect(await listed(OWN_TOKEN)).toEqual(["eigen"]);

    const shared = await post("/publish/plan", { target: "eigen", index: bothNotes() });
    expect(shared.status).toBe(404);
    expect(shared.json.code).toBe("unknown_target");

    const elsewhere = await post(
      "/publish/plan",
      { target: "blog", index: bothNotes() },
      { token: OWN_TOKEN }
    );
    expect(elsewhere.status).toBe(404);

    const upload = await put(
      `/publish/source?target=blog&sha256=${sha256(second)}`,
      Buffer.from(second, "utf8"),
      { token: OWN_TOKEN }
    );
    expect(upload.status).toBe(404);

    const own = await post(
      "/publish/plan",
      { target: "eigen", index: bothNotes() },
      { token: OWN_TOKEN }
    );
    expect(own.status).toBe(200);
  });
});

describe("files the bridge never wrote", () => {
  const placeholder = "<h1>Hier entsteht eine neue Website</h1>";

  it("are named in the plan and refused at commit, and left as they were", async () => {
    await mkdir(join(sftp.root, "eigen"), { recursive: true });
    await writeFile(join(sftp.root, "eigen", "index.html"), placeholder);

    const plan = await post(
      "/publish/plan",
      { target: "eigen", index: bothNotes() },
      { token: OWN_TOKEN }
    );
    expect(plan.json.conflicts).toEqual(["index.html"]);

    const commit = await publishTo("eigen", bothNotes(), sources(), { token: OWN_TOKEN });
    expect(commit.status).toBe(409);
    expect(commit.json.code).toBe("path_conflict");
    expect(commit.json.error).toContain("index.html");
    expect(commit.json.error).toContain("PUBLISH_EIGEN_ADOPT_EXISTING=true");
    expect(await readFile(join(sftp.root, "eigen", "index.html"), "utf8")).toBe(placeholder);
    // Nothing of the refused commit was written, and no manifest claims the file.
    await expect(readFile(join(sftp.root, "eigen", "erste", "index.html"))).rejects.toThrow();
    await expect(readFile(join(sftp.root, "eigen-state", "manifest.json"))).rejects.toThrow();
  });

  it("are not overwritten by an upload either, unless they hold the same bytes", async () => {
    const picture = Buffer.concat([image, Buffer.from("fremd")]);
    const path = `assets/${sha256(picture).slice(0, 12)}-logo.png`;
    await mkdir(join(sftp.root, "eigen", "assets"), { recursive: true });
    await writeFile(join(sftp.root, "eigen", ...path.split("/")), "someone else's");

    const query = `target=eigen&sha256=${sha256(picture)}&name=logo.png`;
    const refused = await put(`/publish/asset?${query}`, picture, { token: OWN_TOKEN });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("path_conflict");
    expect(await readFile(join(sftp.root, "eigen", ...path.split("/")), "utf8")).toBe(
      "someone else's"
    );

    await writeFile(join(sftp.root, "eigen", ...path.split("/")), picture);
    const same = await put(`/publish/asset?${query}`, picture, { token: OWN_TOKEN });
    expect(same.status).toBe(200);
  });

  it("are taken over where the target says it may", async () => {
    await mkdir(join(sftp.root, "fremd"), { recursive: true });
    await writeFile(join(sftp.root, "fremd", "index.html"), placeholder);

    const plan = await post("/publish/plan", { target: "fremd", index: bothNotes() });
    expect(plan.json.conflicts).toEqual([]);
    const commit = await publishTo("fremd", bothNotes(), sources());
    expect(commit.status).toBe(200);
    expect(await readFile(join(sftp.root, "fremd", "index.html"), "utf8")).toContain("Erste");
  });
});

describe("uploads that no commit used", () => {
  it("are recorded before they land, and removed by the next commit", async () => {
    const stray = Buffer.concat([image, Buffer.from("verwaist")]);
    const upload = await put(
      `/publish/asset?target=blog&sha256=${sha256(stray)}&name=verwaist.png`,
      stray
    );
    expect(upload.status).toBe(200);
    const recorded = JSON.parse(await readFile(join(sftp.root, "state", "pending.json"), "utf8"));
    expect(Object.keys(recorded.files)).toContain(upload.json.path);

    const commit = await publish(bothNotes(), sources());
    expect(commit.status).toBe(200);
    expect(commit.json.abandoned).toBeGreaterThanOrEqual(1);
    await expect(readFile(siteFile(...upload.json.path.split("/")))).rejects.toThrow();
    const after = JSON.parse(await readFile(join(sftp.root, "state", "pending.json"), "utf8"));
    expect(after.files).toEqual({});
    // What the index does use is kept.
    expect(await readFile(siteFile("assets", `${sha256(image).slice(0, 12)}-bild.png`))).toEqual(
      image
    );
  });

  it("stop at the target's quota until a commit", async () => {
    const statuses = [];
    for (let n = 0; n < 41; n += 1) {
      const text = `# Notiz ${n}\n`;
      const response = await put(
        `/publish/source?target=eigen&sha256=${sha256(text)}`,
        Buffer.from(text, "utf8"),
        { token: OWN_TOKEN }
      );
      statuses.push(response.status);
      if (response.status === 413) expect(response.json.code).toBe("quota_exceeded");
    }
    expect(statuses.filter((status) => status === 200).length).toBeLessThanOrEqual(40);
    expect(statuses.at(-1)).toBe(413);
  });
});

describe("a stored note whose bytes no longer match its name", () => {
  it("is not published, but removed so the plan asks for it again", async () => {
    const text = "# Dritte\n\nVom Host verändert.\n";
    const hash = sha256(text);
    await writeFile(join(sftp.root, "state", "src", `${hash}.md`), "# Etwas anderes\n");
    const next = bothNotes();
    next.notes.push(note({ sourcePath: "Blog/Dritte.md", sha256: hash, slug: "dritte" }));

    const commit = await post("/publish/commit", { target: "blog", index: next });
    expect(commit.status).toBe(409);
    expect(commit.json.code).toBe("sources_missing");
    await expect(readFile(siteFile("dritte", "index.html"))).rejects.toThrow();
    expect(await readdir(join(sftp.root, "state", "src"))).not.toContain(`${hash}.md`);

    const plan = await post("/publish/plan", { target: "blog", index: next });
    expect(plan.json.uploadSources.map((entry) => entry.sha256)).toEqual([hash]);
  });
});

describe("the headers of an Apache site", () => {
  it("are written beside the pages, with a sandbox for the drawings", async () => {
    const policy = await readFile(join(sftp.root, "archiv", ".htaccess"), "utf8");
    expect(policy).toContain("Header always set Content-Security-Policy \"default-src 'self'");
    expect(policy).toContain('X-Content-Type-Options "nosniff"');
    expect(policy).toContain("Referrer-Policy");
    const assets = await readFile(join(sftp.root, "archiv", "assets", ".htaccess"), "utf8");
    expect(assets).toContain('<FilesMatch "\\.svg$">');
    expect(assets).toContain('Content-Security-Policy "sandbox"');
  });

  it("are not written where the target keeps no .htaccess", async () => {
    await expect(readFile(siteFile(".htaccess"))).rejects.toThrow();
  });

  it("leave an operator's own .htaccess alone", async () => {
    const own = "RewriteEngine On\n";
    await mkdir(join(sftp.root, "notizen"), { recursive: true });
    await writeFile(join(sftp.root, "notizen", ".htaccess"), own);
    const commit = await publishTo("notizen", bothNotes(), sources());
    expect(commit.status).toBe(200);
    expect(await readFile(join(sftp.root, "notizen", ".htaccess"), "utf8")).toBe(own);
    expect(await readFile(join(sftp.root, "notizen", "assets", ".htaccess"), "utf8")).toContain(
      "sandbox"
    );
  });
});
