import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "../testing/obsidian-stub";
import {
  DescriptionFollower,
  FOLLOW_DELETE_DELAY_MS,
  FOLLOW_RENAME_DELAY_MS
} from "./description-follower";
import { descriptionNotePath } from "../services/image-description";
import { NULL_LOGGER } from "../services/logger";

const FOLDER = "Bildbeschreibungen";

/**
 * A vault of pictures and description notes: text by path, frontmatter parsed
 * from the key line the way the metadata cache would, and links resolved by
 * full path or by a unique name.
 */
function vault(files: Record<string, string>) {
  const text = new Map(Object.entries(files));
  const handles = new Map<string, TFile>();
  const file = (path: string): TFile => {
    let handle = handles.get(path);
    if (!handle) {
      handle = new TFile(path);
      handles.set(path, handle);
    }
    return handle;
  };
  const resolve = (link: string): TFile | null => {
    if (text.has(link)) return file(link);
    const named = [...text.keys()].filter((p) => p.split("/").pop() === link);
    return named.length === 1 && named[0] ? file(named[0]) : null;
  };
  const move = (from: string, to: string): TFile => {
    const content = text.get(from) ?? "";
    text.delete(from);
    text.set(to, content);
    const handle = file(from);
    handles.delete(from);
    Object.assign(handle, new TFile(to));
    handles.set(to, handle);
    return handle;
  };
  const trashed: string[] = [];
  const writes: string[] = [];

  const app = {
    vault: {
      getMarkdownFiles: () => [...text.keys()].filter((p) => p.endsWith(".md")).map(file),
      getAbstractFileByPath: (path: string) => (text.has(path) ? file(path) : null),
      cachedRead: async (f: TFile) => text.get(f.path) ?? "",
      process: async (f: TFile, fn: (t: string) => string) => {
        writes.push(f.path);
        text.set(f.path, fn(text.get(f.path) ?? ""));
      }
    },
    metadataCache: {
      getFileCache: (f: TFile) => {
        const match = /^schreibstubeImage: "(.*)"$/m.exec(text.get(f.path) ?? "");
        return match ? { frontmatter: { schreibstubeImage: match[1] } } : { frontmatter: {} };
      },
      getFirstLinkpathDest: (link: string) => resolve(link)
    },
    fileManager: {
      renameFile: vi.fn(async (f: TFile, to: string) => {
        move(f.path, to);
      }),
      trashFile: vi.fn(async (f: TFile) => {
        trashed.push(f.path);
        text.delete(f.path);
      })
    }
  } as unknown as App;

  const timers: { run: () => void; ms: number }[] = [];
  const changed = vi.fn();
  const follower = new DescriptionFollower(
    app,
    {
      setTimer: (run, ms) => timers.push({ run, ms }),
      clearTimer: () => undefined,
      changed
    },
    NULL_LOGGER
  );
  const elapse = async (): Promise<void> => {
    for (const timer of timers.splice(0)) timer.run();
    await new Promise((r) => setTimeout(r, 0));
  };
  // The stub's TFile stands in for Obsidian's, as it does across the suite.
  const follow = follower as unknown as {
    pictureRenamed(file: TFile, oldPath: string): void;
    pictureDeleted(file: TFile): void;
  };
  return { text, file, move, follower: follow, timers, elapse, trashed, writes, changed, app };
}

const noteFor = (image: string) => descriptionNotePath(FOLDER, image);
const noteText = (link: string) =>
  `---\nschreibstubeImage: "[[${link}]]"\n---\n\n![[${link}]]\n\nEin See am Abend.\n`;

describe("a described picture that moves", () => {
  it("points the note at the new place and renames it to match", async () => {
    const v = vault({
      "Bilder/see.jpg": "",
      [noteFor("Bilder/see.jpg")]: noteText("Bilder/see.jpg")
    });

    const moved = v.move("Bilder/see.jpg", "Urlaub/see.jpg");
    v.follower.pictureRenamed(moved, "Bilder/see.jpg");
    expect(v.timers[0]?.ms).toBe(FOLLOW_RENAME_DELAY_MS);
    await v.elapse();

    const renamed = noteFor("Urlaub/see.jpg");
    expect(v.text.has(noteFor("Bilder/see.jpg"))).toBe(false);
    expect(v.text.get(renamed)).toContain('schreibstubeImage: "[[Urlaub/see.jpg]]"');
    expect(v.text.get(renamed)).toContain("![[Urlaub/see.jpg]]");
    expect(v.changed).toHaveBeenCalled();
  });

  it("does not write a note Obsidian already rewrote, and still renames it", async () => {
    const old = noteFor("Bilder/see.jpg");
    const v = vault({ "Bilder/see.jpg": "", [old]: noteText("Bilder/see.jpg") });

    const moved = v.move("Bilder/see.jpg", "Urlaub/see.jpg");
    v.follower.pictureRenamed(moved, "Bilder/see.jpg");
    // "Automatically update internal links" does its part before the delay ends.
    v.text.set(old, noteText("Urlaub/see.jpg"));
    await v.elapse();

    expect(v.writes).toEqual([]);
    expect(v.text.has(noteFor("Urlaub/see.jpg"))).toBe(true);
  });

  it("renames without rewriting when a short link still finds the picture", async () => {
    const old = noteFor("Bilder/see.jpg");
    const v = vault({ "Bilder/see.jpg": "", [old]: noteText("see.jpg") });

    const moved = v.move("Bilder/see.jpg", "Urlaub/see.jpg");
    v.follower.pictureRenamed(moved, "Bilder/see.jpg");
    await v.elapse();

    expect(v.writes).toEqual([]);
    expect(v.text.get(noteFor("Urlaub/see.jpg"))).toContain("[[see.jpg]]");
  });

  it("keeps a name somebody gave the note", async () => {
    const v = vault({ "Bilder/see.jpg": "", "Notizen/Der See.md": noteText("Bilder/see.jpg") });

    const moved = v.move("Bilder/see.jpg", "Urlaub/see.jpg");
    v.follower.pictureRenamed(moved, "Bilder/see.jpg");
    await v.elapse();

    expect(v.text.get("Notizen/Der See.md")).toContain("[[Urlaub/see.jpg]]");
  });

  it("ignores notes and pictures nobody described", () => {
    const v = vault({ "Bilder/berg.jpg": "", "a.md": "text" });
    v.follower.pictureRenamed(v.move("Bilder/berg.jpg", "b.jpg"), "Bilder/berg.jpg");
    v.follower.pictureRenamed(v.move("a.md", "b.md"), "a.md");
    expect(v.timers).toEqual([]);
  });
});

describe("a described picture that is deleted", () => {
  it("sends the note to the trash after the wait", async () => {
    const note = noteFor("Bilder/see.jpg");
    const v = vault({ "Bilder/see.jpg": "", [note]: noteText("Bilder/see.jpg") });

    const gone = v.file("Bilder/see.jpg");
    v.text.delete("Bilder/see.jpg");
    v.follower.pictureDeleted(gone);
    expect(v.timers[0]?.ms).toBe(FOLLOW_DELETE_DELAY_MS);
    await v.elapse();

    expect(v.trashed).toEqual([note]);
  });

  it("leaves the note when the picture came back", async () => {
    const note = noteFor("Bilder/see.jpg");
    const v = vault({ "Bilder/see.jpg": "", [note]: noteText("Bilder/see.jpg") });

    const gone = v.file("Bilder/see.jpg");
    v.text.delete("Bilder/see.jpg");
    v.follower.pictureDeleted(gone);
    v.text.set("Bilder/see.jpg", "");
    await v.elapse();

    expect(v.trashed).toEqual([]);
  });

  it("leaves the note when a sync moved the picture and the note followed", async () => {
    const note = noteFor("Bilder/see.jpg");
    const v = vault({ "Bilder/see.jpg": "", [note]: noteText("Bilder/see.jpg") });

    const gone = v.file("Bilder/see.jpg");
    v.text.delete("Bilder/see.jpg");
    v.follower.pictureDeleted(gone);
    v.text.set("Urlaub/see-2.jpg", "");
    v.text.set(note, noteText("Urlaub/see-2.jpg"));
    await v.elapse();

    expect(v.trashed).toEqual([]);
  });
});
