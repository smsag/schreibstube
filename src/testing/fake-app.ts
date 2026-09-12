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
}

interface FakeApp {
  vault: {
    getMarkdownFiles(): TFile[];
    read(file: TFile): Promise<string>;
    readBinary(file: TFile): Promise<ArrayBuffer>;
    getAbstractFileByPath(path: string): TFile | null;
  };
  metadataCache: {
    getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null;
    getFirstLinkpathDest(linkpath: string, from: string): TFile | null;
  };
  fileManager: {
    processFrontMatter(
      file: TFile,
      apply: (frontmatter: Record<string, unknown>) => void
    ): Promise<void>;
  };
  secretStorage: { getSecret(name: string): string | null };
}

export function fakeVault({
  notes = [],
  binaries = [],
  secrets = { "publish-token": "t".repeat(32), "mail-token": "m".repeat(32) }
}: {
  notes?: FakeNote[];
  binaries?: FakeBinary[];
  secrets?: Record<string, string>;
} = {}): FakeVault {
  const files = new Map<string, TFile>();
  const contents = new Map<string, string>();
  const frontmatter = new Map<string, Record<string, unknown>>();

  for (const note of notes) {
    files.set(note.path, new TFile(note.path, note.createdMs));
    contents.set(note.path, note.content);
    // Copied, not shared: frontmatter is mutated in place by write-back, and a
    // test that describes two notes with the same literal must not have them
    // share one object.
    frontmatter.set(note.path, { ...(note.frontmatter ?? {}) });
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
      getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) }),
      getFirstLinkpathDest: (linkpath) => find(linkpath)
    },
    fileManager: {
      processFrontMatter: async (file, apply) => {
        const current = frontmatter.get(file.path) ?? {};
        apply(current);
        frontmatter.set(file.path, current);
      }
    },
    secretStorage: { getSecret: (name) => secrets[name] ?? null }
  };

  return {
    app,
    file: (path) => {
      const file = files.get(path);
      if (!file) throw new Error(`no file at ${path}`);
      return file;
    },
    frontmatterOf: (path) => frontmatter.get(path) ?? {}
  };
}
