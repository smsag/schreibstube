/**
 * What the print dialog lets a person change, and what each choice means.
 *
 * Nine choices, and nothing about them is remembered: each print starts from
 * the template and the note, because that is where a page's design lives and
 * a dialog that carried yesterday's margins into today's letter would be a
 * second, invisible template.
 */
import { NOTE_DATA_KEY } from "./print-data";
import { printableText } from "./typst-value";
import type { PrintTemplate } from "./print-template";
import type { SlideshowPrintMode } from "./print-slideshow";
import { SLIDE_ALIGNS, type SlideAlign } from "./print-slides";

/** The formats a deck is printed in, and the Typst paper each one is. */
export type SlideFormat = "16:9" | "4:3";

export const SLIDE_FORMATS: readonly SlideFormat[] = ["16:9", "4:3"];

export const SLIDE_PAPER: Readonly<Record<SlideFormat, string>> = {
  "16:9": "presentation-16-9",
  "4:3": "presentation-4-3"
};

/** "standard" is the template's own margin; the other two replace it. */
export type MarginPreset = "small" | "standard" | "wide";

export const MARGIN_PRESETS: readonly MarginPreset[] = ["small", "standard", "wide"];

/** The margins the two non-standard presets set, on every side. */
export const PRESET_MARGINS: Readonly<Record<Exclude<MarginPreset, "standard">, string>> = {
  small: "15mm",
  wide: "35mm"
};

export interface PrintOptions {
  template: PrintTemplate;
  margin: MarginPreset;
  hrIsPageBreak: boolean;
  /** Whether the note's properties are printed at the top of the document. */
  frontmatter: boolean;
  /** Slideshows as they stand on screen, or every picture stacked. */
  slideshows: SlideshowPrintMode;
  /** The page of a deck. Only a slide template reads it. */
  format: SlideFormat;
  /** Where a deck's content stands across the slide: centred, or at the left. */
  align: SlideAlign;
  /**
   * The text in the monospaced face, or in the sans. Reaches the layout as
   * `data.monospace`; a template that does not read it is unaffected, and the
   * dialog offers the choice only for one that does.
   */
  monospace: boolean;
  /**
   * Pythia's summaries as footnotes: each passage the note links to one of
   * Pythia's conversations prints with that conversation's summary under it.
   * Offered only when Pythia is there and the note has such a link.
   */
  pythiaFootnotes: boolean;
}

/**
 * Where a print starts: the template as it is, no properties on paper, the
 * text in the face the note asks for — monospaced unless it says otherwise —
 * and Pythia's footnotes whenever the note links to Pythia at all: a link
 * whose meaning is left off the paper is the thing the footnotes exist for.
 */
export function initialOptions(
  template: PrintTemplate,
  frontmatter?: Readonly<Record<string, unknown>> | null,
  pythiaLinks = 0
): PrintOptions {
  return {
    template,
    margin: "standard",
    hrIsPageBreak: template.hrIsPageBreak,
    frontmatter: false,
    slideshows: "layout",
    format: noteSlideFormat(frontmatter) ?? templateSlideFormat(template),
    align: noteSlideAlign(frontmatter) ?? "center",
    monospace: noteMonospace(frontmatter) ?? true,
    pythiaFootnotes: pythiaLinks > 0
  };
}

/**
 * What a note says about its text face in `schreibstubePrint.monospace`, or
 * null when it says nothing readable. `false`, `no` and `off` turn it off;
 * `true`, `yes` and `on` keep it; anything else is not an answer.
 */
export function noteMonospace(
  frontmatter: Readonly<Record<string, unknown>> | null | undefined
): boolean | null {
  const data = frontmatter?.[NOTE_DATA_KEY];
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const text = printableText((data as Record<string, unknown>).monospace)
    ?.trim()
    .toLowerCase();
  if (text === "false" || text === "no" || text === "off") return false;
  if (text === "true" || text === "yes" || text === "on") return true;
  return null;
}

/**
 * The format a note asks its deck to be printed in, as
 * `schreibstubePrint.format`: `16:9` or `4:3`, or null for anything else.
 */
export function noteSlideFormat(
  frontmatter: Readonly<Record<string, unknown>> | null | undefined
): SlideFormat | null {
  const text = noteValue(frontmatter, "format");
  return SLIDE_FORMATS.find((format) => format === text) ?? null;
}

/**
 * Where a note asks its slides' content to stand, as
 * `schreibstubePrint.align`: `center` or `left`, or null for anything else.
 */
export function noteSlideAlign(
  frontmatter: Readonly<Record<string, unknown>> | null | undefined
): SlideAlign | null {
  const text = noteValue(frontmatter, "align")?.toLowerCase();
  return SLIDE_ALIGNS.find((align) => align === text) ?? null;
}

/** One of the note's `schreibstubePrint` values as text, trimmed, or null. */
function noteValue(
  frontmatter: Readonly<Record<string, unknown>> | null | undefined,
  key: string
): string | null {
  const data = frontmatter?.[NOTE_DATA_KEY];
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return printableText((data as Record<string, unknown>)[key])?.trim() ?? null;
}

/** The format a template's own paper is, 16:9 when it is neither. */
function templateSlideFormat(template: PrintTemplate): SlideFormat {
  return SLIDE_FORMATS.find((format) => SLIDE_PAPER[format] === template.page.size) ?? "16:9";
}

/**
 * Whether a layout reads the text-face choice, so the dialog should offer it.
 * Read from the source, like the margins below; comments do not count.
 */
export function layoutReadsMonospace(layout: string): boolean {
  return /\bdata\.monospace\b/.test(layout.replace(/\/\/.*$/gm, ""));
}

/**
 * The same choices for another template, whose own page-break habit then
 * applies. The format and the alignment stay: they were the note's or the
 * person's, not the template's.
 */
export function withTemplate(options: PrintOptions, template: PrintTemplate): PrintOptions {
  return { ...options, template, hrIsPageBreak: template.hrIsPageBreak };
}

/**
 * The template as this print sets it: the margin the preset names, the
 * page-break rule the dialog chose, and for a deck the format's paper. The
 * template itself is left untouched.
 */
export function applyOptions(options: PrintOptions): PrintTemplate {
  const { template } = options;
  const margin =
    options.margin === "standard" ? template.page.margin : PRESET_MARGINS[options.margin];
  const size = template.slides ? SLIDE_PAPER[options.format] : template.page.size;
  return { ...template, page: { size, margin }, hrIsPageBreak: options.hrIsPageBreak };
}

/**
 * Whether a layout sets its own margins, which then win over any preset.
 *
 * A letter to DIN 5008 puts the address where a window envelope shows it, and
 * that is a margin it states itself, inside its function; a preset set before
 * the layout runs cannot and should not move it. The dialog greys the choice
 * out for such a template rather than offer one that does nothing. Read from
 * the source, so it can be wrong for a layout that hides its page rule behind
 * a variable — in which case the preview shows the truth.
 */
export function layoutFixesMargin(layout: string): boolean {
  const code = layout.replace(/\/\/.*$/gm, "");
  return (
    /\bset\s+page\s*\([^)]*\bmargin\s*:/.test(code) || /\bpage\.with\([^)]*\bmargin\s*:/.test(code)
  );
}

/**
 * A note's properties as rows a page can show: key and value, in the note's
 * order.
 *
 * The plugin's own keys are left out — they are instructions to the printer,
 * not part of the document — and so is anything with nothing to show. A list
 * reads as a list on one line, and a link as the name it points at.
 */
export function frontmatterRows(
  frontmatter: Readonly<Record<string, unknown>> | null | undefined
): [string, string][] {
  const rows: [string, string][] = [];
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (/^schreibstube/i.test(key) || key === "position") continue;
    const parts = (Array.isArray(value) ? value : [value]).map(printableText);
    if (parts.some((part) => part === null)) continue;
    const text = (parts as string[])
      .map((part) =>
        part.replace(
          /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g,
          (_all, target: string, alias?: string) => alias || target
        )
      )
      .join(", ")
      .trim();
    if (text !== "") rows.push([key, text]);
  }
  return rows;
}
