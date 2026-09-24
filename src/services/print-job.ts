/**
 * The files a compile is given, and the one file that ties them together.
 *
 * A job is a tiny file system: the template's layout and fonts, the note's
 * pictures, the prelude, and a generated `main.typ` that applies one to the
 * other. The compiler sees nothing else — no vault, no disk, no network —
 * which is what makes a template's reach exactly the folder it lives in.
 */
import { t } from "../i18n";
import { PRELUDE_FILE, PRELUDE_SOURCE } from "./print-prelude";
import { typstDictionary } from "./typst-value";
import {
  LAYOUT_FILE,
  MAX_FONT_BYTES,
  MAX_FONT_FILES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_FILES,
  MAX_PDF_BYTES,
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
    // The prelude first and the whole layout after it: a helper the template
    // defines shadows the default of the same name, which is how a template
    // restyles a callout. Importing only the entry left the prelude's version
    // in force whatever the template said.
    `#import ${JSON.stringify(PRELUDE_FILE)}: *\n` +
    `#import ${JSON.stringify(LAYOUT_FILE)}: *\n` +
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
  return [
    ...checkFontBudget(input.fonts.map((file) => file.bytes.byteLength)),
    ...checkPictureBudget(input.assets.map((file) => file.bytes.byteLength))
  ];
}

/**
 * Whether fonts of these sizes fit the job.
 *
 * Asked once with the sizes the vault reports, before a byte is read — a
 * folder holding a whole type family would otherwise be in memory in full by
 * the time the total was checked — and once more on the job itself.
 */
export function checkFontBudget(sizes: readonly number[]): string[] {
  const problems: string[] = [];
  const words = t().print.limits;
  if (sizes.length > MAX_FONT_FILES) problems.push(words.fontFiles(sizes.length, MAX_FONT_FILES));
  const bytes = sum(sizes);
  if (bytes > MAX_FONT_BYTES) {
    problems.push(words.fontBytes(megabytes(bytes), megabytes(MAX_FONT_BYTES)));
  }
  return problems;
}

/** The same for pictures: the template's own before they are read, then all of them. */
export function checkPictureBudget(sizes: readonly number[]): string[] {
  const problems: string[] = [];
  const words = t().print.limits;
  if (sizes.length > MAX_IMAGE_FILES) {
    problems.push(words.pictureFiles(sizes.length, MAX_IMAGE_FILES));
  }
  const bytes = sum(sizes);
  if (bytes > MAX_IMAGE_BYTES) {
    problems.push(words.pictureBytes(megabytes(bytes), megabytes(MAX_IMAGE_BYTES)));
  }
  return problems;
}

/** Whether a finished document may be written, or what is wrong with it. */
export function checkPdfSize(bytes: number): string | null {
  return bytes > MAX_PDF_BYTES
    ? t().print.limits.pdfBytes(megabytes(bytes), megabytes(MAX_PDF_BYTES))
    : null;
}

/**
 * Where a vault picture goes inside the job.
 *
 * Named after its vault path, with anything a job path should not hold made a
 * dash — which maps `a b.png` and `a-b.png` to the same name, and printed one
 * of them twice. So a name already given to another picture gets a number, and
 * the same picture asked for twice keeps the name it was given first.
 */
export function jobAssetPath(vaultPath: string, assigned: Map<string, string>): string {
  const known = assigned.get(vaultPath);
  if (known !== undefined) return known;

  const flat = vaultPath.replace(/[^A-Za-z0-9._-]+/g, "-");
  const taken = new Set(assigned.values());
  const dot = flat.lastIndexOf(".");
  const stem = dot > 0 ? flat.slice(0, dot) : flat;
  const extension = dot > 0 ? flat.slice(dot) : "";

  let path = `assets/${flat}`;
  for (let n = 2; taken.has(path); n += 1) path = `assets/${stem}-${n}${extension}`;
  assigned.set(vaultPath, path);
  return path;
}

/**
 * Whether a PDF already in the vault is one a print wrote.
 *
 * Printing writes `Note.pdf` beside the note, and a vault often already has a
 * file of that name that is nobody's print — a scan, a download, the signed
 * copy. One Typst made is taken to be an earlier print and replaced; anything
 * else is asked about first. Typst names itself as the creator in the
 * document's information and in its XMP, both uncompressed.
 */
export function isTypesetPdf(bytes: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(bytes);
  return /\/Creator\s*\(Typst[ )]|<xmp:CreatorTool>Typst[ <]/.test(text);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
