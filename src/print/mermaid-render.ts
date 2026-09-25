/**
 * Asking Obsidian's Mermaid for a drawing to print.
 *
 * The platform half of `services/print-mermaid.ts`: that module decides what
 * text Mermaid is given; this one loads Mermaid, gives it the text under a
 * deadline, and turns the SVG it answers with into an element that can be
 * measured and captured. Mermaid is Obsidian's, lent through `loadMermaid()`,
 * so a print draws with the same version the note does.
 */
import { printableMermaid } from "../services/print-mermaid";
import { withTimeout } from "../utils/with-timeout";

/** The one call printing needs from the object `loadMermaid()` resolves to. */
export interface MermaidLike {
  render(id: string, text: string, container?: Element): Promise<{ svg: string }>;
}

/**
 * The SVG Mermaid draws for this diagram, as printing asks for it.
 *
 * It draws inside `stage`, the print's off-screen box as wide as a page: a
 * Gantt chart takes its width from where it is drawn, and drawn nowhere it
 * came out zero pixels wide and could not be captured.
 *
 * Mermaid builds the drawing in the document under `id` while it works, and
 * after a syntax error it may leave its error drawing there; either is taken
 * out again, success or not, so a print leaves nothing in the window.
 */
export async function renderMermaidSvg(
  load: () => Promise<MermaidLike>,
  source: string,
  id: string,
  deadlineMs: number,
  stage?: Element
): Promise<string> {
  try {
    const mermaid = await withTimeout(
      load(),
      deadlineMs,
      (seconds) => `mermaid did not load within ${seconds}s`
    );
    const { svg } = await withTimeout(
      mermaid.render(id, printableMermaid(source), stage),
      deadlineMs,
      (seconds) => `mermaid did not draw within ${seconds}s`
    );
    if (typeof svg !== "string" || !svg.includes("<svg")) {
      throw new Error("mermaid answered without a drawing");
    }
    return svg;
  } finally {
    if (typeof document !== "undefined") {
      for (const leftover of [id, `d${id}`, `i${id}`]) document.getElementById(leftover)?.remove();
    }
  }
}

/**
 * The SVG markup as an element, for the stage to measure and capture.
 *
 * Parsed as HTML rather than XML: Mermaid's output is written for a page, and
 * an entity an HTML parser reads without complaint would stop an XML one.
 */
export function svgElementFrom(markup: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const svg = parsed.body.querySelector("svg");
  if (!svg) throw new Error("mermaid's drawing could not be read");
  return document.importNode(svg, true);
}
