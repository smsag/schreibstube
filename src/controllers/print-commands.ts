/**
 * Printing a note: what has to happen in the vault, in order.
 *
 * The decisions are elsewhere and tested — what a template is, what Markdown
 * becomes, which bytes the compiler may be. This is the wiring: read the
 * files, draw the diagrams, hand a job over, write the result where a person
 * will look for it.
 *
 * Two things happen here that could happen nowhere else. Diagrams are drawn by
 * Obsidian and by other plugins, so they are rendered off-screen and captured
 * as pictures — the only step of a print that needs a document. And the light
 * theme is forced while that happens, because paper is white whatever the
 * vault is set to.
 */
import { Component, MarkdownRenderer, Notice, TFile, TFolder, type App } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";
import { getImageMimeType, resizeImageToBytes } from "../services/image-resize";
import { markdownToTypst, type Conversion, type DiagramBlock } from "../services/markdown-typst";
import { noteTitle, resolvePrintData, templateNameOf } from "../services/print-data";
import {
  buildJob,
  checkFontBudget,
  checkJobLimits,
  checkPdfSize,
  checkPictureBudget,
  isTypesetPdf,
  jobAssetPath,
  type JobFile,
  type PrintJob
} from "../services/print-job";
import {
  checkLayout,
  chooseTemplate,
  DESCRIPTOR_FILE,
  FONT_DIRECTORY,
  isFontFile,
  LAYOUT_FILE,
  MAX_DIAGRAM_BYTES,
  MAX_PDF_BYTES,
  MAX_SOURCE_IMAGE_BYTES,
  parseTemplate,
  TEMPLATE_FLAG,
  TEMPLATE_ROOT_DEFAULT,
  type PrintTemplate,
  type TemplateChoice
} from "../services/print-template";
import {
  captureSize,
  CAPTURE_SCALE,
  MAX_CAPTURE_PX,
  missingPanels,
  standaloneSvg,
  svgSize
} from "../services/svg-capture";
import { toArrayBuffer } from "../utils/array-buffer";
import { withTimeout } from "../utils/with-timeout";
import {
  canvasExportApi,
  checkExportResult,
  exportErrorCode,
  isElementLike,
  noEnrichClass,
  type CanvasExportApi
} from "../services/workspace-internals";
import { TypstCompiler } from "../print/typst-compiler";
import { activeLocale } from "../i18n";
import { describeDiagnostics, RUNTIME_MEGABYTES } from "../services/typst-runtime";
import { PrintExampleModal } from "../ui/print-modals";
import { PrintDialog, type PreparedPrint } from "../ui/print-dialog";
import {
  applyOptions,
  frontmatterRows,
  initialOptions,
  layoutFixesMargin,
  type PrintOptions
} from "../services/print-options";
import { ConfirmModal, FolderPickerModal } from "../ui/explorer-modals";
import { EXAMPLE_TEMPLATES, type ExampleTemplate } from "../services/print-examples";
import { builtinTemplate } from "../services/print-builtin";
import { missingCapability, readPlatformFeatures } from "../services/print-capability";

/** Pictures a template folder may carry for its own layout to place. */
const TEMPLATE_ASSET = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Which plugin owns which kind of block, for asking it to export its own. */
const DIAGRAM_PLUGINS: Record<string, string> = { vizardry: "vizardry" };

/**
 * What one fence's drawings came to.
 *
 * The count matters as much as the pictures: a fence whose panels partly failed
 * would otherwise print the survivors and say nothing, and a page that is
 * quietly missing a panel is a page that lies about what the note holds.
 */
interface Capture {
  pictures: Uint8Array[];
  /** How many drawings the fence had, whether or not each was captured. */
  expected: number;
  /** What the plugin calls the drawing, for a fence with no heading over it. */
  title: string;
}

/**
 * One note on its way to paper: what was read and drawn once, and what each
 * template's files and each picture came to, so that changing a choice in the
 * dialog costs a compile and nothing else.
 */
interface PrintSession {
  file: TFile;
  source: string;
  drawings: Map<number, string[]>;
  titles: Map<number, string>;
  diagramAssets: Map<string, JobFile>;
  captureWarnings: string[];
  pictures: Map<string, Uint8Array | null>;
  templates: Map<string, TemplateFiles>;
}

interface TemplateFiles {
  layout: string;
  fonts: JobFile[];
  assets: JobFile[];
}

/** How long a drawing may go on settling before it is captured as it stands. */
const SETTLE_MS = 4_000;

/** How long one capture may take. A print must end, even badly. */
const EXPORT_MS = 15_000;

/**
 * How long a fence may take to render before it is given up on.
 *
 * Rendering runs another plugin's code, and one that never settles would hold
 * the print — and its notice, which stays until the print ends — for ever.
 */
const RENDER_MS = 20_000;

/** How long a drawing may take to read back as a picture. */
const DECODE_MS = 10_000;

export class PrintCommands {
  private compiler: TypstCompiler | null = null;

  constructor(
    private readonly app: App,
    private readonly settings: () => SchreibstubeSettings,
    private readonly pluginDir: string,
    private readonly pluginVersion: string,
    private readonly logger: Logger,
    /** Switch printing on, for the one moment somebody is asked whether to. */
    private readonly enable: () => Promise<void>
  ) {}

  stop(): void {
    this.compiler?.dispose();
    this.compiler = null;
  }

  /**
   * Every template the vault holds, by folder name.
   *
   * The whole vault, not the templates folder. What makes a folder a template
   * is the flag in its descriptor, which is a thing a person set on purpose;
   * where they keep it is their business, and somebody who puts a template
   * beside the notes that use it is not making a mistake. The setting names
   * where a new one goes by default, not where one is allowed to be — a folder
   * a person chose and a plugin then could not see would be the worse surprise.
   */
  templates(): PrintTemplate[] {
    const found: PrintTemplate[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.name !== DESCRIPTOR_FILE) continue;

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter?.[TEMPLATE_FLAG] !== true) continue;

      const folder = file.parent?.path ?? "";
      const { template, problems } = parseTemplate(folder, frontmatter);
      if (problems.length > 0) {
        this.logger.warn(`print: ${template.name} — ${problems.join("; ")}`);
      }
      found.push(template);
    }

    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Print the note in front of the person, through the print dialog.
   *
   * The note is read and its diagrams drawn once, before the dialog opens;
   * every choice made in it after that only rebuilds and recompiles the job,
   * which is the cheap part. The document the preview shows is the one that is
   * written, when nothing changed since it was set.
   */
  async printActiveNote(): Promise<void> {
    const file = await this.preflight(() => this.printActiveNote());
    if (!file) return;

    const templates = this.allTemplates();
    const choice = this.choose(file, templates);
    // In the dialog, a template that cannot be settled is simply preselected:
    // the selector is right there, and the note's own request was reported.
    const preselected =
      choice.kind === "use"
        ? choice.template
        : choice.kind === "ask"
          ? choice.among[0]
          : this.defaultOrFirst(templates);
    if (!preselected) return;

    const session = await this.withNotice(t().print.preparing, (progress) =>
      this.openSession(file, progress)
    );
    if (!session) return;

    new PrintDialog(this.app, {
      templates,
      initial: initialOptions(preselected),
      fixesMargin: async (template) =>
        layoutFixesMargin((await this.templateFiles(session, template)).layout),
      preview: async (options, progress) => {
        const { job, warnings } = await this.prepareJob(session, options);
        return { pdf: await this.compileJob(job, progress), warnings };
      },
      print: (options, ready) => this.printWith(session, options, ready)
    }).open();
  }

  /**
   * Print the note in front of the person, without asking anything.
   *
   * The template the note or the settings choose, as that template sets the
   * page. For somebody who prints the same note again and again and has
   * nothing to decide; a default of "ask every time" opens the dialog instead,
   * because that is what the setting says.
   */
  async printActiveNoteQuickly(): Promise<void> {
    const file = await this.preflight(() => this.printActiveNoteQuickly());
    if (!file) return;

    const choice = this.choose(file, this.allTemplates());
    if (choice.kind === "unknown") return;
    if (choice.kind === "ask") {
      await this.printActiveNote();
      return;
    }

    const options = initialOptions(choice.template);
    await this.withNotice(t().print.working(choice.template.name), async (progress) => {
      const session = await this.openSession(file, progress);
      await this.printWith(session, options, null, progress);
    });
  }

  /**
   * What stands between the command and a print: a device that can typeset,
   * printing switched on, and a note in front of the person. Answers the note,
   * or null when one of them said no and has already said why.
   */
  private async preflight(again: () => Promise<void>): Promise<TFile | null> {
    const messages = t().print;

    // Asked before anything else, because a device that cannot run the
    // typesetter cannot print however the rest of it is set up.
    const missing = missingCapability(readPlatformFeatures(window));
    if (missing) {
      this.logger.warn(`print: this platform has no ${missing}`);
      new Notice(t().common.notice(messages.unsupported), 10_000);
      return null;
    }

    // The command stays in the palette when printing is off, and says so when
    // it is run. A command that vanishes because of a setting in another tab
    // reads as a plugin that broke; this is the moment somebody is listening.
    if (!this.settings().printEnabled) {
      new ConfirmModal(
        this.app,
        {
          title: messages.offTitle,
          message: messages.offMessage(RUNTIME_MEGABYTES),
          submitLabel: messages.offSubmit
        },
        () => {
          void this.enable()
            .then(again)
            .catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              this.logger.error("print: printing could not be switched on", error);
              new Notice(t().common.notice(messages.failed(detail)), 10_000);
            });
        }
      ).open();
      return null;
    }

    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice(t().common.notice(messages.noNote));
      return null;
    }
    return file;
  }

  /** The vault's templates and the built-in one, which is always there. */
  private allTemplates(): PrintTemplate[] {
    const builtIn = builtinTemplate();
    return [...this.templates(), ...(builtIn ? [builtIn.template] : [])];
  }

  /** The template the note or the settings ask for, with anything amiss said aloud. */
  private choose(file: TFile, templates: PrintTemplate[]): TemplateChoice {
    const messages = t().print;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const choice = chooseTemplate(
      templates,
      templateNameOf(frontmatter),
      this.settings().printDefaultTemplate
    );
    if (choice.kind === "unknown") {
      new Notice(t().common.notice(messages.unknownTemplate(choice.name)));
    }
    if (choice.kind === "ask" && choice.missingDefault !== undefined) {
      new Notice(t().common.notice(messages.defaultMissing(choice.missingDefault)), 8000);
    }
    return choice;
  }

  private defaultOrFirst(templates: PrintTemplate[]): PrintTemplate | undefined {
    const choice = chooseTemplate(templates, null, this.settings().printDefaultTemplate);
    return choice.kind === "use" ? choice.template : templates[0];
  }

  /**
   * Run a step under a notice that says what is happening, and say what went
   * wrong if it fails. Answers the step's result, or null after a failure.
   */
  private async withNotice<T>(
    message: string,
    step: (progress: (message: string) => void) => Promise<T>
  ): Promise<T | null> {
    const notice = new Notice(t().common.notice(message), 0);
    try {
      return await step((next) => notice.setMessage(t().common.notice(next)));
    } catch (error) {
      this.report(error);
      return null;
    } finally {
      notice.hide();
    }
  }

  private report(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error("print failed", error);
    new Notice(t().common.notice(t().print.failed(detail)), 10_000);
  }

  /**
   * Compile with these choices, unless the dialog already did, and write it.
   *
   * `ready` is the preview's document when it was set with exactly these
   * choices; setting it again would only cost the wait.
   */
  private async printWith(
    session: PrintSession,
    options: PrintOptions,
    ready: PreparedPrint | null,
    progress: (message: string) => void = () => {}
  ): Promise<void> {
    const messages = t().print;
    try {
      let prepared = ready;
      if (!prepared) {
        const { job, warnings } = await this.prepareJob(session, options);
        prepared = { pdf: await this.compileJob(job, progress), warnings };
      }

      const path = this.outputPath(session.file);
      if (!(await this.write(path, prepared.pdf))) {
        new Notice(t().common.notice(messages.notReplaced(path)), 8000);
        return;
      }
      this.logger.debug(`print: wrote ${path}`);

      const kilobytes = Math.max(1, Math.round(prepared.pdf.byteLength / 1024));
      new Notice(t().common.notice(messages.done(path, kilobytes)), 8000);
      if (prepared.warnings.length > 0) {
        new Notice(t().common.notice(messages.withWarnings(prepared.warnings.join("; "))), 10_000);
      }
    } catch (error) {
      this.report(error);
    }
  }

  /**
   * Everything about the note that does not depend on how it is printed:
   * its text, and its diagrams, drawn and captured once.
   */
  private async openSession(
    file: TFile,
    progress: (message: string) => void
  ): Promise<PrintSession> {
    const messages = t().print;
    const source = await this.app.vault.read(file);
    const session: PrintSession = {
      file,
      source,
      drawings: new Map(),
      titles: new Map(),
      diagramAssets: new Map(),
      captureWarnings: [],
      pictures: new Map(),
      templates: new Map()
    };

    // The first pass only asks what diagrams are there; nothing is resolved,
    // so the answer is the list and nothing else.
    const found = markdownToTypst(source).diagrams;
    for (const block of found) {
      progress(messages.drawing(block.index + 1, found.length));
      const drawn = await this.draw(block, file.path);

      // A fence that drew four panels and captured three prints three. Saying
      // so is the whole point: the reader of the PDF cannot tell.
      const missing = missingPanels(drawn.expected, drawn.pictures.length);
      if (missing > 0) {
        session.captureWarnings.push(messages.panelsLost(block.index + 1, missing, drawn.expected));
      }
      if (drawn.pictures.length === 0) continue;

      const paths = drawn.pictures.map((bytes, panel) => {
        const path = `assets/diagram-${block.index}-${panel}.png`;
        session.diagramAssets.set(path, { path, bytes });
        return path;
      });
      session.drawings.set(block.index, paths);
      if (drawn.title !== "") session.titles.set(block.index, drawn.title);
    }
    return session;
  }

  /** A template's layout, fonts and pictures, read and checked once per session. */
  private async templateFiles(
    session: PrintSession,
    template: PrintTemplate
  ): Promise<TemplateFiles> {
    const known = session.templates.get(template.folder);
    if (known) return known;

    const messages = t().print;
    const layout = template.builtIn
      ? (builtinTemplate()?.layout ?? null)
      : await this.readText(`${template.folder}/${LAYOUT_FILE}`);
    if (layout === null) throw new Error(messages.noLayout(template.name));

    const problems = checkLayout(layout);
    if (problems.length > 0) throw new Error(`${template.name}: ${problems.join("; ")}`);

    const files = {
      layout,
      fonts: await this.fonts(template),
      assets: await this.templateAssets(template)
    };
    session.templates.set(template.folder, files);
    return files;
  }

  /**
   * The job these choices make: the body converted with them, the note's
   * pictures at the template's size, and the template's own files.
   */
  private async prepareJob(
    session: PrintSession,
    options: PrintOptions
  ): Promise<{ job: PrintJob; warnings: string[] }> {
    const messages = t().print;
    const template = applyOptions(options);
    const { file, source } = session;
    const files = await this.templateFiles(session, template);
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

    // The converter is synchronous, so an embedded picture is named here and
    // read afterwards rather than awaited inside a parser.
    const wanted = new Map<string, TFile>();
    const assigned = new Map<string, string>();
    const properties = options.frontmatter ? frontmatterRows(frontmatter) : [];
    const pass = (usable: (path: string) => boolean): Conversion =>
      markdownToTypst(source, {
        hrIsPageBreak: template.hrIsPageBreak,
        properties,
        diagramImage: (block) => session.drawings.get(block.index) ?? null,
        diagramTitle: (block) => session.titles.get(block.index) ?? null,
        image: ({ source: link }) => {
          const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
          if (!target || getImageMimeType(target.extension) === null) return null;
          const path = jobAssetPath(target.path, assigned);
          if (!usable(path)) return null;
          wanted.set(path, target);
          return path;
        }
      });

    let conversion = pass(() => true);
    const warnings = [...session.captureWarnings, ...conversion.warnings];
    const assets = new Map(session.diagramAssets);
    for (const [path, target] of wanted) {
      const bytes = await this.cachedPicture(session, target, template);
      if (bytes) assets.set(path, { path, bytes });
      else warnings.push(messages.pictureFailed(target.name));
    }

    // A picture that could not be read leaves a placement pointing at nothing,
    // which the compiler would refuse. Convert once more without it.
    if ([...wanted.keys()].some((path) => !assets.has(path))) {
      conversion = pass((path) => assets.has(path));
    }

    const data = resolvePrintData(template, frontmatter, {
      title: noteTitle(source, file.basename),
      noteName: file.basename,
      now: new Date(),
      locale: activeLocale()
    });

    const input = {
      template,
      layout: files.layout,
      body: conversion.body,
      data,
      fonts: files.fonts,
      assets: [...assets.values(), ...files.assets]
    };
    const limits = checkJobLimits(input);
    if (limits.length > 0) throw new Error(`${template.name}: ${limits.join("; ")}`);
    return { job: buildJob(input), warnings };
  }

  /** A note's picture at a template's size, read and resized once per session. */
  private async cachedPicture(
    session: PrintSession,
    file: TFile,
    template: PrintTemplate
  ): Promise<Uint8Array | null> {
    const key = `${template.images.maxPx}:${template.images.quality}:${file.path}`;
    if (!session.pictures.has(key)) session.pictures.set(key, await this.picture(file, template));
    return session.pictures.get(key) ?? null;
  }

  private async compileJob(
    job: PrintJob,
    progress: (message: string) => void
  ): Promise<Uint8Array> {
    const messages = t().print;
    const outcome = await this.compilerFor().compile(job, progress);
    if (!outcome.ok) {
      throw new Error(messages.compilerRefused(describeDiagnostics(outcome.diagnostics)));
    }
    const tooLarge = checkPdfSize(outcome.pdf.byteLength);
    if (tooLarge !== null) throw new Error(tooLarge);
    return outcome.pdf;
  }

  /**
   * Put the document in the vault, through the vault.
   *
   * Through the vault rather than its adapter, so the file is in the index —
   * and on a phone in the file list — the moment it is written, and a missing
   * output folder is made first. An existing PDF is replaced without a word
   * only when Typst made it, which is to say when it is an earlier print; any
   * other file of that name is somebody's, and is asked about.
   *
   * Answers whether the document was written.
   */
  private async write(path: string, pdf: Uint8Array): Promise<boolean> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      if (!(await this.mayReplace(existing))) return false;
      await this.app.vault.modifyBinary(existing, toArrayBuffer(pdf));
      return true;
    }
    if (existing) throw new Error(t().print.outputIsFolder(path));

    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder) await this.makeFolder(folder);
    await this.app.vault.createBinary(path, toArrayBuffer(pdf));
    return true;
  }

  private async mayReplace(file: TFile): Promise<boolean> {
    if (file.stat.size <= MAX_PDF_BYTES) {
      const bytes = await this.readBytes(file.path);
      if (bytes && isTypesetPdf(bytes)) return true;
    }
    const messages = t().print;
    return this.confirm({
      title: messages.replaceTitle,
      message: messages.replaceMessage(file.path),
      submitLabel: messages.replaceSubmit
    });
  }

  /** A yes-or-no question that also answers when it is dismissed. */
  private confirm(options: {
    title: string;
    message: string;
    submitLabel: string;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      let answered = false;
      const modal = new ConfirmModal(this.app, options, () => {
        answered = true;
        resolve(true);
      });
      const close = modal.onClose.bind(modal);
      modal.onClose = () => {
        close();
        if (!answered) resolve(false);
      };
      modal.open();
    });
  }

  /**
   * Draw one diagram and capture it.
   *
   * The block is rendered on its own rather than found in a rendering of the
   * whole note: a note may hold four diagrams from two plugins, and matching
   * them back up by position is a guess. Rendered one at a time there is
   * nothing to match — the container holds one drawing, and that is the one.
   */
  private async draw(block: DiagramBlock, sourcePath: string): Promise<Capture> {
    // The plugin is found before the container is made, not after: the class
    // that asks it to leave the network alone only works if it is in place
    // before the drawing renders, and by export time those calls have gone.
    const pluginId = DIAGRAM_PLUGINS[block.language] ?? "";
    const api = pluginId ? canvasExportApi(this.app, pluginId) : null;

    // Three classes, all of them the stylesheet's rather than an inline style,
    // so a theme can see what printing does instead of fighting it: off-screen
    // but laid out, light because paper is, and offline because a print is.
    const host = document.body.createDiv({
      cls: `schreibstube-print-stage theme-light ${noEnrichClass(api)}`
    });

    const component = new Component();
    try {
      await withTimeout(
        MarkdownRenderer.render(
          this.app,
          `\`\`\`${block.language}\n${block.source}\n\`\`\``,
          host,
          sourcePath,
          component
        ).then(settle),
        RENDER_MS,
        (seconds) => `${block.language} did not finish drawing within ${seconds}s`
      );
      // A plugin that draws asynchronously has had a frame by now; mermaid and
      // the canvases both draw within one. A plugin that needs longer says so
      // itself, below.

      // A canvas its own plugin can export is exported by that plugin: it knows
      // what is drawing and what is a control, which panel of a carousel is
      // hidden, and what its colours mean — all of which from out here is a
      // guess.
      const exported = api
        ? await this.exportThroughPlugin(pluginId, api, host)
        : { pictures: [], expected: 0, title: "" };
      if (exported.expected > 0) return exported;

      const svg = host.querySelector("svg");
      if (!svg) {
        this.logger.warn(`print: ${block.language} drew nothing to capture`);
        return { pictures: [], expected: 0, title: "" };
      }
      const picture = await rasterise(svg);
      return picture
        ? { pictures: [picture], expected: 1, title: "" }
        : { pictures: [], expected: 1, title: "" };
    } catch (error) {
      this.logger.warn(`print: ${block.language} could not be drawn`, error);
      return { pictures: [], expected: 0, title: "" };
    } finally {
      component.unload();
      host.detach();
    }
  }

  /**
   * Every canvas of one fence, exported by the plugin that drew it.
   *
   * The plugin finds its own canvases rather than this reaching for the first
   * child: a fence may hold a carousel, whose other panels are hidden on screen
   * and would silently be left out of a document — which is the worst thing a
   * print can do, because nothing in the page says a panel is missing.
   *
   * A canvas that fails is skipped, never fatal. The fence it belongs to then
   * prints as its source, which the converter already arranges, and the reason
   * goes to the log by the code the contract rejects with.
   */
  private async exportThroughPlugin(
    pluginId: string,
    api: CanvasExportApi,
    host: HTMLElement
  ): Promise<Capture> {
    let canvases: HTMLElement[];
    try {
      const answer: unknown = api.getCanvases(host);
      // Guarded against throwing and against answering something that cannot be
      // walked: a bare `for…of` over a non-array would throw out of this method
      // and past the fallback that captures the drawing from the document.
      if (!Array.isArray(answer)) {
        this.logger.warn(`print: ${pluginId} did not answer with a list of canvases`);
        return { pictures: [], expected: 0, title: "" };
      }
      canvases = answer.filter(isElementLike);
    } catch (error) {
      this.logger.warn(`print: ${pluginId} could not list its canvases`, error);
      return { pictures: [], expected: 0, title: "" };
    }

    const pictures: Uint8Array[] = [];
    // The first drawing that names itself names the fence. A carousel's panels
    // are one figure on the page, so one caption is what there is room for.
    let title = "";
    for (const canvas of canvases) {
      try {
        // The plugin knows when its drawing has stopped moving; this only says
        // how long a print is willing to wait to be told. Waiting too long is
        // not a reason to lose the drawing — it is captured as it stands, which
        // is what the deadline is for.
        try {
          await withTimeout(
            api.whenSettled(canvas, { maxMs: SETTLE_MS }),
            SETTLE_MS + 1_000,
            (seconds) => `${pluginId} kept drawing for more than ${seconds}s`
          );
        } catch (error) {
          this.logger.warn(`print: ${pluginId} was still drawing; capturing as it stands`, error);
        }

        const answer = await withTimeout(
          api.exportCanvas(canvas, {
            format: "png",
            scale: CAPTURE_SCALE,
            maxEdge: MAX_CAPTURE_PX,
            light: true,
            background: "#ffffff",
            header: false
          }),
          EXPORT_MS,
          (seconds) => `${pluginId} took more than ${seconds}s over one canvas`
        );

        const result = checkExportResult(answer);
        if (!result) {
          this.logger.warn(`print: ${pluginId} answered in a shape this version cannot read`);
          continue;
        }
        // Bounded before it is read, not after: a plugin that ignored the edge
        // it was given would otherwise be materialised in full, and one
        // oversized drawing would take the whole document down with it.
        if (result.blob.size > MAX_DIAGRAM_BYTES) {
          this.logger.warn(
            `print: ${pluginId} returned ${Math.round(result.blob.size / 1024)} KB for one canvas, over the limit`
          );
          continue;
        }
        if (title === "") title = result.title;
        pictures.push(new Uint8Array(await result.blob.arrayBuffer()));
      } catch (error) {
        this.logger.warn(
          `print: ${pluginId} could not export a canvas (${exportErrorCode(error)})`,
          error
        );
      }
    }
    return { pictures, expected: canvases.length, title };
  }

  private async picture(file: TFile, template: PrintTemplate): Promise<Uint8Array | null> {
    const mimeType = getImageMimeType(file.extension);
    if (mimeType === null) return null;
    // Bounded before it is read: the picture is made smaller only after it is
    // decoded, and decoding a photograph of any size first is how a phone
    // runs out of memory halfway through a print.
    if (file.stat.size > MAX_SOURCE_IMAGE_BYTES) {
      this.logger.warn(
        `print: ${file.path} is ${Math.round(file.stat.size / 1048576)} MB, over the limit`
      );
      return null;
    }

    try {
      const buffer = await this.app.vault.readBinary(file);
      const resized = await resizeImageToBytes(
        buffer,
        mimeType,
        template.images.maxPx,
        template.images.quality
      );
      return resized.bytes;
    } catch (error) {
      this.logger.warn(`print: ${file.path} could not be read`, error);
      return null;
    }
  }

  /**
   * The template's typefaces.
   *
   * Their sizes are held to the budget as the vault reports them, before any
   * is read, so a folder with a whole family in it is refused rather than
   * loaded in full and refused afterwards.
   */
  private async fonts(template: PrintTemplate): Promise<JobFile[]> {
    if (template.builtIn) return [];
    const files = this.filesIn(`${template.folder}/${FONT_DIRECTORY}`, isFontFile);
    const problems = checkFontBudget(files.map((file) => file.stat.size));
    if (problems.length > 0) throw new Error(`${template.name}: ${problems.join("; ")}`);
    return this.readAll(files, (file) => `${FONT_DIRECTORY}/${file.name}`);
  }

  /** Pictures the template itself carries, such as the photo on a CV. */
  private async templateAssets(template: PrintTemplate): Promise<JobFile[]> {
    if (template.builtIn) return [];
    const files = this.filesIn(template.folder, (name) => TEMPLATE_ASSET.test(name));
    const problems = checkPictureBudget(files.map((file) => file.stat.size));
    if (problems.length > 0) throw new Error(`${template.name}: ${problems.join("; ")}`);
    return this.readAll(files, (file) => file.name);
  }

  private filesIn(path: string, wanted: (name: string) => boolean): TFile[] {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) return [];
    return folder.children.filter(
      (child): child is TFile => child instanceof TFile && wanted(child.name)
    );
  }

  private async readAll(files: TFile[], pathOf: (file: TFile) => string): Promise<JobFile[]> {
    const read: JobFile[] = [];
    for (const file of files) {
      const bytes = await this.readBytes(file.path);
      if (bytes) read.push({ path: pathOf(file), bytes });
    }
    return read;
  }

  /**
   * Put a template in the vault, without leaving the app to find one.
   *
   * The examples live in the repository, which is fine on a laptop and no use
   * at all on a phone: there is no way to fetch a folder from a web page and
   * drop it into a vault. So the plugin carries them, and this lays one down
   * wherever a person says — any folder, not only the configured root, because
   * somebody keeping templates beside the notes that use them is not wrong.
   *
   * Nothing here needs the typesetter, so it works whether or not printing has
   * been switched on: reading what a template is made of is a good way to
   * decide whether to switch it on at all.
   */
  async addTemplate(): Promise<void> {
    const messages = t().print;

    const example = await this.askExample();
    if (!example) return;

    const folder = await this.askFolder();
    if (folder === null) return;

    const target = folder.length > 0 ? `${folder}/${example.name}` : example.name;
    const adapter = this.app.vault.adapter;

    if (await adapter.exists(target)) {
      new Notice(t().common.notice(messages.templateExists(target)), 8000);
      return;
    }

    try {
      await this.makeFolder(target);
      for (const file of example.files) {
        await this.app.vault.create(`${target}/${file.name}`, file.text);
      }
      // The fonts folder is made empty and on purpose: it is where a person
      // puts a typeface, and an empty folder says that better than prose does.
      await this.makeFolder(`${target}/${FONT_DIRECTORY}`);

      new Notice(t().common.notice(messages.templateAdded(target)), 10_000);
      await this.openDescriptor(`${target}/${DESCRIPTOR_FILE}`);
    } catch (error) {
      // A template half written is worse than none: the descriptor alone still
      // announces itself as a template, so every print of it fails and adding
      // it again is refused because the folder is there. Take it back out.
      await this.discard(target);
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error("print: a template could not be added", error);
      new Notice(t().common.notice(messages.failed(detail)), 10_000);
    }
  }

  /**
   * Make a folder and whatever it sits in.
   *
   * The first template goes into a folder that does not exist yet — the
   * default answer names one nobody has made — and creating a folder whose
   * parent is missing is not something to rely on being forgiven.
   */
  private async makeFolder(path: string): Promise<void> {
    const parts = path.split("/").filter((part) => part.length > 0);
    let walked = "";
    for (const part of parts) {
      walked = walked.length > 0 ? `${walked}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(walked))) {
        await this.app.vault.createFolder(walked);
      }
    }
  }

  /** Undo a template that was only partly written. */
  private async discard(path: string): Promise<void> {
    try {
      const folder = this.app.vault.getAbstractFileByPath(path);
      if (folder instanceof TFolder) await this.app.vault.delete(folder, true);
    } catch (error) {
      this.logger.warn(`print: ${path} was left behind after a failed add`, error);
    }
  }

  private askExample(): Promise<ExampleTemplate | null> {
    return new Promise((resolve) => {
      new PrintExampleModal(this.app, EXAMPLE_TEMPLATES, resolve).open();
    });
  }

  /**
   * Which folder to put it in.
   *
   * Every folder in the vault, the configured templates root first so that the
   * ordinary answer is the first one offered. The root itself is offered too,
   * for a vault that keeps everything flat.
   */
  private askFolder(): Promise<string | null> {
    const root = this.templateRoot();
    const all = this.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path)
      .filter((path) => path !== "/");

    const folders = [root, ...all.filter((path) => path !== root), ""];

    return new Promise((resolve) => {
      let answered = false;
      const modal = new FolderPickerModal(this.app, folders, t().print.chooseFolder, (folder) => {
        answered = true;
        resolve(folder);
      });
      const close = modal.onClose.bind(modal);
      modal.onClose = () => {
        close();
        if (!answered) resolve(null);
      };
      modal.open();
    });
  }

  /** Open what was just written, since the prose in it is the instructions. */
  private async openDescriptor(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
  }

  /** Whether this device already has the typesetter, for the settings tab. */
  runtimeInstalled(): Promise<boolean> {
    return this.compilerFor().isInstalled();
  }

  /** Fetch it now, reporting progress the way a print does. */
  async fetchRuntime(): Promise<void> {
    const messages = t().print;
    const missing = missingCapability(readPlatformFeatures(window));
    if (missing) {
      this.logger.warn(`print: this platform has no ${missing}`);
      new Notice(t().common.notice(messages.unsupported), 10_000);
      return;
    }

    const notice = new Notice(t().common.notice(messages.verifying), 0);
    try {
      await this.compilerFor().prepare((message) => notice.setMessage(t().common.notice(message)));
      new Notice(t().common.notice(messages.runtimeReady), 6000);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error("print: the typesetter could not be fetched", error);
      new Notice(t().common.notice(messages.failed(detail)), 10_000);
    } finally {
      notice.hide();
    }
  }

  /** Take it off the device again, for somebody reclaiming the space. */
  async removeRuntime(): Promise<void> {
    await this.compilerFor().remove();
    this.compiler = null;
    new Notice(t().common.notice(t().print.runtimeRemoved), 6000);
  }

  private compilerFor(): TypstCompiler {
    const messages = t().print;
    this.compiler ??= new TypstCompiler(
      this.app,
      this.pluginDir,
      this.pluginVersion,
      {
        downloading: (label, megabytes) => messages.downloading(label, megabytes),
        downloadingFont: (face) => messages.downloadingFont(face),
        verifying: messages.verifying,
        starting: messages.starting,
        compiling: messages.compiling,
        compilingLong: (seconds) => messages.compilingLong(seconds),
        compileTimeout: (seconds) => messages.compileTimeout(seconds),
        mismatch: (detail) => messages.mismatch(detail),
        unreachable: (detail) => messages.unreachable(detail),
        timeout: (seconds) => messages.timeout(seconds)
      },
      this.logger
    );
    return this.compiler;
  }

  private templateRoot(): string {
    return (this.settings().printTemplateRoot || TEMPLATE_ROOT_DEFAULT).replace(/^\/+|\/+$/g, "");
  }

  private outputPath(file: TFile): string {
    const folder = this.settings().printOutputFolder.replace(/^\/+|\/+$/g, "");
    const base = `${file.basename}.pdf`;
    if (folder) return `${folder}/${base}`;
    return file.parent && file.parent.path !== "/" ? `${file.parent.path}/${base}` : base;
  }

  private async readText(path: string): Promise<string | null> {
    try {
      return await this.app.vault.adapter.read(path);
    } catch {
      return null;
    }
  }

  private async readBytes(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await this.app.vault.adapter.readBinary(path));
    } catch {
      return null;
    }
  }
}

/**
 * Draw an SVG into a canvas and take the bytes.
 *
 * The markup is made standalone first: detached from the document it has no
 * stylesheet, no namespace declaration it can rely on, and no size.
 */
async function rasterise(svg: SVGElement): Promise<Uint8Array | null> {
  const box = svg.getBoundingClientRect();
  const markup = new XMLSerializer().serializeToString(svg);
  const size = svgSize(markup, { width: box.width, height: box.height });
  if (!size) return null;

  const target = captureSize(size);
  const standalone = standaloneSvg(markup, target);
  const url = URL.createObjectURL(new Blob([standalone], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = await withTimeout(
      loadImage(url),
      DECODE_MS,
      (seconds) => `the drawing did not read back within ${seconds}s`
    );
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;

    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the drawing could not be read back"));
    image.src = url;
  });
}

/** Two frames: one for the plugin to draw, one for the browser to lay it out. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}
