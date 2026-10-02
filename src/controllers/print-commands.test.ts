import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile, TFolder } from "../testing/obsidian-stub";
import { createLogger } from "../services/logger";
import { setLanguage } from "../i18n";
import type { PrintTemplate } from "../services/print-template";
import type { PrintOptions } from "../services/print-options";
import type { PrintDialogHost } from "../ui/print-dialog";
import type { SchreibstubeSettings } from "../types";

/** What the compiler was handed, and what it answers with. */
const compiler = vi.hoisted(() => ({
  pdf: new Uint8Array() as Uint8Array,
  jobs: [] as { main: string }[],
  /** Diagnostics to refuse the next compile with, as Typst would. */
  refuse: null as string[] | null,
  /** A compile that waits until a test lets it go, to see what runs meanwhile. */
  hold: null as Promise<void> | null,
  /** The slides the compile reports it made smaller. */
  fits: [] as { page: number; scale: number }[]
}));

vi.mock("../print/typst-compiler", () => ({
  TypstCompiler: class {
    async compile(job: { main: string }) {
      if (compiler.hold) await compiler.hold;
      compiler.jobs.push(job);

      if (compiler.refuse) return { ok: false, diagnostics: compiler.refuse };
      return { ok: true, pdf: compiler.pdf, fits: compiler.fits };
    }
    dispose(): void {}
  }
}));

/** How a person answers the questions printing asks. */
const answers = vi.hoisted(() => ({
  replace: false,
  asked: [] as string[],
  /** The templates each print dialog offered, by folder. */
  offered: [] as string[][],
  /** The template each dialog opened with, by folder. */
  preselected: [] as string[],
  /** Whether each dialog offered the choice about slideshows. */
  slideshowChoice: [] as boolean[],
  /** What the person changes in the dialog before pressing "Drucken". */
  change: null as null | ((options: PrintOptions, templates: PrintTemplate[]) => PrintOptions),
  /** Whether "Drucken" is pressed after the preview was set, so its document is reused. */
  afterPreview: true,
  /** What the dialog was told about each template's margins. */
  fixesMargin: [] as boolean[],
  /** What the dialog was told about each template's text face, and where it started. */
  readsMonospace: [] as boolean[],
  initialMonospace: [] as boolean[],
  /** What each dialog was told about Pythia, and where its footnotes started. */
  pythia: [] as (PrintDialogHost["pythia"] | undefined)[],
  initialPythia: [] as boolean[],
  /** The warnings under each preview. */
  previewWarnings: [] as string[][],
  /** Whether each dialog was told it prints a passage rather than the note. */
  passage: [] as boolean[],
  /** The dialog's run, which a test waits for: it prints after the command returned. */
  finished: Promise.resolve()
}));

vi.mock("../ui/explorer-modals", () => ({
  ConfirmModal: class {
    constructor(
      _app: unknown,
      private readonly options: { title: string },
      private readonly onConfirm: () => void
    ) {}
    onClose(): void {}
    open(): void {
      answers.asked.push(this.options.title);
      if (answers.replace) this.onConfirm();
      this.onClose();
    }
  },
  FolderPickerModal: class {}
}));

vi.mock("../ui/print-modals", () => ({ PrintExampleModal: class {} }));

/** The longest edge each picture was asked to be made, by the size hint it came with. */
const resized = vi.hoisted(() => ({
  edges: [] as number[],
  /** What each picture was decoded as and drawn again as. */
  types: [] as [string, string | undefined][]
}));

// Resizing draws on a canvas, which the tests do not have; what matters here
// is how large a picture was asked to be.
vi.mock("../services/image-resize", async (original) => ({
  ...(await original<typeof import("../services/image-resize")>()),
  resizeImageToBytes: async (
    buffer: ArrayBuffer,
    mime: string,
    maxPx: number,
    _quality?: number,
    output?: string
  ) => {
    resized.edges.push(maxPx);
    resized.types.push([mime, output]);
    return { bytes: new Uint8Array(buffer) };
  }
}));

// The dialog as a person uses it: it opens, the preview is set, a choice may
// change, and "Drucken" is pressed.
vi.mock("../ui/print-dialog", () => ({
  PrintDialog: class {
    constructor(
      _app: unknown,
      private readonly host: PrintDialogHost
    ) {}
    open(): void {
      const { host } = this;
      answers.offered.push(host.templates.map((template) => template.folder));
      answers.preselected.push(host.initial.template.folder);
      answers.slideshowChoice.push(host.hasSlideshows);
      answers.passage.push(host.passage);
      answers.finished = (async () => {
        const options = answers.change
          ? answers.change(host.initial, host.templates)
          : host.initial;
        answers.fixesMargin.push(await host.fixesMargin(options.template));
        answers.readsMonospace.push(await host.readsMonospace(options.template));
        answers.initialMonospace.push(host.initial.monospace);
        answers.pythia.push(host.pythia);
        answers.initialPythia.push(host.initial.pythiaFootnotes);
        const ready = answers.afterPreview ? await host.preview(options, () => {}) : null;
        if (ready) answers.previewWarnings.push(ready.warnings);
        await host.print(options, ready).done;
      })();
    }
  }
}));

const { PrintCommands } = await import("./print-commands");

type Commands = InstanceType<typeof PrintCommands>;

/** Print without the dialog, and wait for it too when the settings made it open. */
async function quick(commands: Commands): Promise<void> {
  await commands.printActiveNoteQuickly();
  await answers.finished;
}

/** Print through the dialog, and wait until "Drucken" has done its work. */
async function viaDialog(commands: Commands): Promise<void> {
  await commands.printActiveNote();
  await answers.finished;
}

const typeset = (): Uint8Array =>
  new TextEncoder().encode("%PDF-1.7\n<</Creator(Typst 0.14.2)>>\n%%EOF");

const LAYOUT = "#let template(body, data) = body";

interface VaultOptions {
  /** Folders holding a template, each with a descriptor, a layout and what else is listed. */
  templates?: string[];
  /** Which template the note names in its frontmatter. */
  named?: string;
  /** Files already in the vault, by path, with their bytes. */
  existing?: Record<string, Uint8Array>;
  /** Font files in a template's fonts folder, by size. */
  fonts?: number[];
  outputFolder?: string;
  /** The default-template setting; the built-in one unless a test says otherwise. */
  defaultTemplate?: string;
  /** The note's text, and its properties beside any template it names. */
  note?: string;
  properties?: Record<string, unknown>;
  /** The vault templates' layout. */
  layout?: string;
  /** Pythia's plugin object, as the registry hands it out; absent: Pythia is not enabled. */
  pythia?: unknown;
  /** What is marked in the note's editor; absent: no editor shows the note. */
  selection?: string;
}

function vault(options: VaultOptions = {}) {
  const files = new Map<string, TFile | TFolder>();
  const bytes = new Map<string, Uint8Array>();
  const texts = new Map<string, string>();
  const frontmatter = new Map<string, Record<string, unknown>>();
  const written: { path: string; how: "create" | "modify" }[] = [];
  const folders: string[] = [];
  const read: string[] = [];

  const addFile = (path: string, content: Uint8Array | string, size?: number): TFile => {
    const file = new TFile(path);
    if (typeof content === "string") texts.set(path, content);
    else bytes.set(path, content);
    file.stat.size = size ?? (typeof content === "string" ? content.length : content.byteLength);
    files.set(path, file);
    const parent = path.slice(0, path.lastIndexOf("/"));
    const folder = parent ? addFolder(parent) : null;
    folder?.children.push(file);
    file.parent = folder;
    return file;
  };
  const addFolder = (path: string): TFolder => {
    const known = files.get(path);
    if (known instanceof TFolder) return known;
    const folder = new TFolder(path);
    files.set(path, folder);
    return folder;
  };

  const noteText = options.note ?? "# Anfrage\n\nSehr geehrte Damen und Herren,";
  const note = addFile("Briefe/Anfrage.md", noteText);
  frontmatter.set(note.path, {
    ...options.properties,
    ...(options.named ? { schreibstubePrintTemplate: options.named } : {})
  });

  for (const folder of options.templates ?? ["Vorlagen/Druck/Brief"]) {
    const descriptor = addFile(`${folder}/template.md`, "");
    frontmatter.set(descriptor.path, { schreibstubePrintTemplate: true });
    addFile(`${folder}/template.typ`, options.layout ?? LAYOUT);
    (options.fonts ?? []).forEach((size, index) => {
      addFile(`${folder}/fonts/face-${index}.ttf`, new Uint8Array(4), size);
    });
  }
  for (const [path, content] of Object.entries(options.existing ?? {})) addFile(path, content);

  const app = {
    plugins: {
      enabledPlugins: new Set(options.pythia === undefined ? [] : ["pythia"]),
      getPlugin: (id: string) => (id === "pythia" ? options.pythia : null)
    },
    workspace: {
      getActiveFile: () => note,
      getActiveViewOfType: () =>
        options.selection === undefined
          ? null
          : {
              file: note,
              editor: { getSelection: () => options.selection, getValue: () => noteText }
            }
    },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file.path) }),
      getFirstLinkpathDest: () => null
    },
    vault: {
      getMarkdownFiles: () =>
        [...files.values()].filter(
          (file): file is TFile => file instanceof TFile && file.extension === "md"
        ),
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      read: async (file: TFile) => texts.get(file.path) ?? "",
      readBinary: async (file: TFile) => (bytes.get(file.path) ?? new Uint8Array()).buffer.slice(0),
      createBinary: vi.fn(async (path: string) => {
        written.push({ path, how: "create" });
        return addFile(path, compiler.pdf);
      }),
      modifyBinary: vi.fn(async (file: TFile) => {
        written.push({ path: file.path, how: "modify" });
      }),
      createFolder: vi.fn(async (path: string) => {
        folders.push(path);
        addFolder(path);
      }),
      adapter: {
        exists: async (path: string) => files.has(path),
        read: async (path: string) => {
          const text = texts.get(path);
          if (text === undefined) throw new Error(`no ${path}`);
          return text;
        },
        readBinary: async (path: string) => {
          read.push(path);
          const content = bytes.get(path);
          if (!content) throw new Error(`no ${path}`);
          return content.buffer.slice(0) as ArrayBuffer;
        },
        writeBinary: vi.fn()
      }
    }
  } as unknown as App;

  const settings = {
    printEnabled: true,
    printTemplateRoot: "Vorlagen/Druck",
    printOutputFolder: options.outputFolder ?? "",
    printDefaultTemplate: options.defaultTemplate ?? ""
  } as SchreibstubeSettings;

  const commands = new PrintCommands(
    app,
    () => settings,
    ".obsidian/plugins/schreibstube",
    "1.0.0",
    createLogger(() => false),
    async () => {}
  );

  return { app, commands, written, folders, read };
}

beforeEach(() => {
  setLanguage("en");
  Notice.shown = [];
  compiler.pdf = typeset();
  compiler.jobs = [];
  compiler.refuse = null;
  compiler.fits = [];
  compiler.hold = null;

  answers.replace = false;
  answers.asked = [];
  answers.offered = [];
  answers.preselected = [];
  answers.slideshowChoice = [];
  resized.edges = [];
  resized.types = [];
  answers.change = null;
  answers.afterPreview = true;
  answers.fixesMargin = [];
  answers.readsMonospace = [];
  answers.initialMonospace = [];
  answers.pythia = [];
  answers.initialPythia = [];
  answers.previewWarnings = [];
  answers.passage = [];
  answers.finished = Promise.resolve();
  vi.stubGlobal("window", {
    WebAssembly,
    Worker: class {},
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("printing a note", () => {
  it("writes the document beside the note, through the vault", async () => {
    const { commands, written } = vault();
    await quick(commands);

    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "create" }]);
    expect(Notice.shown.join("\n")).toContain("printed Briefe/Anfrage.pdf");
  });

  it("makes the output folder when it does not exist yet", async () => {
    const { commands, written, folders } = vault({ outputFolder: "Ausgabe/Druck" });
    await quick(commands);

    expect(folders).toEqual(["Ausgabe", "Ausgabe/Druck"]);
    expect(written).toEqual([{ path: "Ausgabe/Druck/Anfrage.pdf", how: "create" }]);
  });

  it("replaces an earlier print without asking", async () => {
    const { commands, written } = vault({ existing: { "Briefe/Anfrage.pdf": typeset() } });
    await quick(commands);

    expect(answers.asked).toEqual([]);
    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "modify" }]);
  });

  it("asks before replacing a PDF that printing did not make, and keeps it on no", async () => {
    const scan = new TextEncoder().encode("%PDF-1.4\n<</Creator(Scanner)>>");
    const { commands, written } = vault({ existing: { "Briefe/Anfrage.pdf": scan } });
    await quick(commands);

    expect(answers.asked).toEqual(["Replace this file?"]);
    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain("was left alone; nothing was printed");
  });

  it("replaces it on yes", async () => {
    answers.replace = true;
    const scan = new TextEncoder().encode("%PDF-1.4\n<</Creator(Scanner)>>");
    const { commands, written } = vault({ existing: { "Briefe/Anfrage.pdf": scan } });
    await quick(commands);

    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "modify" }]);
  });

  it("refuses a second print while one is still compiling, and says so", async () => {
    const { commands, written } = vault({ defaultTemplate: "Vorlagen/Druck/Brief" });
    let release: () => void = () => {};
    compiler.hold = new Promise((resolve) => (release = resolve));

    const first = commands.printActiveNoteQuickly();
    await commands.printActiveNoteQuickly();
    expect(Notice.shown.join(" ")).toMatch(/already running/);

    release();
    await first;
    expect(written).toHaveLength(1);
  });

  it("refuses a document over the size limit rather than writing it", async () => {
    compiler.pdf = new Uint8Array(31 * 1024 * 1024);
    const { commands, written } = vault();
    await quick(commands);

    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain("the document came to 31 MB");
  });

  it("hands the compiler a job whose layout can replace the prelude's helpers", async () => {
    const { commands } = vault();
    await quick(commands);

    const main = compiler.jobs[0]?.main ?? "";
    expect(main.indexOf('"template.typ": *')).toBeGreaterThan(main.indexOf('"schreibstube.typ"'));
  });
});

describe("Pythia's footnotes", () => {
  const linked =
    "# Anfrage\n\nThe index is ==[capped](obsidian://pythia?cmd=resume&id=c&msg=m)== for now.";
  const copy =
    "# Anfrage\n\nThe index is ==capped==[^1] for now.\n\n[^1]: Rent cap (Pythia) — Die Kappung gilt nur für neue Verträge.\n";

  function pythia(over: Record<string, unknown> = {}) {
    const calls = { inspected: [] as (string | undefined)[], copies: 0, refreshes: 0 };
    const api = {
      version: 1,
      inspectForExport: (_markdown: string, path?: string) => {
        calls.inspected.push(path);
        return { links: 1, outdated: 1, missing: 0 };
      },
      refreshSummaries: async (
        _markdown: string,
        options?: { onProgress?: (d: number, t: number) => void }
      ) => {
        calls.refreshes += 1;
        options?.onProgress?.(1, 1);
        return { refreshed: 1, failed: [] };
      },
      withExportFootnotes: () => {
        calls.copies += 1;
        return copy;
      },
      ...over
    };
    return { plugin: { api }, calls };
  }

  it("offers the footnotes, on, for a note that links to Pythia — and prints Pythia's copy", async () => {
    const { plugin, calls } = pythia();
    const { commands } = vault({ note: linked, pythia: plugin });
    await viaDialog(commands);

    expect(answers.pythia[0]?.inspection).toEqual({ links: 1, outdated: 1, missing: 0 });
    expect(answers.initialPythia).toEqual([true]);
    // Pythia is told which note it is, so it can keep its own record.
    expect(calls.inspected).toEqual(["Briefe/Anfrage.md"]);
    expect(compiler.jobs.at(-1)?.main).toContain("Die Kappung gilt nur für neue Verträge");
    expect(compiler.jobs.at(-1)?.main).not.toContain("obsidian://");
  });

  it("prints the note as it is when the footnotes are switched off", async () => {
    const { plugin, calls } = pythia();
    const { commands } = vault({ note: linked, pythia: plugin });
    answers.change = (options) => ({ ...options, pythiaFootnotes: false });
    await viaDialog(commands);

    expect(calls.copies).toBe(0);
    expect(compiler.jobs.at(-1)?.main).not.toContain("Die Kappung");
  });

  it("uses the same default when printing without the dialog", async () => {
    const { plugin } = pythia();
    const { commands } = vault({ note: linked, pythia: plugin });
    await quick(commands);

    expect(compiler.jobs.at(-1)?.main).toContain("Die Kappung gilt nur für neue Verträge");
  });

  it("offers nothing when Pythia is not there, or the note links to nothing of Pythia's", async () => {
    await viaDialog(vault({ note: linked }).commands);
    const { plugin } = pythia({ inspectForExport: () => ({ links: 0, outdated: 0, missing: 0 }) });
    await viaDialog(vault({ note: linked, pythia: plugin }).commands);

    expect(answers.pythia).toEqual([undefined, undefined]);
    expect(answers.initialPythia).toEqual([false, false]);
  });

  it("says which slides the compile had to set too small to read", async () => {
    compiler.fits = [
      { page: 6, scale: 0.45 },
      { page: 2, scale: 0.9 }
    ];
    const { commands } = vault({ note: linked });
    await viaDialog(commands);

    expect(answers.previewWarnings[0]).toContain(
      "slide 6 holds more than fits and is set as small as 45 % — worth splitting"
    );
  });

  it("prints the note unchanged, and says why, when Pythia's copy is unusable", async () => {
    const { plugin } = pythia({ withExportFootnotes: () => 42 });
    const { commands, written } = vault({ note: linked, pythia: plugin });
    await viaDialog(commands);

    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "create" }]);
    expect(answers.previewWarnings[0]).toContain(
      "Pythia did not hand over its footnotes, so the note is printed without them."
    );
  });

  it("refreshes the summaries only when asked, and reports what Pythia did", async () => {
    const { plugin, calls } = pythia();
    await viaDialog(vault({ note: linked, pythia: plugin }).commands);
    expect(calls.refreshes).toBe(0);

    const progress: [number, number][] = [];
    const result = await answers.pythia[0]!.refresh(new AbortController().signal, (d, t) =>
      progress.push([d, t])
    );
    expect(result).toEqual({ refreshed: 1, failed: 0 });
    expect(progress).toEqual([[1, 1]]);
  });

  it("refuses a refresh answer in a shape it does not know", async () => {
    const { plugin } = pythia({ refreshSummaries: async () => "done" });
    await viaDialog(vault({ note: linked, pythia: plugin }).commands);
    await expect(
      answers.pythia[0]!.refresh(new AbortController().signal, () => {})
    ).rejects.toThrow("Pythia did not hand over its footnotes");
  });
});

describe("choosing the template", () => {
  const both = ["Vorlagen/Druck/Brief", "Privat/Brief"];

  it("opens the dialog on one of them when a name fits more than one", async () => {
    const { commands } = vault({ templates: both, named: "Brief" });
    await quick(commands);

    expect(answers.offered).toHaveLength(1);
    expect(both).toContain(answers.preselected[0]);
  });

  it("uses the one a folder path names, without asking", async () => {
    const { commands, written } = vault({ templates: both, named: "Privat/Brief" });
    await quick(commands);

    expect(answers.offered).toEqual([]);
    expect(written).toHaveLength(1);
  });

  it("says which template it could not find", async () => {
    const { commands, written } = vault({ named: "Rechnung" });
    await quick(commands);

    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain('asks for the template "Rechnung"');
  });
});

describe("the budget, before anything is read", () => {
  it("refuses a font folder over the limit without reading a single font", async () => {
    const { commands, read, written } = vault({
      named: "Brief",
      fonts: [5 * 1024 * 1024, 5 * 1024 * 1024]
    });
    await quick(commands);

    expect(read.filter((path) => path.includes("/fonts/"))).toEqual([]);
    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain("fonts total 10 MB, at most 8 MB are used");
  });

  it("reads fonts within the limit", async () => {
    const { commands, read } = vault({ named: "Brief", fonts: [1024] });
    await quick(commands);

    expect(read).toContain("Vorlagen/Druck/Brief/fonts/face-0.ttf");
  });
});

describe("the default template", () => {
  const entryOf = (): string =>
    /#show: body => ([\w-]+)\(/.exec(compiler.jobs[0]?.main ?? "")?.[1] ?? "";

  it("prints with the built-in one in a vault that has no template at all", async () => {
    const { commands, written } = vault({ templates: [] });
    await quick(commands);

    expect(answers.offered).toEqual([]);
    expect(entryOf()).toBe("standard");
    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "create" }]);
  });

  it("prints a note that names none with the built-in one, without asking", async () => {
    const { commands } = vault();
    await quick(commands);

    expect(answers.offered).toEqual([]);
    expect(entryOf()).toBe("standard");
  });

  it("takes the built-in layout from the plugin, not from a folder in the vault", async () => {
    const { commands, read } = vault({ templates: [] });
    await quick(commands);

    expect(compiler.jobs[0]?.main).toContain('#import "template.typ": *');
    expect(read).toEqual([]);
  });

  it("uses the vault template the settings name", async () => {
    const { commands } = vault({ defaultTemplate: "Vorlagen/Druck/Brief" });
    await quick(commands);

    expect(answers.offered).toEqual([]);
    expect(entryOf()).toBe("template");
  });

  it("opens the dialog on all of them, the built-in one included, when the setting says ask", async () => {
    const { commands } = vault({ defaultTemplate: ":ask" });
    await quick(commands);

    // The vault's own first, the built-in one after them.
    expect(answers.offered).toEqual([["Vorlagen/Druck/Brief", ":builtin/Standard"]]);
  });

  it("says so and asks when the default the settings name has gone", async () => {
    const { commands } = vault({ defaultTemplate: "Weg/Vorlage" });
    await quick(commands);

    expect(Notice.shown.join("\n")).toContain(
      "the default template Weg/Vorlage is no longer in this vault"
    );
    expect(answers.offered).toHaveLength(1);
  });

  it("prints with the built-in one even beside a vault template called Standard", async () => {
    const { commands } = vault({ templates: ["Vorlagen/Druck/Standard"] });
    await quick(commands);
    expect(entryOf()).toBe("standard");
  });

  it("reaches a vault template called Standard by its folder", async () => {
    const { commands } = vault({
      templates: ["Vorlagen/Druck/Standard"],
      named: "Vorlagen/Druck/Standard"
    });
    await quick(commands);
    // Its layout is the test's own, whose entry is `template`.
    expect(entryOf()).toBe("template");
  });

  it("prints with the built-in one when a note asks for Standard by name", async () => {
    const { commands } = vault({ named: "Standard" });
    await quick(commands);

    expect(entryOf()).toBe("standard");
  });
});

describe("the print dialog", () => {
  const main = (): string => compiler.jobs[compiler.jobs.length - 1]?.main ?? "";

  it("opens on the template the note or the settings choose, offering all of them", async () => {
    const { commands } = vault();
    await viaDialog(commands);

    expect(answers.offered).toEqual([["Vorlagen/Druck/Brief", ":builtin/Standard"]]);
    expect(answers.preselected).toEqual([":builtin/Standard"]);
  });

  it("writes the preview's own document rather than setting it again", async () => {
    const { commands, written } = vault();
    await viaDialog(commands);

    expect(compiler.jobs).toHaveLength(1);
    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "create" }]);
  });

  it("sets the document when printed before a preview was ready", async () => {
    answers.afterPreview = false;
    const { commands, written } = vault();
    await viaDialog(commands);

    expect(compiler.jobs).toHaveLength(1);
    expect(written).toHaveLength(1);
  });

  it("replaces the template's margin with the preset chosen", async () => {
    answers.change = (options) => ({ ...options, margin: "small" });
    const { commands } = vault();
    await viaDialog(commands);

    expect(main()).toContain("margin: 15mm");
  });

  it("keeps the template's own margin for the standard preset", async () => {
    const { commands } = vault();
    await viaDialog(commands);

    // The built-in Standard's descriptor: 25 mm, 30 at the foot.
    expect(main()).toContain("margin: (top: 25mm, x: 25mm, bottom: 30mm)");
  });

  it("turns horizontal rules into page breaks when asked", async () => {
    answers.change = (options) => ({ ...options, hrIsPageBreak: true });
    const { commands } = vault({ note: "# Anfrage\n\noben\n\n---\n\nunten" });
    await viaDialog(commands);

    expect(main()).toContain("#pagebreak(weak: true)");
  });

  it("prints the note's properties when asked, and leaves them out otherwise", async () => {
    const properties = { autor: "Steffen", tags: ["brief", "anfrage"] };
    const { commands } = vault({ properties });
    await viaDialog(commands);
    expect(main()).not.toContain("schreibstube-properties");

    compiler.jobs = [];
    answers.change = (options) => ({ ...options, frontmatter: true });
    const second = vault({ properties });
    await viaDialog(second.commands);
    expect(main()).toContain(
      '#schreibstube-properties((("autor", "Steffen"), ("tags", "brief, anfrage"),))'
    );
  });

  it("prints with another template chosen in the dialog", async () => {
    answers.change = (options, templates) => ({
      ...options,
      template: templates.find((template) => !template.builtIn) ?? options.template
    });
    const { commands } = vault();
    await viaDialog(commands);

    expect(main()).toContain("#show: body => template(body, data)");
  });

  it("tells the dialog which templates set their own margins", async () => {
    const own = "#let template(body, data) = { set page(margin: 20mm); body }";
    answers.change = (options, templates) => ({
      ...options,
      template: templates.find((template) => !template.builtIn) ?? options.template
    });
    const { commands } = vault({ layout: own });
    await viaDialog(commands);
    expect(answers.fixesMargin).toEqual([true]);

    answers.fixesMargin = [];
    answers.change = null;
    const builtIn = vault({ layout: own });
    await viaDialog(builtIn.commands);
    expect(answers.fixesMargin).toEqual([false]);
  });

  it("offers the text face for the built-in template, which reads it, and not for one that does not", async () => {
    const { commands } = vault();
    await viaDialog(commands);
    expect(answers.readsMonospace).toEqual([true]);

    answers.readsMonospace = [];
    answers.change = (options, templates) => ({
      ...options,
      template: templates.find((template) => !template.builtIn) ?? options.template
    });
    await viaDialog(vault().commands);
    expect(answers.readsMonospace).toEqual([false]);
  });

  it("starts the text face from the note, and prints the one chosen in the dialog", async () => {
    await viaDialog(vault({ properties: { schreibstubePrint: { monospace: false } } }).commands);
    expect(answers.initialMonospace).toEqual([false]);
    expect(main()).toContain('monospace: "false"');

    answers.change = (options) => ({ ...options, monospace: true });
    await viaDialog(vault({ properties: { schreibstubePrint: { monospace: false } } }).commands);
    expect(main()).toContain('monospace: "true"');
  });

  it("says what went wrong and writes nothing when a template does not compile", async () => {
    const { commands, written } = vault({ layout: "" });
    answers.change = (options, templates) => ({
      ...options,
      template: templates.find((template) => !template.builtIn) ?? options.template
    });
    answers.afterPreview = false;
    compiler.refuse = ["/template.typ:1:1: error: unknown variable: template"];
    await viaDialog(commands);

    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain("the template did not compile");
  });
});

describe("slideshows in the print dialog", () => {
  const main = (): string => compiler.jobs[compiler.jobs.length - 1]?.main ?? "";
  const show =
    "# Urlaub\n\n```schreibstube-slideshow\nlayout: strip\n![Strand](Bilder/strand.png)\n" +
    "![Hafen](Bilder/hafen%20alt.png)\n![Markt](Bilder/markt.png)\n```";
  const pictures = ["Bilder/strand.png", "Bilder/hafen alt.png", "Bilder/markt.png"];

  it("offers the choice only for a note that holds a slideshow", async () => {
    const plain = vault();
    await viaDialog(plain.commands);
    const withShow = vault({ note: show, existing: files(pictures) });
    await viaDialog(withShow.commands);

    expect(answers.slideshowChoice).toEqual([false, true]);
  });

  it("prints a slideshow as it stands in the note, finding a path written with %20", async () => {
    const { commands } = vault({ note: show, existing: files(pictures) });
    await viaDialog(commands);

    expect(main()).toContain('#schreibstube-slideshow("strip", ');
    expect(main()).toContain("columns: 3");
    expect(main()).toContain('"assets/Bilder-hafen-alt.png"');
    // Three tiles across the text: each read at a third of the template's limit.
    expect(resized.edges).toEqual([534, 534, 534]);
  });

  it("stacks every picture when the dialog says so", async () => {
    answers.change = (options) => ({ ...options, slideshows: "stacked" });
    const { commands } = vault({ note: show, existing: files(pictures) });
    await viaDialog(commands);

    expect(main()).toContain('#schreibstube-slideshow("stacked", ');
    expect(main()).toContain("columns: 1");
    expect(resized.edges).toEqual([1600, 1600, 1600]);
  });

  it("prints a slideshow as it stands when printed without the dialog", async () => {
    const { commands } = vault({ note: show, existing: files(pictures) });
    await quick(commands);

    expect(main()).toContain('#schreibstube-slideshow("strip", ');
  });
});

/** Picture files for the fake vault: a PNG signature is all the reader looks at. */
function files(paths: string[]): Record<string, Uint8Array> {
  return Object.fromEntries(paths.map((path) => [path, new Uint8Array([137, 80, 78, 71])]));
}

describe("pictures in formats Typst does not read as they are", () => {
  const main = (): string => compiler.jobs[compiler.jobs.length - 1]?.main ?? "";
  const job = () =>
    compiler.jobs[compiler.jobs.length - 1] as unknown as {
      files: { path: string; bytes: Uint8Array }[];
    };

  it("prints an AVIF as the JPEG it is drawn into, named so Typst reads it as one", async () => {
    const { commands } = vault({
      note: "Text\n\n![](Visuals/IMG_2443.avif)",
      existing: files(["Visuals/IMG_2443.avif"])
    });
    await quick(commands);

    expect(resized.types).toEqual([["image/avif", "image/jpeg"]]);
    expect(main()).toContain('#schreibstube-image("assets/Visuals-IMG_2443.avif.jpg", "")');
    expect(Notice.shown.join("\n")).not.toContain("not found");
  });

  it("names a GIF for the PNG it becomes, which kept a whole print from compiling", async () => {
    const { commands } = vault({ note: "![](anim.gif)", existing: files(["anim.gif"]) });
    await quick(commands);

    expect(resized.types).toEqual([["image/gif", "image/png"]]);
    expect(main()).toContain('"assets/anim.gif.png"');
  });

  it("hands an SVG to Typst untouched, without drawing it into pixels", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const { commands } = vault({ note: "![](plan.svg)", existing: { "plan.svg": svg } });
    await quick(commands);

    expect(resized.types).toEqual([]);
    expect(main()).toContain('"assets/plan.svg"');
    expect(job().files.find((file) => file.path === "assets/plan.svg")?.bytes).toEqual(svg);
  });

  it("says a picture's format cannot be printed, rather than that it is missing", async () => {
    const { commands } = vault({ note: "![](scan.tiff)", existing: files(["scan.tiff"]) });
    await quick(commands);

    const said = Notice.shown.join("\n");
    expect(said).toContain("scan.tiff is in a format a print cannot carry");
    expect(said).not.toContain("image not found");
  });

  it("still says so when a picture is not in the vault at all", async () => {
    const { commands } = vault({ note: "![](weg.png)" });
    await quick(commands);

    expect(Notice.shown.join("\n")).toContain("image not found: weg.png");
  });
});

describe("printing a selection", () => {
  const main = (): string => compiler.jobs[compiler.jobs.length - 1]?.main ?? "";
  const NOTE = [
    "# Bewerbung",
    "",
    "Sehr geehrte Damen und Herren,",
    "",
    "## Lebenslauf",
    "",
    "Seit 2021 Produktmanager[^1].",
    "",
    "## Anlagen",
    "",
    "[^1]: Bei der Beispiel GmbH."
  ].join("\n");

  async function printSelection(commands: Commands): Promise<void> {
    await commands.printActiveSelection();
    await answers.finished;
  }

  it("prints only what is marked, to a PDF of its own beside the note's", async () => {
    const { commands, written } = vault({
      note: NOTE,
      selection: "## Lebenslauf\n\nSeit 2021 Produktmanager[^1].",
      existing: { "Briefe/Anfrage.pdf": typeset() }
    });
    await printSelection(commands);

    expect(answers.passage).toEqual([true]);
    expect(main()).toContain("Seit 2021 Produktmanager");
    expect(main()).not.toContain("Sehr geehrte");
    expect(main()).not.toContain("Anlagen");
    expect(written).toEqual([{ path: "Briefe/Anfrage – Lebenslauf.pdf", how: "create" }]);
  });

  it("brings a footnote defined further down the note along", async () => {
    const { commands } = vault({
      note: NOTE,
      selection: "## Lebenslauf\n\nSeit 2021 Produktmanager[^1]."
    });
    await printSelection(commands);

    expect(main()).toContain("#footnote[Bei der Beispiel GmbH.]");
  });

  it("says so, and prints nothing, when nothing is marked", async () => {
    const { commands, written } = vault({ note: NOTE, selection: "  \n" });
    await printSelection(commands);

    expect(compiler.jobs).toEqual([]);
    expect(written).toEqual([]);
    expect(Notice.shown.join(" ")).toContain("nothing is selected");
  });

  it("leaves the note's totals waiting, which are matched by their place in the whole note", async () => {
    const freeze = vi.fn(async () => 1);
    const { commands } = vault({ note: NOTE, selection: "## Lebenslauf\n\nText" });
    commands.useFormulas({
      forExport: async (text) => ({
        text,
        freezes: [{ table: 0, row: 0, column: 0, value: "1" }] as never
      }),
      freeze
    });
    await printSelection(commands);

    expect(freeze).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("starts a page before the blocks chosen in the preview", async () => {
    answers.change = (options) => ({ ...options, breaksBefore: [1] });
    const { commands } = vault({ note: NOTE, selection: "## Lebenslauf\n\nErster Absatz" });
    await printSelection(commands);

    expect(main()).toMatch(
      /#pagebreak\(weak: true\)\n\n#metadata\(1\) <schreibstube-block>\n\nErster Absatz/
    );
  });

  it("marks the preview's blocks for a click, and a print set without a preview has no marks", async () => {
    const { commands } = vault({ note: NOTE, selection: "## Lebenslauf\n\nText" });
    await printSelection(commands);
    expect(main()).toContain("<schreibstube-blocks>");

    compiler.jobs = [];
    answers.afterPreview = false;
    const second = vault({ note: NOTE, selection: "## Lebenslauf\n\nText" });
    await printSelection(second.commands);
    expect(main()).not.toContain("schreibstube-block");
  });
});
