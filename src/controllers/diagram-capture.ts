/**
 * Drawing a diagram fence off-screen and taking it as pictures.
 *
 * Mermaid and the canvas plugins draw into a document, and nothing that leaves
 * the app — a PDF, a mail, a published page — can run them. So each fence is
 * drawn here, by whoever draws it, and captured as PNG bytes that the caller
 * places however its medium places a picture.
 *
 * What can be decided about a drawing without a browser is decided in
 * `services/svg-capture.ts`; what a canvas plugin's answer may be is checked in
 * `services/workspace-internals.ts`. This is the wiring between them.
 */
import { Component, loadMermaid, MarkdownRenderer, type App } from "obsidian";
import { renderMermaidSvg, svgElementFrom, type MermaidLike } from "../print/mermaid-render";
import type { Logger } from "../services/logger";
import type { DiagramBlock } from "../services/markdown-typst";
import { mermaidRenderId } from "../services/print-mermaid";
import {
  captureSize,
  CAPTURE_SCALE,
  MAX_CAPTURE_PX,
  standaloneSvg,
  svgSize
} from "../services/svg-capture";
import {
  canvasExportApi,
  checkExportResult,
  exportErrorCode,
  isElementLike,
  noEnrichClass,
  type CanvasExportApi
} from "../services/workspace-internals";
import { withTimeout } from "../utils/with-timeout";

/** Which plugin owns which kind of block, for asking it to export its own. */
const DIAGRAM_PLUGINS: Record<string, string> = { vizardry: "vizardry" };

/**
 * What one fence's drawings came to.
 *
 * The count matters as much as the pictures: a fence whose panels partly failed
 * would otherwise print the survivors and say nothing, and a page that is
 * quietly missing a panel is a page that lies about what the note holds.
 */
export interface Capture {
  pictures: Uint8Array[];
  /** How many drawings the fence had, whether or not each was captured. */
  expected: number;
  /** What the plugin calls the drawing, for a fence with no heading over it. */
  title: string;
}

/** How long a drawing may go on settling before it is captured as it stands. */
const SETTLE_MS = 4_000;

/** How long one capture may take. A print or a send must end, even badly. */
const EXPORT_MS = 15_000;

/**
 * How long a fence may take to render before it is given up on.
 *
 * Rendering runs another plugin's code, and one that never settles would hold
 * the print or the send — and its notice, which stays until it ends — for ever.
 */
const RENDER_MS = 20_000;

/** How long a drawing may take to read back as a picture. */
const DECODE_MS = 10_000;

/** What a fence is drawn from: its language, its text, and where it stands. */
export type DiagramSource = Pick<DiagramBlock, "index" | "language" | "source">;

export class DiagramCapture {
  constructor(
    private readonly app: App,
    private readonly logger: Logger,
    /** What the log lines are prefixed with: the feature the drawing is for. */
    private readonly scope: string,
    /** The largest picture of one canvas the caller's medium will carry. */
    private readonly maxBytes: number
  ) {}

  /**
   * Draw one diagram and capture it.
   *
   * The block is rendered on its own rather than found in a rendering of the
   * whole note: a note may hold four diagrams from two plugins, and matching
   * them back up by position is a guess. Rendered one at a time there is
   * nothing to match — the container holds one drawing, and that is the one.
   */
  async capture(block: DiagramSource, sourcePath: string): Promise<Capture> {
    // The plugin is found before the container is made, not after: the class
    // that asks it to leave the network alone only works if it is in place
    // before the drawing renders, and by export time those calls have gone.
    const pluginId = DIAGRAM_PLUGINS[block.language] ?? "";
    const api = pluginId ? canvasExportApi(this.app, pluginId) : null;

    // Three classes, all of them the stylesheet's rather than an inline style,
    // so a theme can see what capturing does instead of fighting it: off-screen
    // but laid out, light because paper and a mail are, and offline because
    // what is sent must not depend on a network call made on the way. The
    // stage keeps the name it had when printing was its only use, because a
    // theme that styles it has no other name to find it by.
    const host = document.body.createDiv({
      cls: `schreibstube-print-stage theme-light ${noEnrichClass(api)}`
    });

    const component = new Component();
    try {
      // Mermaid is asked for a drawing of its own rather than captured from
      // the one in the note: that one's labels are HTML, which a canvas cannot
      // export, and its colours are the app's. See services/print-mermaid.ts.
      if (block.language === "mermaid") {
        const markup = await renderMermaidSvg(
          loadMermaid as () => Promise<MermaidLike>,
          block.source,
          mermaidRenderId(block.index, Date.now()),
          RENDER_MS,
          host
        );
        const drawn = host.appendChild(svgElementFrom(markup));
        const picture = await rasterise(drawn);
        return picture
          ? { pictures: [picture], expected: 1, title: "" }
          : { pictures: [], expected: 1, title: "" };
      }

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
      // A plugin that draws asynchronously has had a frame by now; the
      // canvases draw within one. A plugin that needs longer says so itself,
      // below.

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
        this.logger.warn(`${this.scope}: ${block.language} drew nothing to capture`);
        return { pictures: [], expected: 0, title: "" };
      }
      const picture = await rasterise(svg);
      return picture
        ? { pictures: [picture], expected: 1, title: "" }
        : { pictures: [], expected: 1, title: "" };
    } catch (error) {
      this.logger.warn(`${this.scope}: ${block.language} could not be drawn`, error);
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
        this.logger.warn(`${this.scope}: ${pluginId} did not answer with a list of canvases`);
        return { pictures: [], expected: 0, title: "" };
      }
      canvases = answer.filter(isElementLike);
    } catch (error) {
      this.logger.warn(`${this.scope}: ${pluginId} could not list its canvases`, error);
      return { pictures: [], expected: 0, title: "" };
    }

    const pictures: Uint8Array[] = [];
    // The first drawing that names itself names the fence. A carousel's panels
    // are one figure on the page, so one caption is what there is room for.
    let title = "";
    for (const canvas of canvases) {
      try {
        // The plugin knows when its drawing has stopped moving; this only says
        // how long a capture is willing to wait to be told. Waiting too long is
        // not a reason to lose the drawing — it is captured as it stands, which
        // is what the deadline is for.
        try {
          await withTimeout(
            api.whenSettled(canvas, { maxMs: SETTLE_MS }),
            SETTLE_MS + 1_000,
            (seconds) => `${pluginId} kept drawing for more than ${seconds}s`
          );
        } catch (error) {
          this.logger.warn(
            `${this.scope}: ${pluginId} was still drawing; capturing as it stands`,
            error
          );
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
          this.logger.warn(
            `${this.scope}: ${pluginId} answered in a shape this version cannot read`
          );
          continue;
        }
        // Bounded before it is read, not after: a plugin that ignored the edge
        // it was given would otherwise be materialised in full, and one
        // oversized drawing would take the whole document down with it.
        if (result.blob.size > this.maxBytes) {
          this.logger.warn(
            `${this.scope}: ${pluginId} returned ${Math.round(result.blob.size / 1024)} KB for one canvas, over the limit`
          );
          continue;
        }
        if (title === "") title = result.title;
        pictures.push(new Uint8Array(await result.blob.arrayBuffer()));
      } catch (error) {
        this.logger.warn(
          `${this.scope}: ${pluginId} could not export a canvas (${exportErrorCode(error)})`,
          error
        );
      }
    }
    return { pictures, expected: canvases.length, title };
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
