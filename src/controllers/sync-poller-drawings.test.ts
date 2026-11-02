import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, type App } from "obsidian";
import { FileView, TFile, TFolder } from "../testing/obsidian-stub";
import { fakeVault } from "../testing/fake-app";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { createLogger } from "../services/logger";
import { setLanguage } from "../i18n";
import { hashText } from "../services/sync-document";
import { DRAWING_HASH_KEY, decodeBase64 } from "../services/drawing-mirror";
import type { SyncRecord } from "../services/sync-document";
import type { FetchOptions, FetchOutcome } from "../platform/sync-fetcher";
import type { SyncStore } from "./proofread-controller";
import { SyncPoller } from "./sync-poller";

const fetchSource = vi.hoisted(() => vi.fn<(options: FetchOptions) => Promise<FetchOutcome>>());
vi.mock("../platform/sync-fetcher", () => ({ fetchSource }));

setLanguage("en");

const NOTE = "Projekte/Atlas.excalidraw.md";
const SOURCE = "https://raw.githubusercontent.com/o/r/main/Atlas.excalidraw";
const PIXEL = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
const OTHER = "AAEC";

function board(files: Record<string, string>): string {
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [
      { id: "t1", type: "text", text: "Panel · Heute" },
      ...Object.keys(files).map((id) => ({ id: `i-${id}`, type: "image", fileId: id }))
    ],
    appState: {},
    files: Object.fromEntries(
      Object.entries(files).map(([id, data]) => [
        id,
        { mimeType: "image/webp", dataURL: `data:image/webp;base64,${data}` }
      ])
    )
  });
}

/** Records kept by the poller; a drawing must leave none. */
function memoryStore(): SyncStore & { records: () => Record<string, SyncRecord> } {
  let records: Record<string, SyncRecord> = {};
  return {
    records: () => records,
    get: (path) => records[path],
    set: async (path, record) => void (records = { ...records, [path]: record }),
    setMany: async (more) => void (records = { ...records, ...more }),
    forget: async () => {},
    all: () => records,
    update: async (transform) => {
      const next = transform(records);
      if (next !== null) records = next;
    }
  };
}

const BOUND = `---\nschreibstubeSyncedFrom: ${SOURCE}\n---\n`;

/** A note the mirror wrote before, listing the pictures it put where. */
function mirrored(pictures: Record<string, string>): string {
  const listed = Object.entries(pictures).map(([id, path]) => `${id}: [[${path}]]\n`);
  return [
    `---\nschreibstubeSyncedFrom: ${SOURCE}\nschreibstubeSourceHash: "0a1b2c3d"\n---\n`,
    "## Embedded Files\n",
    ...listed,
    "%%\n## Drawing\n%%\n"
  ].join("\n");
}

/** The fake vault, with the folders, pictures and trash a drawing reaches for. */
function vault({
  content = BOUND,
  files = {},
  binding = SOURCE
}: {
  content?: string;
  /** Files already in the vault, by path, as base64. */
  files?: Record<string, string>;
  binding?: string;
} = {}) {
  const hash = /schreibstubeSourceHash: "([0-9a-f]+)"/.exec(content)?.[1];
  const fake = fakeVault({
    notes: [
      {
        path: NOTE,
        content,
        frontmatter: {
          schreibstubeSyncedFrom: binding,
          ...(hash ? { [DRAWING_HASH_KEY]: hash } : {})
        }
      }
    ]
  });
  const folders = new Map<string, TFolder>();
  const pictures = new Map<string, { file: TFile; bytes: Uint8Array }>();
  const trashed: string[] = [];
  const writes: string[] = [];

  const folderOf = (path: string): TFolder => {
    const at = path.slice(0, path.lastIndexOf("/"));
    let folder = folders.get(at);
    if (!folder) {
      folder = new TFolder(at);
      folders.set(at, folder);
    }
    return folder;
  };
  const put = (path: string, bytes: Uint8Array): TFile => {
    const file = pictures.get(path)?.file ?? new TFile(path);
    file.stat.size = bytes.byteLength;
    if (!pictures.has(path)) {
      const folder = folderOf(path);
      file.parent = folder;
      folder.children.push(file);
    }
    pictures.set(path, { file, bytes });
    return file;
  };
  for (const [path, data] of Object.entries(files)) put(path, decodeBase64(data));

  const base = fake.app.vault;
  const vault = {
    ...base,
    getAbstractFileByPath: (path: string) =>
      folders.get(path) ?? pictures.get(path)?.file ?? base.getAbstractFileByPath(path),
    createFolder: async (path: string) => void folders.set(path, new TFolder(path)),
    createBinary: async (path: string, data: ArrayBuffer) => {
      put(path, new Uint8Array(data));
      writes.push(path);
    },
    modifyBinary: async (file: TFile, data: ArrayBuffer) => {
      put(file.path, new Uint8Array(data));
      writes.push(file.path);
    },
    readBinary: async (file: TFile) => pictures.get(file.path)?.bytes.slice().buffer,
    process: async (file: TFile, apply: (text: string) => string) => {
      writes.push(file.path);
      return base.process(file, apply);
    }
  };
  const metadataCache = {
    ...fake.app.metadataCache,
    getFirstLinkpathDest: (link: string, from: string) =>
      pictures.get(link)?.file ?? fake.app.metadataCache.getFirstLinkpathDest(link, from)
  };
  const fileManager = {
    ...fake.app.fileManager,
    trashFile: async (file: TFile | TFolder) => {
      trashed.push(file.path);
      if (file instanceof TFolder) {
        folders.delete(file.path);
        return;
      }
      pictures.delete(file.path);
      if (file.parent) file.parent.children = file.parent.children.filter((c) => c !== file);
    }
  };
  // A tab showing the drawing, as the Excalidraw plugin opens one.
  const view = Object.assign(new FileView(), { file: fake.file(NOTE) });
  const leaf = {
    view,
    setViewState: async (state: { type: string }) => void writes.push(`view:${state.type}`),
    openFile: async (file: TFile) => void writes.push(`open:${file.path}`)
  };
  const open: (typeof leaf)[] = [];
  const workspace = {
    getLeavesOfType: (type: string) => (type === "excalidraw" ? open : [])
  };
  const app = { ...fake.app, vault, metadataCache, fileManager, workspace } as unknown as App;
  return { fake, app, pictures, trashed, writes, openTab: () => open.push(leaf) };
}

function poller(app: App, store = memoryStore()) {
  const settings = { ...DEFAULT_SETTINGS, syncEnabled: true };
  return new SyncPoller(
    app,
    () => settings,
    store,
    async () => {},
    createLogger(() => false)
  );
}

/** What the metadata cache would say once Obsidian has read the note again. */
function cacheCatchesUp(env: ReturnType<typeof vault>): void {
  const text = env.fake.contentOf(NOTE);
  const frontmatter = env.fake.frontmatterOf(NOTE);
  const hash = /schreibstubeSourceHash: "([0-9a-f]+)"/.exec(text)?.[1];
  const etag = /schreibstubeSourceEtag: (".*")/.exec(text)?.[1];
  if (hash !== undefined) frontmatter[DRAWING_HASH_KEY] = hash;
  if (etag !== undefined) frontmatter.schreibstubeSourceEtag = JSON.parse(etag) as string;
}

describe("SyncPoller and drawings", () => {
  beforeEach(() => {
    fetchSource.mockReset();
  });
  afterEach(() => {
    delete (Platform as { isMobile?: boolean }).isMobile;
  });

  it("writes a changed board whole, its pictures beside it, and keeps no record", async () => {
    const env = vault();
    const store = memoryStore();
    fetchSource.mockResolvedValue({ status: "updated", body: board({ abc: PIXEL }), etag: '"v1"' });

    const summary = await poller(env.app, store).pollAllSources("manual");

    expect(summary).toMatchObject({ checked: 1, updated: 1, withChanges: 0, failed: 0 });
    expect(fetchSource.mock.calls[0]?.[0]).toMatchObject({ kind: "drawing", url: SOURCE });
    expect([...env.pictures.keys()]).toEqual(["Projekte/Atlas/abc.webp"]);

    const note = env.fake.contentOf(NOTE);
    expect(note).toContain(`schreibstubeSourceHash: "${hashText(board({ abc: PIXEL }))}"`);
    expect(note).toContain("abc: [[Projekte/Atlas/abc.webp]]");
    expect(note).toContain("Panel · Heute ^t1");
    expect(note).not.toContain(PIXEL);
    expect(store.records()).toEqual({});
  });

  it("sends the validator it wrote, and writes nothing for the same board on a poll", async () => {
    const env = vault();
    const body = board({ abc: PIXEL });
    fetchSource.mockResolvedValue({ status: "updated", body, etag: '"v1"' });
    await poller(env.app).checkFile(env.fake.file(NOTE) as never);
    cacheCatchesUp(env);
    env.writes.length = 0;

    fetchSource.mockResolvedValue({ status: "unchanged", etag: '"v1"' });
    const unchanged = await poller(env.app).pollAllSources("manual");
    expect(fetchSource.mock.calls[1]?.[0].etag).toBe('"v1"');
    expect(unchanged).toMatchObject({ checked: 1, failed: 0 });
    expect(unchanged.updated).toBeUndefined();

    fetchSource.mockResolvedValue({ status: "updated", body, etag: '"v1"' });
    await poller(env.app).pollAllSources("manual");
    expect(env.writes).toEqual([]);
  });

  it("fetches the board whole when asked by hand, and writes it again keeping its date", async () => {
    const env = vault();
    const body = board({ abc: PIXEL });
    fetchSource.mockResolvedValue({ status: "updated", body, etag: '"v1"' });
    await poller(env.app).checkFile(env.fake.file(NOTE) as never);
    cacheCatchesUp(env);
    const dated = /updatedAt: .*/.exec(env.fake.contentOf(NOTE))?.[0];
    // Damaged here, while the source stayed as it was.
    await env.app.vault.process(env.fake.file(NOTE) as never, (text) =>
      text.replace(/## Drawing[\s\S]*/, "")
    );

    const asked = await poller(env.app).checkFile(env.fake.file(NOTE) as never);

    expect(fetchSource.mock.calls[1]?.[0].etag).toBeUndefined();
    expect(asked).toMatchObject({ checked: 1, failed: 0 });
    expect(asked.updated).toBeUndefined();
    expect(env.fake.contentOf(NOTE)).toContain("## Drawing");
    expect(/updatedAt: .*/.exec(env.fake.contentOf(NOTE))?.[0]).toBe(dated);
  });

  it("rewrites only the pictures that changed, and trashes the ones the board dropped", async () => {
    const env = vault({
      content: mirrored({ keep: "Projekte/Atlas/keep.webp", gone: "Projekte/Atlas/gone.webp" }),
      files: { "Projekte/Atlas/keep.webp": PIXEL, "Projekte/Atlas/gone.webp": PIXEL }
    });
    fetchSource.mockResolvedValue({
      status: "updated",
      body: board({ keep: PIXEL, new: OTHER }),
      etag: ""
    });

    const summary = await poller(env.app).checkFile(env.fake.file(NOTE) as never);

    expect(summary.updated).toBe(1);
    expect(env.writes).toEqual(["Projekte/Atlas/new.webp", NOTE]);
    expect(env.trashed).toEqual(["Projekte/Atlas/gone.webp"]);
  });

  it("never trashes a person's own picture in the folder, nor one they pasted into the drawing", async () => {
    const env = vault({
      content: `${BOUND}## Embedded Files\npasted: [[Projekte/pasted.png]]\n\n%%\n## Drawing\n%%\n`,
      files: { "Projekte/Atlas/logo.png": OTHER, "Projekte/pasted.png": OTHER }
    });
    fetchSource.mockResolvedValue({ status: "updated", body: board({ abc: PIXEL }), etag: "" });

    const summary = await poller(env.app).checkFile(env.fake.file(NOTE) as never);

    expect(summary.updated).toBe(1);
    expect(env.trashed).toEqual([]);
    expect(env.pictures.has("Projekte/Atlas/logo.png")).toBe(true);
  });

  it("stops before writing anything when a file it did not write is in a picture's way", async () => {
    const env = vault({ files: { "Projekte/Atlas/abc.webp": OTHER } });
    const before = env.fake.contentOf(NOTE);
    fetchSource.mockResolvedValue({
      status: "updated",
      body: board({ new: PIXEL, abc: PIXEL }),
      etag: ""
    });

    const summary = await poller(env.app).checkFile(env.fake.file(NOTE) as never);

    expect(summary.failed).toBe(1);
    expect(summary.reason).toMatch(/Projekte\/Atlas\/abc\.webp is in the way/);
    expect(env.writes).toEqual([]);
    expect(env.fake.contentOf(NOTE)).toBe(before);
  });

  it("takes a drawing's pictures along from where they were, and clears the folder they left", async () => {
    const env = vault({
      content: mirrored({ abc: "Projekte/Alt/abc.webp" }),
      files: { "Projekte/Alt/abc.webp": PIXEL }
    });
    fetchSource.mockResolvedValue({ status: "updated", body: board({ abc: PIXEL }), etag: "" });

    await poller(env.app).checkFile(env.fake.file(NOTE) as never);

    expect([...env.pictures.keys()]).toEqual(["Projekte/Atlas/abc.webp"]);
    expect(env.trashed).toEqual(["Projekte/Alt/abc.webp", "Projekte/Alt"]);
  });

  it("takes an open drawing out of its tab for the write, and gives it back after", async () => {
    const env = vault();
    env.openTab();
    fetchSource.mockResolvedValue({ status: "updated", body: board({}), etag: "" });

    await poller(env.app).checkFile(env.fake.file(NOTE) as never);

    expect(env.writes).toEqual(["view:empty", NOTE, `open:${NOTE}`]);
  });

  it("takes an open drawing out of its tab for a new validator as well", async () => {
    const body = board({});
    const env = vault({
      content: `---\nschreibstubeSyncedFrom: ${SOURCE}\nschreibstubeSourceHash: "${hashText(body)}"\n---\n`
    });
    env.openTab();
    fetchSource.mockResolvedValue({ status: "updated", body, etag: '"api"' });

    await poller(env.app).pollAllSources("manual");

    expect(env.writes).toEqual(["view:empty", NOTE, `open:${NOTE}`]);
    expect(env.fake.contentOf(NOTE)).toContain('schreibstubeSourceEtag: "\\"api\\""');
  });

  it("leaves the note as it was when the source is not a drawing", async () => {
    const env = vault();
    const before = env.fake.contentOf(NOTE);
    fetchSource.mockResolvedValue({ status: "updated", body: "# A document", etag: "" });

    const summary = await poller(env.app).checkFile(env.fake.file(NOTE) as never);

    expect(summary).toMatchObject({ failed: 1 });
    expect(summary.reason).toMatch(/not an Excalidraw drawing/);
    expect(env.fake.contentOf(NOTE)).toBe(before);
  });

  it("keeps a drawing note that was bound to a document checking that document", async () => {
    const document = "https://raw.githubusercontent.com/o/r/main/notes.md";
    const env = vault({
      binding: document,
      content: `---\nschreibstubeSyncedFrom: ${document}\n---\n`
    });
    const store = memoryStore();
    fetchSource.mockResolvedValue({ status: "unchanged", etag: "" });

    await poller(env.app, store).pollAllSources("manual");

    expect(fetchSource.mock.calls[0]?.[0]).toMatchObject({ url: document });
    expect(fetchSource.mock.calls[0]?.[0].kind).toBeUndefined();
    expect(Object.keys(store.records())).toEqual([NOTE]);
  });

  it("does not fetch on a phone, and says why only for a drawing asked about by name", async () => {
    (Platform as { isMobile?: boolean }).isMobile = true;
    const env = vault();

    const scheduled = await poller(env.app).pollAllSources("schedule");
    expect(scheduled).toMatchObject({ checked: 0, failed: 0 });

    const folder = await poller(env.app).pollFolder("Projekte");
    expect(folder).toMatchObject({ checked: 0, failed: 0 });

    const asked = await poller(env.app).checkFile(env.fake.file(NOTE) as never);
    expect(asked.reason).toMatch(/updated on the desktop/);
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("asks a drawing at most as often as the minimum interval allows", async () => {
    const env = vault();
    fetchSource.mockResolvedValue({ status: "unchanged", etag: "" });
    const checker = poller(env.app);

    await checker.pollAllSources("schedule");
    await checker.pollAllSources("schedule");

    expect(fetchSource).toHaveBeenCalledTimes(1);
  });
});
