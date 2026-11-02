import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, type App } from "obsidian";
import { FileView, TFile, TFolder } from "../testing/obsidian-stub";
import { fakeVault } from "../testing/fake-app";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { createLogger } from "../services/logger";
import { setLanguage } from "../i18n";
import { hashText } from "../services/sync-document";
import { DRAWING_HASH_KEY } from "../services/drawing-mirror";
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

/** The fake vault, with the folders, pictures and trash a drawing reaches for. */
function vault() {
  const fake = fakeVault({
    notes: [
      {
        path: NOTE,
        content: `---\nschreibstubeSyncedFrom: ${SOURCE}\n---\n`,
        frontmatter: { schreibstubeSyncedFrom: SOURCE }
      }
    ]
  });
  const folders = new Map<string, TFolder>();
  const pictures = new Map<string, { file: TFile; bytes: Uint8Array }>();
  const trashed: string[] = [];
  const writes: string[] = [];

  const base = fake.app.vault;
  const vault = {
    ...base,
    getAbstractFileByPath: (path: string) =>
      folders.get(path) ?? pictures.get(path)?.file ?? base.getAbstractFileByPath(path),
    createFolder: async (path: string) => void folders.set(path, new TFolder(path)),
    createBinary: async (path: string, data: ArrayBuffer) => {
      const file = new TFile(path);
      pictures.set(path, { file, bytes: new Uint8Array(data) });
      folders.get(path.slice(0, path.lastIndexOf("/")))?.children.push(file);
      writes.push(path);
    },
    modifyBinary: async (file: TFile, data: ArrayBuffer) => {
      pictures.set(file.path, { file, bytes: new Uint8Array(data) });
      writes.push(file.path);
    },
    readBinary: async (file: TFile) => pictures.get(file.path)?.bytes.slice().buffer,
    process: async (file: TFile, apply: (text: string) => string) => {
      writes.push(file.path);
      return base.process(file, apply);
    }
  };
  const fileManager = {
    ...fake.app.fileManager,
    trashFile: async (file: TFile) => {
      trashed.push(file.path);
      pictures.delete(file.path);
      const folder = folders.get(file.path.slice(0, file.path.lastIndexOf("/")));
      if (folder) folder.children = folder.children.filter((child) => child !== file);
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
  const app = { ...fake.app, vault, fileManager, workspace } as unknown as App;
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
function cacheCatchesUp(fake: ReturnType<typeof vault>["fake"], text: string): void {
  const hash = /schreibstubeSourceHash: "([0-9a-f]+)"/.exec(text)?.[1];
  if (hash !== undefined) fake.frontmatterOf(NOTE)[DRAWING_HASH_KEY] = hash;
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

  it("sends the validator it wrote, and writes nothing for the same board", async () => {
    const env = vault();
    const body = board({ abc: PIXEL });
    fetchSource.mockResolvedValue({ status: "updated", body, etag: '"v1"' });
    await poller(env.app).checkFile(env.fake.file(NOTE) as never);
    cacheCatchesUp(env.fake, env.fake.contentOf(NOTE));
    env.fake.frontmatterOf(NOTE).schreibstubeSourceEtag = '"v1"';
    env.writes.length = 0;

    fetchSource.mockResolvedValue({ status: "unchanged", etag: '"v1"' });
    const unchanged = await poller(env.app).checkFile(env.fake.file(NOTE) as never);
    expect(fetchSource.mock.calls[1]?.[0].etag).toBe('"v1"');
    expect(unchanged).toMatchObject({ checked: 1, failed: 0 });
    expect(unchanged.updated).toBeUndefined();

    fetchSource.mockResolvedValue({ status: "updated", body, etag: '"v1"' });
    await poller(env.app).checkFile(env.fake.file(NOTE) as never);
    expect(env.writes).toEqual([]);
  });

  it("rewrites only the pictures that changed, and trashes the ones the board dropped", async () => {
    const env = vault();
    fetchSource.mockResolvedValue({
      status: "updated",
      body: board({ keep: PIXEL, gone: PIXEL }),
      etag: ""
    });
    await poller(env.app).checkFile(env.fake.file(NOTE) as never);
    cacheCatchesUp(env.fake, env.fake.contentOf(NOTE));
    env.writes.length = 0;

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

  it("takes an open drawing out of its tab for the write, and gives it back after", async () => {
    const env = vault();
    env.openTab();
    fetchSource.mockResolvedValue({ status: "updated", body: board({}), etag: "" });

    await poller(env.app).checkFile(env.fake.file(NOTE) as never);

    expect(env.writes).toEqual(["view:empty", NOTE, `open:${NOTE}`]);
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

  it("does not fetch on a phone, and says why when asked", async () => {
    (Platform as { isMobile?: boolean }).isMobile = true;
    const env = vault();

    const scheduled = await poller(env.app).pollAllSources("schedule");
    expect(scheduled).toMatchObject({ checked: 0, failed: 0 });

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
