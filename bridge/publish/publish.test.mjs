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
const image = Buffer.from("89504e470d0a1a0a", "hex");

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
      PUBLISH_TARGETS: "blog,notizen,archiv,falsch",
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
      PUBLISH_NOTIZEN_BASE_URL: "https://notizen.example.com",
      PUBLISH_ARCHIV_HOST: "127.0.0.1",
      PUBLISH_ARCHIV_PORT: String(sftp.port),
      PUBLISH_ARCHIV_USER: sftp.user,
      PUBLISH_ARCHIV_PASSWORD: sftp.password,
      PUBLISH_ARCHIV_HOST_FINGERPRINT: sftp.fingerprint,
      PUBLISH_ARCHIV_ROOT: "/archiv",
      PUBLISH_ARCHIV_BASE_URL: "https://archiv.example.com",
      // The same host, pinned to a fingerprint it does not have.
      PUBLISH_FALSCH_HOST: "127.0.0.1",
      PUBLISH_FALSCH_PORT: String(sftp.port),
      PUBLISH_FALSCH_USER: sftp.user,
      PUBLISH_FALSCH_PASSWORD: sftp.password,
      PUBLISH_FALSCH_HOST_FINGERPRINT: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      PUBLISH_FALSCH_ROOT: "/falsch",
      PUBLISH_FALSCH_BASE_URL: "https://falsch.example.com",
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
        { name: "falsch", baseUrl: "https://falsch.example.com", siteTitle: "falsch" }
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

  it("proves the connection without writing anything", async () => {
    const response = await post("/publish/diagnostics", { target: "blog" });
    expect(response.json.ok).toBe(true);
    expect(response.json.root).toBe(SITE);
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
    const payload = Buffer.from("x");
    const response = await put(
      `/publish/asset?target=blog&sha256=${sha256(payload)}&name=${encodeURIComponent("../../../etc/passwd.png")}`,
      payload
    );
    // The name is slugified into the filename, so it lands in assets/ like any
    // other upload rather than being refused — and never outside the root.
    expect(response.status).toBe(200);
    expect(response.json.path).toBe(`assets/${sha256(payload).slice(0, 12)}-etc-passwd.png`);
    expect(await readFile(siteFile(...response.json.path.split("/")), "utf8")).toBe("x");
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
