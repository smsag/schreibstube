/**
 * The files a compile is given, and the one file that ties them together.
 *
 * A job is a tiny file system: the template's layout and fonts, the note's
 * pictures, the prelude, and a generated `main.typ` that applies one to the
 * other. The compiler sees nothing else — no vault, no disk, no network —
 * which is what makes a template's reach exactly the folder it lives in.
 */
import { PRELUDE_FILE, PRELUDE_SOURCE } from "./print-prelude";
import { typstDictionary } from "./typst-value";
import {
  LAYOUT_FILE,
  MAX_FONT_BYTES,
  MAX_FONT_FILES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_FILES,
  type PrintTemplate
} from "./print-template";

export const MAIN_FILE = "main.typ";

/** A file inside the job, addressed the way the layout addresses it. */
export interface JobFile {
  path: string;
  bytes: Uint8Array;
}

export interface PrintJob {
  /** `main.typ`, the only source the compiler is pointed at. */
  main: string;
  /** Everything else, including the layout, the prelude, fonts and pictures. */
  files: JobFile[];
  /** Font files, handed to the compiler separately from the file system. */
  fonts: Uint8Array[];
}

export interface JobInput {
  template: PrintTemplate;
  layout: string;
  /** Typst markup for the note, from the converter. */
  body: string;
  data: Record<string, string>;
  fonts: JobFile[];
  assets: JobFile[];
}

/**
 * Assemble the job.
 *
 * `main.typ` is deliberately dull: it imports, it applies, it places the body.
 * Everything expressive is in the template, and everything uncertain — the
 * data — crosses as string literals rather than as source.
 */
export function buildJob(input: JobInput): PrintJob {
  const { template } = input;
  const page = pageRule(template);

  const main =
    `// Generated for this print. Edit the template, not this file.\n` +
    `#import ${JSON.stringify(LAYOUT_FILE)}: ${template.entry}\n` +
    `#import ${JSON.stringify(PRELUDE_FILE)}: *\n` +
    `\n` +
    `#let data = ${typstDictionary(input.data)}\n` +
    (page ? `${page}\n` : "") +
    `\n` +
    `#show: body => ${template.entry}(body, data)\n` +
    `\n` +
    input.body;

  return {
    main,
    files: [
      { path: LAYOUT_FILE, bytes: encode(input.layout) },
      { path: PRELUDE_FILE, bytes: encode(PRELUDE_SOURCE) },
      ...input.assets
    ],
    fonts: input.fonts.map((font) => font.bytes)
  };
}

/**
 * The page, when the descriptor stated one.
 *
 * Set before the layout runs, so a layout that says nothing about paper still
 * gets the size the descriptor asked for, and one that does say overrides it.
 */
function pageRule(template: PrintTemplate): string | null {
  const parts = [`paper: ${JSON.stringify(template.page.size)}`];
  if (template.page.margin !== null) parts.push(`margin: ${marginValue(template.page.margin)}`);
  return `#set page(${parts.join(", ")})`;
}

/** One length, or the two to four a CSS-shaped margin names. */
function marginValue(margin: string): string {
  const parts = margin.trim().split(/\s+/);
  const [top, right, bottom, left] = parts;
  if (parts.length === 1) return top ?? "0pt";
  if (parts.length === 2) return `(y: ${top}, x: ${right})`;
  if (parts.length === 3) return `(top: ${top}, x: ${right}, bottom: ${bottom})`;
  return `(top: ${top}, right: ${right}, bottom: ${bottom}, left: ${left})`;
}

/**
 * Whether the job is within the limits, in the words a person can act on.
 *
 * Checked once, here, rather than by whoever assembled each part: the limits
 * are about what the device can hold at one moment, and only the whole job
 * knows that.
 */
export function checkJobLimits(input: JobInput): string[] {
  const problems: string[] = [];

  if (input.fonts.length > MAX_FONT_FILES) {
    problems.push(`${input.fonts.length} font files, at most ${MAX_FONT_FILES} are used`);
  }
  const fontBytes = total(input.fonts);
  if (fontBytes > MAX_FONT_BYTES) {
    problems.push(
      `fonts total ${megabytes(fontBytes)} MB, at most ${megabytes(MAX_FONT_BYTES)} MB are used`
    );
  }
  if (input.assets.length > MAX_IMAGE_FILES) {
    problems.push(`${input.assets.length} pictures, at most ${MAX_IMAGE_FILES} are used`);
  }
  const assetBytes = total(input.assets);
  if (assetBytes > MAX_IMAGE_BYTES) {
    problems.push(
      `pictures total ${megabytes(assetBytes)} MB, at most ${megabytes(MAX_IMAGE_BYTES)} MB are used`
    );
  }

  return problems;
}

function total(files: readonly JobFile[]): number {
  return files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
}

function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
