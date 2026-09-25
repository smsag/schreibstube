/**
 * What the print dialog lets a person change, and what each choice means.
 *
 * Four choices, and nothing about them is remembered: each print starts from
 * the template, because the template is where a page's design lives and a
 * dialog that carried yesterday's margins into today's letter would be a
 * second, invisible template.
 */
import { printableText } from "./typst-value";
import type { PrintTemplate } from "./print-template";

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
}

/** Where a print starts: the template as it is, and no properties on paper. */
export function initialOptions(template: PrintTemplate): PrintOptions {
  return {
    template,
    margin: "standard",
    hrIsPageBreak: template.hrIsPageBreak,
    frontmatter: false
  };
}

/** The same choices for another template, whose own page-break habit then applies. */
export function withTemplate(options: PrintOptions, template: PrintTemplate): PrintOptions {
  return { ...options, template, hrIsPageBreak: template.hrIsPageBreak };
}

/**
 * The template as this print sets it: the margin the preset names, and the
 * page-break rule the dialog chose. The template itself is left untouched.
 */
export function applyOptions(options: PrintOptions): PrintTemplate {
  const { template } = options;
  const margin =
    options.margin === "standard" ? template.page.margin : PRESET_MARGINS[options.margin];
  return { ...template, page: { ...template.page, margin }, hrIsPageBreak: options.hrIsPageBreak };
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
