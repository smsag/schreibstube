import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Editor, TFile } from "obsidian";
import { Notice } from "../testing/obsidian-stub";
import { PdfCommands } from "./pdf-commands";
import type { PassagePicker, PdfTextReader } from "./pdf-commands";
import { createLogger } from "../services/logger";
import type { ReadResult } from "../pdf/pdf-reader";
import type { PdfPassage } from "../services/pdf-passages";
import { setLanguage } from "../i18n";

const file = (path: string): TFile =>
  ({
    path,
    basename:
      path
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? path
  }) as TFile;

const runs = (...texts: string[]): ReadResult => ({
  pages: [{ page: 12, runs: texts.map((text) => ({ text, endsLine: true })) }],
  totalPages: 12,
  truncated: false
});

interface FakeOptions {
  embeds?: string[];
  links?: string[];
  /** Link paths the vault cannot resolve. */
  missing?: string[];
  read?: PdfTextReader;
}

function fake(options: FakeOptions = {}) {
  const missing = new Set(options.missing ?? []);
  const inserted: string[] = [];

  const app = {
    workspace: { getActiveFile: () => file("Notiz.md") },
    metadataCache: {
      getFileCache: () => ({
        embeds: (options.embeds ?? []).map((link) => ({ link })),
        links: (options.links ?? []).map((link) => ({ link }))
      }),
      getFirstLinkpathDest: (linkPath: string) => (missing.has(linkPath) ? null : file(linkPath))
    },
    vault: { readBinary: vi.fn(async () => new ArrayBuffer(8)) },
    fileManager: {
      generateMarkdownLink: (target: TFile, _source: string, subpath: string, alias: string) =>
        `[[${target.path}${subpath}|${alias}]]`
    }
  } as unknown as App;

  const editor = {
    replaceSelection: (text: string) => inserted.push(text)
  } as unknown as Editor;

  const read: PdfTextReader =
    options.read ?? (async () => runs("Ein Satz, der lang genug ist, um zu zählen."));

  // Chooses everything offered, which is what makes the insert observable.
  const pick: PassagePicker = (passages, _name, onSubmit) => onSubmit(passages);
  const chosen: PdfPassage[][] = [];
  const recordingPick: PassagePicker = (passages, name, onSubmit) =>
    pick(passages, name, (result) => {
      chosen.push(result);
      onSubmit(result);
    });

  const commands = new PdfCommands(
    app,
    createLogger(() => false, silent),
    read,
    recordingPick
  );
  return { app, editor, commands, inserted, chosen };
}

const notices = (): string[] => Notice.shown;

/** Warnings here are the subject of a test, not a sign one went wrong. */
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

beforeEach(() => {
  setLanguage("en");
  Notice.shown = [];
});

describe("PdfCommands.referencedPdfs", () => {
  it("resolves the PDFs a note embeds and links", () => {
    const { commands } = fake({ embeds: ["Bericht.pdf"], links: ["Anhang.pdf"] });

    expect(commands.referencedPdfs(file("Notiz.md")).map((f) => f.path)).toEqual([
      "Bericht.pdf",
      "Anhang.pdf"
    ]);
  });

  it("leaves out a link the vault cannot resolve", () => {
    const { commands } = fake({ embeds: ["Fehlt.pdf", "Da.pdf"], missing: ["Fehlt.pdf"] });

    expect(commands.referencedPdfs(file("Notiz.md")).map((f) => f.path)).toEqual(["Da.pdf"]);
  });
});

describe("PdfCommands.insertSummary", () => {
  it("says so when the note points at no PDF", async () => {
    const { commands, editor, inserted } = fake({ embeds: ["Bild.png"] });

    await commands.insertSummary(editor);

    expect(inserted).toEqual([]);
    expect(notices().join(" ")).toContain("points at no PDF");
  });

  it("writes the passage with a jump mark to the page it came from", async () => {
    const { commands, editor, inserted } = fake({ embeds: ["Bericht.pdf"] });

    await commands.insertSummary(editor);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain("Ein Satz, der lang genug ist, um zu zählen.");
    expect(inserted[0]).toMatch(/\[\[Bericht\.pdf#page=12&selection=0,0,0,\d+\|↗\]\]/);
  });

  it("says so when the PDF has no text layer, instead of offering an empty list", async () => {
    const { commands, editor, inserted } = fake({
      embeds: ["Scan.pdf"],
      read: async () => ({ pages: [{ page: 1, runs: [] }], totalPages: 1, truncated: false })
    });

    await commands.insertSummary(editor);

    expect(inserted).toEqual([]);
    expect(notices().join(" ")).toContain("no text layer");
  });

  it("says so when the PDF cannot be read at all", async () => {
    const { commands, editor, inserted } = fake({
      embeds: ["Kaputt.pdf"],
      read: async () => {
        throw new Error("encrypted");
      }
    });

    await commands.insertSummary(editor);

    expect(inserted).toEqual([]);
    expect(notices().join(" ")).toContain("could not be read");
  });

  it("warns when it read only part of a long document", async () => {
    const { commands, editor } = fake({
      embeds: ["Buch.pdf"],
      read: async () => ({
        ...runs("Ein Satz, der lang genug ist, um zu zählen."),
        totalPages: 900,
        truncated: true
      })
    });

    await commands.insertSummary(editor);

    expect(notices().join(" ")).toContain("of 900 pages");
  });

  it("inserts nothing when nothing was chosen", async () => {
    const app = fake({ embeds: ["Bericht.pdf"] });
    const commands = new PdfCommands(
      app.app,
      createLogger(() => false, silent),
      async () => runs("Ein Satz, der lang genug ist, um zu zählen."),
      (_passages, _name, onSubmit) => onSubmit([])
    );

    await commands.insertSummary(app.editor);

    expect(app.inserted).toEqual([]);
  });
});
