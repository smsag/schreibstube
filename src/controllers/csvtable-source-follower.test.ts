import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "../testing/obsidian-stub";

import { CsvTableSourceFollower } from "./csvtable-source-follower";
import { NULL_LOGGER, type Logger } from "../services/logger";

const block = (source: string) => ["```csvtable", `source: ${source}`, "```"].join("\n");

/** Notes by path, with the code sections the metadata cache would report for each. */
function vault(notes: Record<string, string>, uncached: string[] = []) {
  const text = new Map(Object.entries(notes));
  const reads: string[] = [];
  const writes: string[] = [];
  const app = {
    vault: {
      getMarkdownFiles: () => [...text.keys()].map((path) => new TFile(path)),
      cachedRead: async (file: TFile) => {
        reads.push(file.path);
        if (file.path.includes("broken")) throw new Error("unreadable");
        return text.get(file.path) ?? "";
      },
      process: async (file: TFile, fn: (t: string) => string) => {
        writes.push(file.path);
        text.set(file.path, fn(text.get(file.path) ?? ""));
      }
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        if (uncached.includes(file.path)) return null;
        const content = text.get(file.path) ?? "";
        return { sections: content.includes("```") ? [{ type: "code" }] : [{ type: "paragraph" }] };
      }
    }
  };
  return { app: app as unknown as App, text, reads, writes };
}

/** The stub's files are not Obsidian's, so the follower is asked through the shape it reads. */
interface Renames {
  renamed(file: TFile | TFolder, oldPath: string): Promise<void>;
}

function follower(app: App, logger: Logger = NULL_LOGGER) {
  const updated = vi.fn();
  const follower = new CsvTableSourceFollower(app, { updated }, logger) as unknown as Renames;
  return { follower, updated };
}

describe("CsvTableSourceFollower", () => {
  it("rewrites the notes showing a renamed CSV file and says how many", async () => {
    const v = vault({
      "Mieten.md": `# Mieten\n${block("Daten/miete.csv")}`,
      "Andere.md": block("Daten/andere.csv"),
      "Text.md": "Daten/miete.csv steht hier nur im Text."
    });
    const { follower: f, updated } = follower(v.app);

    await f.renamed(new TFile("Archiv/miete.csv"), "Daten/miete.csv");

    expect(v.text.get("Mieten.md")).toBe(`# Mieten\n${block("Archiv/miete.csv")}`);
    expect(v.writes).toEqual(["Mieten.md"]);
    expect(updated).toHaveBeenCalledWith(1);
  });

  it("does not read a note the cache says has no code block", async () => {
    const v = vault({ "Text.md": "nur Text", "Mieten.md": block("a.csv") });
    await follower(v.app).follower.renamed(new TFile("b.csv"), "a.csv");
    expect(v.reads).toEqual(["Mieten.md"]);
  });

  it("reads a note the cache has not parsed yet", async () => {
    const v = vault({ "Neu.md": block("a.csv") }, ["Neu.md"]);
    await follower(v.app).follower.renamed(new TFile("b.csv"), "a.csv");
    expect(v.text.get("Neu.md")).toBe(block("b.csv"));
  });

  it("follows every CSV file in a renamed folder", async () => {
    const v = vault({
      "Übersicht.md": [block("Daten/a.csv"), block("Daten/Sub/b.tsv")].join("\n")
    });
    const folder = new TFolder("Export");
    const sub = new TFolder("Export/Sub");
    sub.children.push(new TFile("Export/Sub/b.tsv"));
    folder.children.push(new TFile("Export/a.csv"), new TFile("Export/notiz.md"), sub);

    await follower(v.app).follower.renamed(folder, "Daten");

    expect(v.text.get("Übersicht.md")).toBe(
      [block("Export/a.csv"), block("Export/Sub/b.tsv")].join("\n")
    );
  });

  it("does nothing for a file that is no CSV", async () => {
    const v = vault({ "Mieten.md": block("a.md") });
    const { follower: f, updated } = follower(v.app);
    await f.renamed(new TFile("b.md"), "a.md");
    expect(v.reads).toEqual([]);
    expect(updated).not.toHaveBeenCalled();
  });

  it("stays silent when no note pointed at the file", async () => {
    const v = vault({ "Mieten.md": block("other.csv") });
    const { follower: f, updated } = follower(v.app);
    await f.renamed(new TFile("b.csv"), "a.csv");
    expect(v.writes).toEqual([]);
    expect(updated).not.toHaveBeenCalled();
  });

  it("goes on past a note it cannot read, and logs it", async () => {
    const v = vault({ "broken.md": block("a.csv"), "Gut.md": block("a.csv") });
    const warn = vi.fn();
    const { follower: f, updated } = follower(v.app, { ...NULL_LOGGER, warn });
    await f.renamed(new TFile("b.csv"), "a.csv");
    expect(v.text.get("Gut.md")).toBe(block("b.csv"));
    expect(warn).toHaveBeenCalledOnce();
    expect(updated).toHaveBeenCalledWith(1);
  });
});
