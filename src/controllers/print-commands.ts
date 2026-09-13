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
import { buildJob, checkJobLimits, type JobFile } from "../services/print-job";
import {
  checkLayout,
  DESCRIPTOR_FILE,
  FONT_DIRECTORY,
  isFontFile,
  LAYOUT_FILE,
  parseTemplate,
  TEMPLATE_FLAG,
  TEMPLATE_ROOT_DEFAULT,
  type PrintTemplate
} from "../services/print-template";
import {
  captureSize,
  CAPTURE_SCALE,
  MAX_CAPTURE_PX,
  standaloneSvg,
  svgSize
} from "../services/svg-capture";
import { withTimeout } from "../utils/with-timeout";
import {
  canvasExportApi,
  checkExportResult,
  exportErrorCode,
  NO_ENRICH_CLASS
} from "../services/workspace-internals";
import { TypstCompiler } from "../print/typst-compiler";
import { activeLocale } from "../i18n";
import { PrintTemplateModal } from "../ui/print-modals";

/** Pictures a template folder may carry for its own layout to place. */
const TEMPLATE_ASSET = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Which plugin owns which kind of block, for asking it to export its own. */
const DIAGRAM_PLUGINS: Record<string, string> = { vizardry: "vizardry" };

/** How long a drawing may go on settling before it is captured as it stands. */
const SETTLE_MS = 4_000;

/** How long one capture may take. A print must end, even badly. */
const EXPORT_MS = 15_000;

export class PrintCommands {
  private compiler: TypstCompiler | null = null;

  constructor(
    private readonly app: App,
    private readonly settings: () => SchreibstubeSettings,
    private readonly pluginDir: string,
    private readonly pluginVersion: string,
    private readonly logger: Logger
  ) {}

  stop(): void {
    this.compiler?.dispose();
    this.compiler = null;
  }

  /** Every template the vault holds, by folder name. */
  templates(): PrintTemplate[] {
    const root = this.templateRoot();
    const found: PrintTemplate[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.name !== DESCRIPTOR_FILE) continue;
      if (root !== "" && !file.path.startsWith(`${root}/`)) continue;

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
   * Print the note in front of the person.
   *
   * Every refusal says what is missing and stops; nothing half-written is left
   * behind, because the PDF is the last thing that happens.
   */
  async printActiveNote(): Promise<void> {
    const messages = t().print;
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice(t().common.notice(messages.noNote));
      return;
    }

    const templates = this.templates();
    if (templates.length === 0) {
      new Notice(t().common.notice(messages.noTemplates(this.templateRoot())), 8000);
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const named = templateNameOf(frontmatter);
    const chosen =
      templates.find((template) => template.name === named) ??
      (named !== null ? null : await this.ask(templates));

    if (!chosen) {
      if (named !== null) new Notice(t().common.notice(messages.unknownTemplate(named)));
      return;
    }

    const notice = new Notice(t().common.notice(messages.working(chosen.name)), 0);
    try {
      await this.run(file, chosen, (message) => notice.setMessage(t().common.notice(message)));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error("print failed", error);
      new Notice(t().common.notice(messages.failed(detail)), 10_000);
    } finally {
      notice.hide();
    }
  }

  private async run(
    file: TFile,
    template: PrintTemplate,
    progress: (message: string) => void
  ): Promise<void> {
    const messages = t().print;
    const source = await this.app.vault.read(file);

    const layout = await this.readText(`${template.folder}/${LAYOUT_FILE}`);
    if (layout === null) throw new Error(messages.noLayout(template.name));

    const problems = checkLayout(layout);
    if (problems.length > 0) throw new Error(`${template.name}: ${problems.join("; ")}`);

    // Diagrams first: the converter needs to know which of them became a
    // picture before it can decide what to write in their place.
    const conversion = await this.convert(file, template, source, progress);

    const assets = [...conversion.assets, ...(await this.templateAssets(template))];
    const fonts = await this.fonts(template);

    const data = resolvePrintData(
      template,
      this.app.metadataCache.getFileCache(file)?.frontmatter,
      {
        title: noteTitle(source, file.basename),
        noteName: file.basename,
        now: new Date(),
        locale: activeLocale()
      }
    );

    const input = { template, layout, body: conversion.body, data, fonts, assets };
    const limits = checkJobLimits(input);
    if (limits.length > 0) throw new Error(`${template.name}: ${limits.join("; ")}`);

    const outcome = await this.compilerFor().compile(buildJob(input), progress);
    if (!outcome.ok) {
      throw new Error(messages.compilerRefused(outcome.diagnostics.slice(0, 2).join("; ")));
    }

    const path = this.outputPath(file);
    await this.app.vault.adapter.writeBinary(path, toArrayBuffer(outcome.pdf));

    const kilobytes = Math.max(1, Math.round(outcome.pdf.byteLength / 1024));
    new Notice(t().common.notice(messages.done(path, kilobytes)), 8000);
    if (conversion.warnings.length > 0) {
      new Notice(t().common.notice(messages.withWarnings(conversion.warnings.join("; "))), 10_000);
    }
    this.reveal(path);
  }

  /**
   * Markdown to Typst, with the pictures the note needs alongside.
   *
   * Two passes over the same source: the first finds the diagrams so they can
   * be drawn, the second writes the body knowing which drawings exist. The
   * conversion is cheap and doing it twice is simpler than threading a promise
   * through a parser that has no business being asynchronous.
   */
  private async convert(
    file: TFile,
    template: PrintTemplate,
    source: string,
    progress: (message: string) => void
  ): Promise<{ body: string; warnings: string[]; assets: JobFile[] }> {
    const messages = t().print;

    // The first pass only asks what diagrams are there; nothing is resolved,
    // so the answer is the list and nothing else.
    const found = markdownToTypst(source, { hrIsPageBreak: template.hrIsPageBreak }).diagrams;

    const drawings = new Map<number, string[]>();
    const assets = new Map<string, JobFile>();

    for (const block of found) {
      progress(messages.drawing(block.index + 1, found.length));
      const pictures = await this.draw(block, file.path);
      if (pictures.length === 0) continue;

      const paths = pictures.map((bytes, panel) => {
        const path = `assets/diagram-${block.index}-${panel}.png`;
        assets.set(path, { path, bytes });
        return path;
      });
      drawings.set(block.index, paths);
    }

    // The second pass writes the body, knowing which drawings exist. The
    // converter is synchronous, so an embedded picture is named here and read
    // afterwards rather than awaited inside a parser.
    const wanted = new Map<string, TFile>();
    const conversion: Conversion = markdownToTypst(source, {
      hrIsPageBreak: template.hrIsPageBreak,
      diagramImage: (block) => drawings.get(block.index) ?? null,
      image: ({ source: link }) => {
        const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
        if (!target || getImageMimeType(target.extension) === null) return null;
        const path = `assets/${target.path.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
        wanted.set(path, target);
        return path;
      }
    });

    const warnings = [...conversion.warnings];
    for (const [path, target] of wanted) {
      const bytes = await this.picture(target, template);
      if (bytes) assets.set(path, { path, bytes });
      else warnings.push(messages.pictureFailed(target.name));
    }

    // A picture that could not be read leaves a placement pointing at nothing,
    // which the compiler would refuse. Convert once more without it.
    if (wanted.size > 0 && [...wanted.keys()].some((path) => !assets.has(path))) {
      const usable = markdownToTypst(source, {
        hrIsPageBreak: template.hrIsPageBreak,
        diagramImage: (block) => drawings.get(block.index) ?? null,
        image: ({ source: link }) => {
          const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
          if (!target) return null;
          const path = `assets/${target.path.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
          return assets.has(path) ? path : null;
        }
      });
      return { body: usable.body, warnings, assets: [...assets.values()] };
    }

    return { body: conversion.body, warnings, assets: [...assets.values()] };
  }

  /**
   * Draw one diagram and capture it.
   *
   * The block is rendered on its own rather than found in a rendering of the
   * whole note: a note may hold four diagrams from two plugins, and matching
   * them back up by position is a guess. Rendered one at a time there is
   * nothing to match — the container holds one drawing, and that is the one.
   */
  private async draw(block: DiagramBlock, sourcePath: string): Promise<Uint8Array[]> {
    // Three classes, all of them the stylesheet's rather than an inline style,
    // so a theme can see what printing does instead of fighting it: off-screen
    // but laid out, light because paper is, and asking a plugin that enriches
    // its drawing from the network to leave the network out of it.
    const host = document.body.createDiv({
      cls: `schreibstube-print-stage theme-light ${NO_ENRICH_CLASS}`
    });

    const component = new Component();
    try {
      await MarkdownRenderer.render(
        this.app,
        `\`\`\`${block.language}\n${block.source}\n\`\`\``,
        host,
        sourcePath,
        component
      );
      // A plugin that draws asynchronously has had a frame by now; mermaid and
      // the canvases both draw within one. A plugin that needs longer says so
      // itself, below.
      await settle();

      // A canvas its own plugin can export is exported by that plugin: it knows
      // what is drawing and what is a control, which panel of a carousel is
      // hidden, and what its colours mean — all of which from out here is a
      // guess.
      const exported = await this.exportThroughPlugin(block, host);
      if (exported.length > 0) return exported;

      const svg = host.querySelector("svg");
      if (!svg) {
        this.logger.warn(`print: ${block.language} drew nothing to capture`);
        return [];
      }
      const picture = await rasterise(svg);
      return picture ? [picture] : [];
    } catch (error) {
      this.logger.warn(`print: ${block.language} could not be drawn`, error);
      return [];
    } finally {
      component.unload();
      host.detach();
    }
  }

  /**
   * The drawing, from the plugin that drew it.
   *
   * Only for a block whose language names a plugin that offers the export, and
   * only at the contract version this plugin was written against. Anything else
   * falls through to capturing the drawing from the document.
   */
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
  private async exportThroughPlugin(block: DiagramBlock, host: HTMLElement): Promise<Uint8Array[]> {
    const pluginId = DIAGRAM_PLUGINS[block.language];
    if (!pluginId) return [];

    const api = canvasExportApi(this.app, pluginId);
    if (!api) return [];

    let canvases: HTMLElement[];
    try {
      canvases = api.getCanvases(host);
    } catch (error) {
      this.logger.warn(`print: ${pluginId} could not list its canvases`, error);
      return [];
    }

    const pictures: Uint8Array[] = [];
    for (const canvas of canvases) {
      try {
        // The plugin knows when its drawing has stopped moving; this only says
        // how long a print is willing to wait to be told.
        await withTimeout(
          api.whenSettled(canvas, { maxMs: SETTLE_MS }),
          SETTLE_MS + 1_000,
          (seconds) => `${pluginId} kept drawing for more than ${seconds}s`
        );

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
        pictures.push(new Uint8Array(await result.blob.arrayBuffer()));
      } catch (error) {
        this.logger.warn(
          `print: ${pluginId} could not export a canvas (${exportErrorCode(error)})`,
          error
        );
      }
    }
    return pictures;
  }

  private async picture(file: TFile, template: PrintTemplate): Promise<Uint8Array | null> {
    const mimeType = getImageMimeType(file.extension);
    if (mimeType === null) return null;

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

  private async fonts(template: PrintTemplate): Promise<JobFile[]> {
    const folder = this.app.vault.getAbstractFileByPath(`${template.folder}/${FONT_DIRECTORY}`);
    if (!(folder instanceof TFolder)) return [];

    const fonts: JobFile[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || !isFontFile(child.name)) continue;
      const bytes = await this.readBytes(child.path);
      if (bytes) fonts.push({ path: `${FONT_DIRECTORY}/${child.name}`, bytes });
    }
    return fonts;
  }

  /** Pictures the template itself carries, such as the photo on a CV. */
  private async templateAssets(template: PrintTemplate): Promise<JobFile[]> {
    const folder = this.app.vault.getAbstractFileByPath(template.folder);
    if (!(folder instanceof TFolder)) return [];

    const assets: JobFile[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || !TEMPLATE_ASSET.test(child.name)) continue;
      const bytes = await this.readBytes(child.path);
      if (bytes) assets.push({ path: child.name, bytes });
    }
    return assets;
  }

  private compilerFor(): TypstCompiler {
    const messages = t().print;
    this.compiler ??= new TypstCompiler(
      this.app,
      this.pluginDir,
      this.pluginVersion,
      {
        downloading: (label, megabytes) => messages.downloading(label, megabytes),
        verifying: messages.verifying,
        starting: messages.starting,
        compiling: messages.compiling,
        mismatch: (detail) => messages.mismatch(detail),
        unreachable: (detail) => messages.unreachable(detail)
      },
      this.logger
    );
    return this.compiler;
  }

  private ask(templates: PrintTemplate[]): Promise<PrintTemplate | null> {
    return new Promise((resolve) => {
      new PrintTemplateModal(this.app, templates, resolve).open();
    });
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

  private reveal(path: string): void {
    const written = this.app.vault.getAbstractFileByPath(path);
    if (written instanceof TFile) this.logger.debug(`print: wrote ${written.path}`);
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
    const image = await loadImage(url);
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
