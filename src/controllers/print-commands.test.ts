import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile, TFolder } from "../testing/obsidian-stub";
import { createLogger } from "../services/logger";
import { setLanguage } from "../i18n";
import type { PrintTemplate } from "../services/print-template";
import type { SchreibstubeSettings } from "../types";

/** What the compiler was handed, and what it answers with. */
const compiler = vi.hoisted(() => ({
  pdf: new Uint8Array() as Uint8Array,
  jobs: [] as { main: string }[]
}));

vi.mock("../print/typst-compiler", () => ({
  TypstCompiler: class {
    async compile(job: { main: string }) {
      compiler.jobs.push(job);
      return { ok: true, pdf: compiler.pdf };
    }
    dispose(): void {}
  }
}));

/** How a person answers the questions printing asks. */
const answers = vi.hoisted(() => ({
  replace: false,
  asked: [] as string[],
  offered: [] as string[][]
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

vi.mock("../ui/print-modals", () => ({
  PrintTemplateModal: class {
    constructor(
      _app: unknown,
      private readonly templates: PrintTemplate[],
      private readonly choose: (template: PrintTemplate | null) => void
    ) {}
    open(): void {
      answers.offered.push(this.templates.map((template) => template.folder));
      this.choose(this.templates[this.templates.length - 1] ?? null);
    }
  },
  PrintExampleModal: class {}
}));

const { PrintCommands } = await import("./print-commands");

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

  const note = addFile("Briefe/Anfrage.md", "# Anfrage\n\nSehr geehrte Damen und Herren,");
  frontmatter.set(note.path, options.named ? { schreibstubePrintTemplate: options.named } : {});

  for (const folder of options.templates ?? ["Vorlagen/Druck/Brief"]) {
    const descriptor = addFile(`${folder}/template.md`, "");
    frontmatter.set(descriptor.path, { schreibstubePrintTemplate: true });
    addFile(`${folder}/template.typ`, LAYOUT);
    (options.fonts ?? []).forEach((size, index) => {
      addFile(`${folder}/fonts/face-${index}.ttf`, new Uint8Array(4), size);
    });
  }
  for (const [path, content] of Object.entries(options.existing ?? {})) addFile(path, content);

  const app = {
    workspace: { getActiveFile: () => note },
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
    printOutputFolder: options.outputFolder ?? ""
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
  answers.replace = false;
  answers.asked = [];
  answers.offered = [];
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
    await commands.printActiveNote();

    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "create" }]);
    expect(Notice.shown.join("\n")).toContain("printed Briefe/Anfrage.pdf");
  });

  it("makes the output folder when it does not exist yet", async () => {
    const { commands, written, folders } = vault({ outputFolder: "Ausgabe/Druck" });
    await commands.printActiveNote();

    expect(folders).toEqual(["Ausgabe", "Ausgabe/Druck"]);
    expect(written).toEqual([{ path: "Ausgabe/Druck/Anfrage.pdf", how: "create" }]);
  });

  it("replaces an earlier print without asking", async () => {
    const { commands, written } = vault({ existing: { "Briefe/Anfrage.pdf": typeset() } });
    await commands.printActiveNote();

    expect(answers.asked).toEqual([]);
    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "modify" }]);
  });

  it("asks before replacing a PDF that printing did not make, and keeps it on no", async () => {
    const scan = new TextEncoder().encode("%PDF-1.4\n<</Creator(Scanner)>>");
    const { commands, written } = vault({ existing: { "Briefe/Anfrage.pdf": scan } });
    await commands.printActiveNote();

    expect(answers.asked).toEqual(["Replace this file?"]);
    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain("was left alone; nothing was printed");
  });

  it("replaces it on yes", async () => {
    answers.replace = true;
    const scan = new TextEncoder().encode("%PDF-1.4\n<</Creator(Scanner)>>");
    const { commands, written } = vault({ existing: { "Briefe/Anfrage.pdf": scan } });
    await commands.printActiveNote();

    expect(written).toEqual([{ path: "Briefe/Anfrage.pdf", how: "modify" }]);
  });

  it("refuses a document over the size limit rather than writing it", async () => {
    compiler.pdf = new Uint8Array(31 * 1024 * 1024);
    const { commands, written } = vault();
    await commands.printActiveNote();

    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain("the document came to 31 MB");
  });

  it("hands the compiler a job whose layout can replace the prelude's helpers", async () => {
    const { commands } = vault();
    await commands.printActiveNote();

    const main = compiler.jobs[0]?.main ?? "";
    expect(main.indexOf('"template.typ": *')).toBeGreaterThan(main.indexOf('"schreibstube.typ"'));
  });
});

describe("choosing the template", () => {
  const both = ["Vorlagen/Druck/Brief", "Privat/Brief"];

  it("asks among the templates a name fits when it fits more than one", async () => {
    const { commands } = vault({ templates: both, named: "Brief" });
    await commands.printActiveNote();

    expect(answers.offered.map((folders) => [...folders].sort())).toEqual([
      ["Privat/Brief", "Vorlagen/Druck/Brief"]
    ]);
  });

  it("uses the one a folder path names, without asking", async () => {
    const { commands, written } = vault({ templates: both, named: "Privat/Brief" });
    await commands.printActiveNote();

    expect(answers.offered).toEqual([]);
    expect(written).toHaveLength(1);
  });

  it("says which template it could not find", async () => {
    const { commands, written } = vault({ named: "Rechnung" });
    await commands.printActiveNote();

    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain('asks for the template "Rechnung"');
  });
});

describe("the budget, before anything is read", () => {
  it("refuses a font folder over the limit without reading a single font", async () => {
    const { commands, read, written } = vault({ fonts: [5 * 1024 * 1024, 5 * 1024 * 1024] });
    await commands.printActiveNote();

    expect(read.filter((path) => path.includes("/fonts/"))).toEqual([]);
    expect(written).toEqual([]);
    expect(Notice.shown.join("\n")).toContain("fonts total 10 MB, at most 8 MB are used");
  });

  it("reads fonts within the limit", async () => {
    const { commands, read } = vault({ fonts: [1024] });
    await commands.printActiveNote();

    expect(read).toContain("Vorlagen/Druck/Brief/fonts/face-0.ttf");
  });
});
