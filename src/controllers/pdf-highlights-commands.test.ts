// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile } from "../testing/obsidian-stub";
import { PdfHighlightCommands, type PdfMarksReader } from "./pdf-highlights-commands";
import { createLogger } from "../services/logger";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import type { PdfMark, PdfPlacedRun } from "../services/pdf-highlights";
import type { MarkedReadResult } from "../pdf/pdf-reader";
import type { TemplaterCreate } from "../services/workspace-internals";
import { setLanguage } from "../i18n";

const YELLOW: [number, number, number] = [250, 205, 90];

function run(text: string, y: number): PdfPlacedRun {
  return { text, endsLine: true, x: 0, y, width: text.length, height: 10 };
}

function box(from: number, to: number, y: number) {
  return { x0: from, x1: to, y0: y - 2, y1: y + 9 };
}

/** Highlighted in yellow and underlined: the text that counts. */
function bothOver(from: number, to: number, y: number): PdfMark[] {
  return [
    { kind: "highlight", color: YELLOW, boxes: [box(from, to, y)] },
    { kind: "underline", color: [236, 40, 20], boxes: [box(from, to, y)] }
  ];
}

/** "First words" and "last words" marked twice, "skipped" between them not. */
const MARKED: MarkedReadResult = {
  pages: [
    {
      page: 1,
      runs: [run("First words skipped last words", 100)],
      marks: [...bothOver(0, 11, 100), ...bothOver(20, 30, 100)]
    }
  ],
  totalPages: 1,
  truncated: false
};

interface FakeOptions {
  read?: PdfMarksReader;
  template?: string;
  templateText?: string;
  existing?: string[];
  newFileFolder?: string;
  /** How Templater renders a template's text; absent when it is not installed. */
  templater?: (text: string) => Promise<string | null>;
  createFails?: boolean;
  modifyFails?: boolean;
  openFails?: boolean;
  templateReadFails?: boolean;
}

function fake(options: FakeOptions = {}) {
  const files = new Map<string, string>();
  if (options.templateText !== undefined) files.set("Vorlagen/Lesenotiz.md", options.templateText);
  for (const path of options.existing ?? []) files.set(path, "");
  const opened: string[] = [];
  /** Every write of a note, in order: what Templater's trigger would see. */
  const writes: { path: string; text: string; how: "create" | "modify" }[] = [];

  const app = {
    vault: {
      readBinary: vi.fn(async () => new ArrayBuffer(8)),
      getAbstractFileByPath: (path: string) => (files.has(path) ? new TFile(path) : null),
      cachedRead: async (file: TFile) => {
        if (options.templateReadFails) throw new Error("gone");
        return files.get(file.path) ?? "";
      },
      read: async (file: TFile) => files.get(file.path) ?? "",
      create: async (path: string, text: string) => {
        if (options.createFails) throw new Error("taken");
        files.set(path, text);
        writes.push({ path, text, how: "create" });
        return new TFile(path);
      },
      modify: async (file: TFile, text: string) => {
        if (options.modifyFails) throw new Error("sync conflict");
        files.set(file.path, text);
        writes.push({ path: file.path, text, how: "modify" });
      }
    },
    fileManager: {
      getNewFileParent: () => ({ path: options.newFileFolder ?? "Inbox" }),
      generateMarkdownLink: (target: TFile) => `[[${target.name}]]`
    },
    workspace: {
      getLeaf: () => ({
        openFile: async (file: TFile) => {
          if (options.openFails) throw new Error("no leaf");
          opened.push(file.path);
        }
      })
    }
  } as unknown as App;

  // Templater's create_new_note_from_template, as far as this command sees it:
  // the template rendered into a new note, or nothing when the template failed.
  const templater = options.templater;
  const create: TemplaterCreate | null = templater
    ? async (template, folder, name) => {
        const rendered = await templater(files.get(template.path) ?? "");
        if (rendered === null) return null;
        const path = `${folder}/${name}.md`;
        files.set(path, rendered);
        return new TFile(path) as unknown as import("obsidian").TFile;
      }
    : null;

  const settings = { ...DEFAULT_SETTINGS, pdfHighlightsTemplate: options.template ?? "" };
  const commands = new PdfHighlightCommands(
    app,
    createLogger(() => false, silent),
    () => settings,
    options.read ?? (async () => MARKED),
    () => create
  );
  return { commands, files, opened, writes };
}

const pdf = new TFile("Papers/Organization Design.pdf") as unknown as import("obsidian").TFile;
const notices = (): string => Notice.shown.join(" ");
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

beforeEach(() => {
  setLanguage("en");
  Notice.shown = [];
});

describe("PdfHighlightCommands.highlightsToNote", () => {
  it("writes the marked text into a note in the folder for new notes, and opens it", async () => {
    const { commands, files, opened } = fake();

    await commands.highlightsToNote(pdf);

    expect(files.get("Inbox/Organization Design.md")).toBe(
      "First words […] last words\n\n![[Organization Design.pdf]]\n"
    );
    expect(opened).toEqual(["Inbox/Organization Design.md"]);
    expect(notices()).toContain("2 passages written to Organization Design");
  });

  it("fills the template: its variables, then the text and the embed where it says", async () => {
    const { commands, files } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText:
        '---\ntitle: "{{title}}"\n---\n### Auszug\n\n{{schreibstube-highlights}}\n\n## Ressourcen\n\n{{schreibstube-pdf}}\n'
    });

    await commands.highlightsToNote(pdf);

    expect(files.get("Inbox/Organization Design.md")).toBe(
      '---\ntitle: "Organization Design"\n---\n### Auszug\n\nFirst words […] last words\n\n## Ressourcen\n\n![[Organization Design.pdf]]\n'
    );
  });

  it("takes the next free name rather than writing over a note", async () => {
    const { commands, files } = fake({ existing: ["Inbox/Organization Design.md"] });

    await commands.highlightsToNote(pdf);

    expect(files.get("Inbox/Organization Design.md")).toBe("");
    expect(files.get("Inbox/Organization Design 1.md")).toContain("First words");
  });

  it("writes a note without Templater code once, whole, so no trigger finds it empty", async () => {
    const { commands, writes } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText: "## Auszug\n\n{{schreibstube-highlights}}\n"
    });

    await commands.highlightsToNote(pdf);

    expect(writes).toEqual([
      {
        path: "Inbox/Organization Design.md",
        text: "## Auszug\n\nFirst words […] last words\n",
        how: "create"
      }
    ]);
  });

  it("has Templater make the note, then puts the PDF's text in", async () => {
    const seen: string[] = [];
    const { commands, files } = fake({
      template: "Vorlagen/Lesenotiz.md",
      templateText: "# <% tp.file.title %> {{date:YYYY}}\n\n{{schreibstube-highlights}}\n",
      templater: async (text) => {
        seen.push(text);
        return text.replace("<% tp.file.title %>", "Rendered");
      }
    });

    await commands.highlightsToNote(pdf);

    expect(seen).toEqual(["# <% tp.file.title %> {{date:YYYY}}\n\n{{schreibstube-highlights}}\n"]);
    expect(files.get("Inbox/Organization Design.md")).toBe(
      `# Rendered ${new Date().getFullYear()}\n\nFirst words […] last words\n`
    );
  });

  it("puts no code from the PDF's name or text in front of Templater", async () => {
    const sly = new TFile("Papers/<% tp.x %>.pdf") as unknown as import("obsidian").TFile;
    const marked: MarkedReadResult = {
      pages: [{ page: 1, runs: [run("run <% tp.y %> it", 100)], marks: bothOver(0, 17, 100) }],
      totalPages: 1,
      truncated: false
    };
    const { commands, writes } = fake({
      read: async () => marked,
      template: "Vorlagen/Lesenotiz",
      templateText: "{{title}}\n{{schreibstube-highlights}}\n{{schreibstube-pdf}}\n"
    });

    await commands.highlightsToNote(sly);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).not.toContain("<%");
  });

  it("makes no note when Templater fails, and says so", async () => {
    const { commands, files } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText: "<% tp.oops %>\n{{schreibstube-highlights}}",
      templater: async () => {
        throw new Error("tp.oops is undefined");
      }
    });

    await commands.highlightsToNote(pdf);

    expect(files.has("Inbox/Organization Design.md")).toBe(false);
    expect(notices()).toContain("tp.oops is undefined");
  });

  it("says so when Templater gives back no note", async () => {
    const { commands, files } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText: "<% tp.oops %>",
      templater: async () => null
    });

    await commands.highlightsToNote(pdf);

    expect(files.has("Inbox/Organization Design.md")).toBe(false);
    expect(notices()).toContain("Templater made no note from Vorlagen/Lesenotiz.md");
  });

  it("says so when the note Templater made cannot be filled", async () => {
    const { commands, opened } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText: "<% tp.file.title %>",
      templater: async (text) => text,
      modifyFails: true
    });

    await commands.highlightsToNote(pdf);

    expect(opened).toEqual([]);
    expect(notices()).toContain("text could not be written into it");
  });

  it("says when the template has Templater code and Templater is not there", async () => {
    const { commands } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText: "<% tp.date.now() %>"
    });

    await commands.highlightsToNote(pdf);

    expect(notices()).toContain("Templater is not installed");
  });

  it("makes the note without a template that cannot be read, and says so", async () => {
    const { commands, files } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText: "{{schreibstube-highlights}}",
      templateReadFails: true
    });

    await commands.highlightsToNote(pdf);

    expect(files.get("Inbox/Organization Design.md")).toContain("First words […] last words");
    expect(notices()).toContain("Vorlagen/Lesenotiz.md was not found");
  });

  it("still says the note was made when it cannot be shown", async () => {
    const { commands, files } = fake({ openFails: true });

    await commands.highlightsToNote(pdf);

    expect(files.get("Inbox/Organization Design.md")).toContain("First words");
    expect(notices()).toContain("2 passages written to Organization Design");
  });

  it("makes the note without a template that is not there, and says so", async () => {
    const { commands, files } = fake({ template: "Vorlagen/Fehlt" });

    await commands.highlightsToNote(pdf);

    expect(files.get("Inbox/Organization Design.md")).toContain("First words […] last words");
    expect(notices()).toContain("Vorlagen/Fehlt.md was not found");
  });

  it("makes no note for a PDF with nothing marked", async () => {
    const empty: MarkedReadResult = {
      pages: [{ page: 1, runs: [run("plain", 100)], marks: [] }],
      totalPages: 1,
      truncated: false
    };
    const { commands, files } = fake({ read: async () => empty });

    await commands.highlightsToNote(pdf);

    expect(files.size).toBe(0);
    expect(notices()).toContain("no text both highlighted in yellow and underlined");
  });

  it("makes no note for text that is only highlighted", async () => {
    const yellowOnly: MarkedReadResult = {
      pages: [{ page: 1, runs: [run("marked once", 100)], marks: [bothOver(0, 11, 100)[0]!] }],
      totalPages: 1,
      truncated: false
    };
    const { commands, files } = fake({ read: async () => yellowOnly });

    await commands.highlightsToNote(pdf);

    expect(files.size).toBe(0);
    expect(notices()).toContain("no text both highlighted in yellow and underlined");
  });

  it("says when the marks have no text under them", async () => {
    const scan: MarkedReadResult = {
      pages: [{ page: 1, runs: [], marks: bothOver(0, 5, 100) }],
      totalPages: 1,
      truncated: false
    };
    const { commands, files } = fake({ read: async () => scan });

    await commands.highlightsToNote(pdf);

    expect(files.size).toBe(0);
    expect(notices()).toContain("no text under them");
  });

  it("says when the PDF cannot be read", async () => {
    const { commands, files } = fake({
      read: async () => {
        throw new Error("password");
      }
    });

    await commands.highlightsToNote(pdf);

    expect(files.size).toBe(0);
    expect(notices()).toContain("Organization Design could not be read");
  });

  it("says when only the first pages were read", async () => {
    const { commands } = fake({
      read: async () => ({ ...MARKED, totalPages: 300, truncated: true })
    });

    await commands.highlightsToNote(pdf);

    expect(notices()).toContain("read the first 1 of 300 pages");
  });

  it("says when the note cannot be created", async () => {
    const { commands, opened } = fake({ createFails: true });

    await commands.highlightsToNote(pdf);

    expect(opened).toEqual([]);
    expect(notices()).toContain("Inbox/Organization Design.md could not be created");
  });
});
