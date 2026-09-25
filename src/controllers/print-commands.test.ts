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
  refuse: null as string[] | null
}));

vi.mock("../print/typst-compiler", () => ({
  TypstCompiler: class {
    async compile(job: { main: string }) {
      compiler.jobs.push(job);
      if (compiler.refuse) return { ok: false, diagnostics: compiler.refuse };
      return { ok: true, pdf: compiler.pdf };
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
  /** What the person changes in the dialog before pressing "Drucken". */
  change: null as null | ((options: PrintOptions, templates: PrintTemplate[]) => PrintOptions),
  /** Whether "Drucken" is pressed after the preview was set, so its document is reused. */
  afterPreview: true,
  /** What the dialog was told about each template's margins. */
  fixesMargin: [] as boolean[],
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
      answers.finished = (async () => {
        const options = answers.change
          ? answers.change(host.initial, host.templates)
          : host.initial;
        answers.fixesMargin.push(await host.fixesMargin(options.template));
        const ready = answers.afterPreview ? await host.preview(options, () => {}) : null;
        await host.print(options, ready);
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

  const note = addFile(
    "Briefe/Anfrage.md",
    options.note ?? "# Anfrage\n\nSehr geehrte Damen und Herren,"
  );
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
  answers.replace = false;
  answers.asked = [];
  answers.offered = [];
  answers.preselected = [];
  answers.change = null;
  answers.afterPreview = true;
  answers.fixesMargin = [];
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

  it("prints with a vault copy called Standard rather than the built-in one", async () => {
    const { commands } = vault({ templates: ["Vorlagen/Druck/Standard"] });
    await quick(commands);

    // The copy's layout is the test's own, whose entry is `template`.
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
