// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile } from "../testing/obsidian-stub";
import { PdfHighlightCommands, type PdfMarksReader } from "./pdf-highlights-commands";
import { createLogger } from "../services/logger";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import type { PdfMark, PdfPlacedRun } from "../services/pdf-highlights";
import type { MarkedReadResult } from "../pdf/pdf-reader";
import type { TemplaterRender } from "../services/workspace-internals";
import { setLanguage } from "../i18n";

const YELLOW: [number, number, number] = [250, 205, 90];

function run(text: string, y: number): PdfPlacedRun {
  return { text, endsLine: true, x: 0, y, width: text.length, height: 10 };
}

function yellowOver(from: number, to: number, y: number): PdfMark {
  return { kind: "highlight", color: YELLOW, boxes: [{ x0: from, x1: to, y0: y - 2, y1: y + 9 }] };
}

/** "First words" and "last words" highlighted, "skipped" between them not. */
const MARKED: MarkedReadResult = {
  pages: [
    {
      page: 1,
      runs: [run("First words skipped last words", 100)],
      marks: [yellowOver(0, 11, 100), yellowOver(20, 30, 100)]
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
  templater?: TemplaterRender | null;
  createFails?: boolean;
}

function fake(options: FakeOptions = {}) {
  const files = new Map<string, string>();
  if (options.templateText !== undefined) files.set("Vorlagen/Lesenotiz.md", options.templateText);
  for (const path of options.existing ?? []) files.set(path, "");
  const opened: string[] = [];

  const app = {
    vault: {
      readBinary: vi.fn(async () => new ArrayBuffer(8)),
      getAbstractFileByPath: (path: string) => (files.has(path) ? new TFile(path) : null),
      cachedRead: async (file: TFile) => files.get(file.path) ?? "",
      create: async (path: string, text: string) => {
        if (options.createFails) throw new Error("taken");
        files.set(path, text);
        return new TFile(path);
      },
      modify: async (file: TFile, text: string) => {
        files.set(file.path, text);
      }
    },
    fileManager: {
      getNewFileParent: () => ({ path: options.newFileFolder ?? "Inbox" }),
      generateMarkdownLink: (target: TFile) => `[[${target.name}]]`
    },
    workspace: {
      getLeaf: () => ({ openFile: async (file: TFile) => opened.push(file.path) })
    }
  } as unknown as App;

  const settings = { ...DEFAULT_SETTINGS, pdfHighlightsTemplate: options.template ?? "" };
  const commands = new PdfHighlightCommands(
    app,
    createLogger(() => false, silent),
    () => settings,
    options.read ?? (async () => MARKED),
    () => options.templater ?? null
  );
  return { commands, files, opened };
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

  it("runs Templater on the template before the PDF's text is in it", async () => {
    const seen: string[] = [];
    const templater: TemplaterRender = async (_template, _target, text) => {
      seen.push(text);
      return text.replace("<% tp.file.title %>", "Rendered");
    };
    const { commands, files } = fake({
      template: "Vorlagen/Lesenotiz.md",
      templateText: "# <% tp.file.title %>\n\n{{schreibstube-highlights}}\n",
      templater
    });

    await commands.highlightsToNote(pdf);

    expect(seen).toEqual(["# <% tp.file.title %>\n\n{{schreibstube-highlights}}\n"]);
    expect(files.get("Inbox/Organization Design.md")).toBe(
      "# Rendered\n\nFirst words […] last words\n"
    );
  });

  it("keeps the Templater code as written when Templater fails, and says so", async () => {
    const { commands, files } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText: "<% tp.oops %>\n{{schreibstube-highlights}}",
      templater: async () => {
        throw new Error("tp.oops is undefined");
      }
    });

    await commands.highlightsToNote(pdf);

    expect(files.get("Inbox/Organization Design.md")).toBe(
      "<% tp.oops %>\nFirst words […] last words"
    );
    expect(notices()).toContain("tp.oops is undefined");
  });

  it("says when the template has Templater code and Templater is not there", async () => {
    const { commands } = fake({
      template: "Vorlagen/Lesenotiz",
      templateText: "<% tp.date.now() %>"
    });

    await commands.highlightsToNote(pdf);

    expect(notices()).toContain("Templater is not installed");
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
    expect(notices()).toContain("no text highlighted in yellow or underlined");
  });

  it("says when the marks have no text under them", async () => {
    const scan: MarkedReadResult = {
      pages: [{ page: 1, runs: [], marks: [yellowOver(0, 5, 100)] }],
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
