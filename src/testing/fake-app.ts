/**
 * A vault a test can describe in a few lines.
 *
 * Only the parts the controllers reach for: listing Markdown files, reading
 * them, resolving a link to a file, reading frontmatter, and editing it. Link
 * resolution matches Obsidian's shortest-path behaviour closely enough for the
 * decisions being tested — a name resolves to a file with that name, wherever
 * it sits.
 */
import { TFile } from "./obsidian-stub";

export interface FakeNote {
  path: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  /** Every tag the note carries, as the stub's `getAllTags` reports them. */
  tags?: string[];
  createdMs?: number;
}

export interface FakeBinary {
  path: string;
  bytes: Uint8Array;
}

export interface FakeVault {
  app: FakeApp;
  file(path: string): TFile;
  frontmatterOf(path: string): Record<string, unknown>;
  /** What the app keeps per device, outside the synced vault. */
  deviceStorage: Map<string, unknown>;
}

interface FakeApp {
  vault: {
    getMarkdownFiles(): TFile[];
    read(file: TFile): Promise<string>;
    cachedRead(file: TFile): Promise<string>;
    readBinary(file: TFile): Promise<ArrayBuffer>;
    getAbstractFileByPath(path: string): TFile | null;
  };
  metadataCache: {
    getFileCache(file: TFile): { frontmatter?: Record<string, unknown>; tags?: string[] } | null;
    getFirstLinkpathDest(linkpath: string, from: string): TFile | null;
  };
  fileManager: {
    processFrontMatter(
      file: TFile,
      apply: (frontmatter: Record<string, unknown>) => void
    ): Promise<void>;
  };
  secretStorage: { getSecret(name: string): string | null };
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, value: unknown): void;
}

export function fakeVault({
  notes = [],
  binaries = [],
  secrets = { "publish-token": "t".repeat(32), "mail-token": "m".repeat(32) },
  device = {}
}: {
  notes?: FakeNote[];
  binaries?: FakeBinary[];
  secrets?: Record<string, string>;
  /** What this device has kept from earlier sessions, by key. */
  device?: Record<string, unknown>;
} = {}): FakeVault {
  const deviceStorage = new Map<string, unknown>(Object.entries(device));
  const files = new Map<string, TFile>();
  const contents = new Map<string, string>();
  const frontmatter = new Map<string, Record<string, unknown>>();
  const tags = new Map<string, string[]>();

  for (const note of notes) {
    files.set(note.path, new TFile(note.path, note.createdMs));
    contents.set(note.path, note.content);
    // Copied, not shared: frontmatter is mutated in place by write-back, and a
    // test that describes two notes with the same literal must not have them
    // share one object.
    frontmatter.set(note.path, { ...(note.frontmatter ?? {}) });
    if (note.tags) tags.set(note.path, note.tags);
  }
  for (const binary of binaries) {
    files.set(binary.path, new TFile(binary.path));
  }

  const find = (linkpath: string): TFile | null => {
    const wanted = linkpath.toLowerCase();
    for (const [path, file] of files) {
      const lower = path.toLowerCase();
      if (lower === wanted || lower === `${wanted}.md`) return file;
      if (file.name.toLowerCase() === wanted || file.basename.toLowerCase() === wanted) return file;
    }
    return null;
  };

  const app: FakeApp = {
    vault: {
      getMarkdownFiles: () => [...files.values()].filter((file) => file.extension === "md"),
      read: async (file) => contents.get(file.path) ?? "",
      cachedRead: async (file) => contents.get(file.path) ?? "",
      readBinary: async (file) => {
        const binary = binaries.find((entry) => entry.path === file.path);
        if (!binary) throw new Error(`no binary for ${file.path}`);
        return binary.bytes.buffer.slice(
          binary.bytes.byteOffset,
          binary.bytes.byteOffset + binary.bytes.byteLength
        ) as ArrayBuffer;
      },
      getAbstractFileByPath: (path) => files.get(path) ?? null
    },
    metadataCache: {
      getFileCache: (file) => {
        const fm = frontmatter.get(file.path);
        const carried = tags.get(file.path);
        return {
          ...(fm ? { frontmatter: fm } : {}),
          ...(carried ? { tags: carried } : {})
        };
      },
      getFirstLinkpathDest: (linkpath) => find(linkpath)
    },
    fileManager: {
      processFrontMatter: async (file, apply) => {
        const current = frontmatter.get(file.path) ?? {};
        apply(current);
        frontmatter.set(file.path, current);
      }
    },
    secretStorage: { getSecret: (name) => secrets[name] ?? null },
    // As Obsidian's: null for a key never saved.
    loadLocalStorage: (key) => deviceStorage.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      deviceStorage.set(key, value);
    }
  };

  return {
    app,
    file: (path) => {
      const file = files.get(path);
      if (!file) throw new Error(`no file at ${path}`);
      return file;
    },
    frontmatterOf: (path) => frontmatter.get(path) ?? {},
    deviceStorage
  };
}
