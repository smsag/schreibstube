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
 * vault is set to. Both live in `diagram-capture.ts`, where anything else that
 * sends a note out of the app can draw its diagrams the same way.
 */
import { Notice, TFile, TFolder, type App } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import type { SchreibstubeSettings } from "../types";
import { resizeImageToBytes } from "../services/image-resize";
import { markdownToTypst, type Conversion } from "../services/markdown-typst";
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
import { missingPanels } from "../services/svg-capture";
import { toArrayBuffer } from "../utils/array-buffer";
import { TypstCompiler } from "../print/typst-compiler";
import { DiagramCapture } from "./diagram-capture";
import { NO_FORMULAS, type NoteFormulas } from "./sums-controller";
import type { FreezeEntry } from "../services/table-formulas";
import { activeLocale } from "../i18n";
import { describeDiagnostics, RUNTIME_MEGABYTES } from "../services/typst-runtime";
import { PrintExampleModal } from "../ui/print-modals";
import { PrintDialog, type PreparedPrint, type PythiaPrintHost } from "../ui/print-dialog";
import { readPythiaPrintApi } from "../services/workspace-internals";
import {
  checkInspection,
  checkRefresh,
  offersPythia,
  printedSource,
  PYTHIA_REFRESH_DEADLINE_MS,
  type PythiaInspection
} from "../services/pythia-print";
import { withTimeout } from "../utils/with-timeout";
import {
  applyOptions,
  frontmatterRows,
  initialOptions,
  layoutFixesMargin,
  layoutReadsMonospace,
  type PrintOptions
} from "../services/print-options";
import { ConfirmModal, FolderPickerModal } from "../ui/explorer-modals";
import type { ExampleTemplate } from "../services/print-examples";
import { builtinTemplate, copyableExamples } from "../services/print-builtin";
import { modalAnswer } from "../services/modal-answer";
import { pictureEdge } from "../services/print-slideshow";
import { printAssetName, printImageFormat } from "../services/print-images";
import { linkpathCandidates } from "../services/slideshow";
import { missingCapability, readPlatformFeatures } from "../services/print-capability";
import { folderOfPath, missingAncestors } from "../services/ensure-folder";

/** Pictures a template folder may carry for its own layout to place. */
const TEMPLATE_ASSET = /\.(png|jpe?g|gif|webp|svg)$/i;

/**
 * One note on its way to paper: what was read and drawn once, and what each
 * template's files and each picture came to, so that changing a choice in the
 * dialog costs a compile and nothing else.
 */
interface PrintSession {
  file: TFile;
  source: string;
  /** The `(fixed)` results of `source`, written back once a PDF of it exists. */
  freezes: FreezeEntry[];
  drawings: Map<number, string[]>;
  titles: Map<number, string>;
  diagramAssets: Map<string, JobFile>;
  captureWarnings: string[];
  /** How many slideshows the note holds, for the dialog to ask about them. */
  slideshows: number;
  pictures: Map<string, Uint8Array | null>;
  templates: Map<string, TemplateFiles>;
}

interface TemplateFiles {
  layout: string;
  fonts: JobFile[];
  assets: JobFile[];
}

export class PrintCommands {
  private compiler: TypstCompiler | null = null;
  private readonly diagrams: DiagramCapture;
  private formulas: NoteFormulas = NO_FORMULAS;
  /** One print at a time: two would compile against one typesetter and
   *  write over each other's document. */
  private busy = false;

  constructor(
    private readonly app: App,
    private readonly settings: () => SchreibstubeSettings,
    private readonly pluginDir: string,
    private readonly pluginVersion: string,
    private readonly logger: Logger,
    /** Switch printing on, for the one moment somebody is asked whether to. */
    private readonly enable: () => Promise<void>
  ) {
    this.diagrams = new DiagramCapture(app, logger, "print", MAX_DIAGRAM_BYTES);
  }

  /** A note's formulas: resolved in what is typeset, and `(fixed)` ones frozen once it is written. */
  useFormulas(formulas: NoteFormulas): void {
    this.formulas = formulas;
  }

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
    await this.withBusy(() => this.openDialog());
  }

  /**
   * Read the note, draw it, and open the dialog on it. Guarded by the caller:
   * the quick print comes here too when the settings say to ask, and a guard
   * of its own would refuse itself.
   */
  private async openDialog(): Promise<void> {
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

    const pythia = this.inspectPythia(session);
    new PrintDialog(this.app, {
      templates,
      initial: initialOptions(preselected, this.frontmatterOf(file), pythia?.links ?? 0),
      ...(offersPythia(pythia) ? { pythia: this.pythiaHost(session, pythia) } : {}),
      hasSlideshows: session.slideshows > 0,
      fixesMargin: async (template) =>
        layoutFixesMargin((await this.templateFiles(session, template)).layout),
      readsMonospace: async (template) =>
        layoutReadsMonospace((await this.templateFiles(session, template)).layout),
      preview: async (options, progress) => {
        const { job, warnings } = await this.prepareJob(session, options);
        return { pdf: await this.compileJob(job, progress), warnings };
      },
      // The dialog prints after this has returned, and takes the guard again.
      print: (options, ready) => this.startBusy(() => this.printWith(session, options, ready))
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
    await this.withBusy(async () => {
      const file = await this.preflight(() => this.printActiveNoteQuickly());
      if (!file) return;

      const choice = this.choose(file, this.allTemplates());
      if (choice.kind === "unknown") return;
      if (choice.kind === "ask") {
        await this.openDialog();
        return;
      }

      await this.withNotice(t().print.working(choice.template.name), async (progress) => {
        const session = await this.openSession(file, progress);
        // Asked without a dialog, the answer is the dialog's default: Pythia's
        // footnotes whenever the note links to Pythia.
        const links = this.inspectPythia(session)?.links ?? 0;
        const options = initialOptions(choice.template, this.frontmatterOf(file), links);
        await this.printWith(session, options, null, progress);
      });
    });
  }

  private async withBusy(work: () => Promise<void>): Promise<void> {
    if (this.busy) {
      new Notice(t().common.notice(t().print.busy));
      return;
    }
    this.busy = true;
    try {
      await work();
    } finally {
      this.busy = false;
    }
  }

  /** Takes the guard and starts the work, or says why not, at once. */
  private startBusy(work: () => Promise<void>): { accepted: boolean; done: Promise<void> } {
    if (this.busy) {
      new Notice(t().common.notice(t().print.busy));
      return { accepted: false, done: Promise.resolve() };
    }
    this.busy = true;
    const done = work().finally(() => {
      this.busy = false;
    });
    return { accepted: true, done };
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

  private allTemplates(): PrintTemplate[] {
    const builtIn = builtinTemplate();
    return [...this.templates(), ...(builtIn ? [builtIn.template] : [])];
  }

  private frontmatterOf(file: TFile): Record<string, unknown> | undefined {
    return this.app.metadataCache.getFileCache(file)?.frontmatter;
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
      await this.freezePrinted(session);

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
   * What Pythia says about the note: how many passages link to its
   * conversations, and how many of their summaries a refresh could write.
   * Null when Pythia is not there or answers in a shape this does not know —
   * the dialog then looks as it always has. Naming the note lets Pythia keep
   * its own record of which notes link where.
   */
  private inspectPythia(session: PrintSession): PythiaInspection | null {
    const api = readPythiaPrintApi(this.app);
    if (!api) return null;
    try {
      const inspection = checkInspection(api.inspectForExport(session.source, session.file.path));
      if (!inspection) this.logger.warn("print: Pythia answered in a shape this does not know");
      return inspection;
    } catch (error) {
      this.logger.warn("print: Pythia could not read the note", error);
      return null;
    }
  }

  /**
   * The dialog's side of Pythia. The refresh is the one call here that asks a
   * model and so costs money and time: it runs only when the button is
   * pressed, stops when the dialog closes, and gives up after a deadline,
   * telling Pythia to stop starting new work.
   */
  private pythiaHost(session: PrintSession, inspection: PythiaInspection): PythiaPrintHost {
    return {
      inspection,
      inspect: () => this.inspectPythia(session),
      refresh: async (signal, progress) => {
        const api = readPythiaPrintApi(this.app);
        if (!api) throw new Error(t().print.pythiaUnavailable);
        const stop = new AbortController();
        const onAbort = (): void => stop.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          const raw = await withTimeout(
            api.refreshSummaries(session.source, { signal: stop.signal, onProgress: progress }),
            PYTHIA_REFRESH_DEADLINE_MS,
            t().print.pythiaTimeout
          );
          const result = checkRefresh(raw);
          if (!result) throw new Error(t().print.pythiaUnavailable);
          return result;
        } catch (error) {
          stop.abort();
          throw error;
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      }
    };
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
    const exported = await this.formulas.forExport(await this.app.vault.read(file));
    const source = exported.text;
    const session: PrintSession = {
      file,
      source,
      freezes: exported.freezes,
      drawings: new Map(),
      titles: new Map(),
      diagramAssets: new Map(),
      captureWarnings: [],
      slideshows: 0,
      pictures: new Map(),
      templates: new Map()
    };

    // The first pass only asks what diagrams are there; nothing is resolved,
    // so the answer is the list and nothing else.
    const first = markdownToTypst(source);
    session.slideshows = first.slideshows;
    const found = first.diagrams;
    for (const block of found) {
      progress(messages.drawing(block.index + 1, found.length));
      const drawn = await this.diagrams.capture(block, file.path);

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
    const { file } = session;
    const files = await this.templateFiles(session, template);
    // Pythia's copy of the note, with each linked passage's summary as a
    // footnote; the note itself is never changed. Without a usable copy the
    // note prints as it is, and the warnings say the footnotes are missing.
    const printed = printedSource(session.source, options.pythiaFootnotes, () =>
      readPythiaPrintApi(this.app)?.withExportFootnotes(session.source)
    );
    const source = printed.text;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

    // The converter is synchronous, so an embedded picture is named here and
    // read afterwards rather than awaited inside a parser.
    // A picture used twice — a filmstrip's first frame is its stage and a
    // thumbnail — is read once, at the larger of the two sizes.
    const wanted = new Map<string, { target: TFile; edge: number }>();
    const assigned = new Map<string, string>();
    const properties = options.frontmatter ? frontmatterRows(frontmatter) : [];
    const pass = (usable: (path: string) => boolean): Conversion =>
      markdownToTypst(source, {
        hrIsPageBreak: template.hrIsPageBreak,
        properties,
        slideshows: options.slideshows,
        slides: template.slides,
        slideAlign: options.align,
        diagramImage: (block) => session.drawings.get(block.index) ?? null,
        diagramTitle: (block) => session.titles.get(block.index) ?? null,
        image: ({ source: link, width }) => {
          const target = this.resolveImage(link, file.path);
          if (!target) return null;
          const format = printImageFormat(target.extension);
          if (!format) return { refused: messages.imageUnsupported(target.name) };
          // Named for what the bytes will be: Typst reads the extension.
          const path = jobAssetPath(printAssetName(target.path, format), assigned);
          if (!usable(path)) return null;
          const edge = pictureEdge(template.images.maxPx, width ?? 1);
          wanted.set(path, { target, edge: Math.max(edge, wanted.get(path)?.edge ?? 0) });
          return path;
        }
      });

    let conversion = pass(() => true);
    const warnings = [...session.captureWarnings, ...conversion.warnings];
    if (printed.unavailable) warnings.push(messages.pythiaUnavailable);
    const assets = new Map(session.diagramAssets);
    for (const [path, { target, edge }] of wanted) {
      const bytes = await this.cachedPicture(session, target, template, edge);
      if (bytes) assets.set(path, { path, bytes });
      else warnings.push(messages.pictureFailed(target.name));
    }

    // A picture that could not be read leaves a placement pointing at nothing,
    // which the compiler would refuse. Convert once more without it.
    if ([...wanted.keys()].some((path) => !assets.has(path))) {
      conversion = pass((path) => assets.has(path));
    }

    const data = resolvePrintData(template, frontmatter, {
      title: noteTitle(session.source, file.basename),
      noteName: file.basename,
      now: new Date(),
      locale: activeLocale(),
      monospace: options.monospace
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
    template: PrintTemplate,
    edge: number
  ): Promise<Uint8Array | null> {
    const key = `${edge}:${template.images.quality}:${file.path}`;
    if (!session.pictures.has(key)) {
      session.pictures.set(key, await this.picture(file, template, edge));
    }
    return session.pictures.get(key) ?? null;
  }

  /**
   * The vault file a picture's written path names, tried the ways the
   * slideshow on screen tries it: as written, unwrapped from `<…>`, and with
   * its `%20`s decoded, by link and then by path.
   */
  private resolveImage(link: string, sourcePath: string): TFile | null {
    for (const candidate of linkpathCandidates(link)) {
      const file =
        this.app.metadataCache.getFirstLinkpathDest(candidate, sourcePath) ??
        this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) return file;
    }
    return null;
  }

  /**
   * The PDF is written: each `(fixed)` total is written into the note at what
   * the PDF says — the note as the dialog read it, not as it is now. The
   * session is frozen once: a second print of it would find nothing to match.
   * A failed write leaves the totals live and says so; the PDF is there
   * either way.
   */
  private async freezePrinted(session: PrintSession): Promise<void> {
    const { file, freezes } = session;
    session.freezes = [];
    try {
      await this.formulas.freeze(file, freezes);
    } catch (error) {
      this.logger.debug(`print: could not freeze the totals in ${file.path}`, error);
      new Notice(t().common.notice(t().sums.freezeFailed(file.path)));
    }
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

    await this.makeFolder(folderOfPath(path));
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
      const answer = modalAnswer<boolean>(resolve);
      const modal = new ConfirmModal(this.app, options, () => answer.choose(true));
      const close = modal.onClose.bind(modal);
      modal.onClose = () => {
        close();
        answer.closed(false);
      };
      modal.open();
    });
  }

  private async picture(
    file: TFile,
    template: PrintTemplate,
    edge: number
  ): Promise<Uint8Array | null> {
    const format = printImageFormat(file.extension);
    if (format === null) return null;
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
      // An SVG is drawn by Typst itself, as lines, at any size.
      if (format.kind === "vector") return new Uint8Array(buffer);
      const resized = await resizeImageToBytes(
        buffer,
        format.sourceType,
        Math.min(edge, template.images.maxPx),
        template.images.quality,
        format.outputType
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
    const exists = (folder: string): boolean =>
      this.app.vault.getAbstractFileByPath(folder) !== null;
    for (const folder of missingAncestors(path, exists)) {
      await this.app.vault.createFolder(folder);
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
      new PrintExampleModal(this.app, copyableExamples(), resolve).open();
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
      const answer = modalAnswer<string | null>(resolve);
      const modal = new FolderPickerModal(this.app, folders, t().print.chooseFolder, (folder) =>
        answer.choose(folder)
      );
      const close = modal.onClose.bind(modal);
      modal.onClose = () => {
        close();
        answer.closed(null);
      };
      modal.open();
    });
  }

  /** Open what was just written, since the prose in it is the instructions. */
  private async openDescriptor(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
  }

  runtimeInstalled(): Promise<boolean> {
    return this.compilerFor().isInstalled();
  }

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

  /**
   * A file's text, or null when it cannot be read. Null is an answer the
   * callers word themselves — a layout missing, a font left out — and the
   * cause goes to the log, where "no template.typ" and "permission denied"
   * are two different things.
   */
  private async readText(path: string): Promise<string | null> {
    try {
      return await this.app.vault.adapter.read(path);
    } catch (error) {
      this.logger.debug(`print: ${path} could not be read`, error);
      return null;
    }
  }

  private async readBytes(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await this.app.vault.adapter.readBinary(path));
    } catch (error) {
      this.logger.debug(`print: ${path} could not be read`, error);
      return null;
    }
  }
}
