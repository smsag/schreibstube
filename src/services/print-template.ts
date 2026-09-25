/**
 * What a print template is, and what one is not allowed to be.
 *
 * A template is a folder in the vault: a descriptor note, a Typst layout, its
 * fonts and its assets. That makes it something a person can copy, edit and
 * share — the same reasoning that put bookmarks in a Markdown file rather than
 * behind a dialog.
 *
 * It is also code, compiled on the device that prints. Everything a descriptor
 * says is therefore validated rather than trusted, and the layout is checked
 * for the two things it must not do: reach outside its folder, and reach for
 * the network. Both refusals name the template and the reason.
 */

import { t } from "../i18n";
import { printableText } from "./typst-value";

/** The frontmatter flag that makes a note a template descriptor. */
export const TEMPLATE_FLAG = "schreibstubePrintTemplate";

export const DESCRIPTOR_FILE = "template.md";
export const LAYOUT_FILE = "template.typ";
export const FONT_DIRECTORY = "fonts";

/** Where templates live unless the settings say otherwise. */
export const TEMPLATE_ROOT_DEFAULT = "Vorlagen/Druck";

/**
 * The limits a job is held to.
 *
 * Every one of them protects the device rather than the file size: a phone
 * compiling a document holds the fonts, the images and the output in memory at
 * once, and a template that asked for a hundred faces would take the app down
 * with it. Raise one deliberately, in the change that needs it.
 */
export const MAX_FONT_FILES = 12;
export const MAX_FONT_BYTES = 8 * 1024 * 1024;
// Raised from 40 when a diagram fence stopped meaning one picture: a canvas
// plugin may hold a carousel, whose panels all go on the page, so a note with
// a few of them reaches numbers a note with a few diagrams never could. The
// byte total below is the bound that actually protects the device; this one
// only keeps a pathological note from building a job table of thousands.
export const MAX_IMAGE_FILES = 120;
export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/**
 * What one captured drawing may weigh.
 *
 * A plugin is asked for a picture no wider than the capture limit, but it is
 * another plugin: it may ignore that and answer with something enormous. Bound
 * per picture rather than only in total, so an oversized one is skipped with a
 * line in the log instead of taking a whole document down when the total is
 * checked later.
 */
export const MAX_DIAGRAM_BYTES = 8 * 1024 * 1024;
export const MAX_LAYOUT_BYTES = 256 * 1024;

/**
 * What one picture in the vault may weigh before it is read at all.
 *
 * It is made smaller for the page, but only after it has been decoded whole,
 * and a phone decoding an image of any size runs out of memory first.
 */
export const MAX_SOURCE_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_PDF_BYTES = 30 * 1024 * 1024;

/** Image bounds a template may narrow but not widen. */
export const IMAGE_MAX_PX_LIMIT = 4000;
export const IMAGE_MAX_PX_DEFAULT = 1600;
export const IMAGE_QUALITY_DEFAULT = 0.85;

export interface PageSetup {
  /** A Typst paper name, lowercase: `a4`, `us-letter`, … */
  size: string;
  /** A margin as Typst writes it, or null to leave it to the layout. */
  margin: string | null;
}

export interface ImageLimits {
  maxPx: number;
  quality: number;
}

export interface PrintTemplate {
  /** The folder's name, which is how a note asks for it. */
  name: string;
  folder: string;
  page: PageSetup;
  hrIsPageBreak: boolean;
  images: ImageLimits;
  /** Defaults for the data a layout reads, overridden by the note. */
  data: Record<string, string>;
  /** The function `main.typ` applies. */
  entry: string;
}

export const DEFAULT_PAGE: PageSetup = { size: "a4", margin: null };
export const DEFAULT_ENTRY = "template";

/**
 * Read a descriptor's frontmatter into a template.
 *
 * Every field is optional and every field is checked: a descriptor is a note a
 * person edits by hand, so a mistyped margin is likely and must produce a
 * message rather than a compile error in generated code.
 */
export function parseTemplate(
  folder: string,
  frontmatter: Readonly<Record<string, unknown>> | null | undefined
): { template: PrintTemplate; problems: string[] } {
  const problems: string[] = [];
  const record = frontmatter ?? {};
  const name = folder.split("/").filter(Boolean).pop() ?? folder;

  const page = { ...DEFAULT_PAGE };
  const pageValue = record.schreibstubePage;
  if (isRecord(pageValue)) {
    const size = str(pageValue.size);
    if (size) {
      if (/^[a-z][a-z0-9-]{1,30}$/.test(size)) page.size = size;
      else problems.push(`page size ${JSON.stringify(size)} is not a paper name`);
    }
    const margin = str(pageValue.margin);
    if (margin) {
      if (isMargin(margin)) page.margin = margin;
      else problems.push(`page margin ${JSON.stringify(margin)} is not one to four lengths`);
    }
  } else if (pageValue !== undefined) {
    problems.push("schreibstubePage must be a map with size and margin");
  }

  const images: ImageLimits = { maxPx: IMAGE_MAX_PX_DEFAULT, quality: IMAGE_QUALITY_DEFAULT };
  const imageValue = record.schreibstubeImages;
  if (isRecord(imageValue)) {
    const maxPx = Number(imageValue.maxPx);
    if (Number.isInteger(maxPx) && maxPx >= 64) images.maxPx = Math.min(maxPx, IMAGE_MAX_PX_LIMIT);
    else if (imageValue.maxPx !== undefined)
      problems.push("images.maxPx must be a whole number of at least 64");

    const quality = Number(imageValue.quality);
    if (Number.isFinite(quality) && quality > 0) {
      // Written as a percentage or as a fraction; both are meant the same way.
      images.quality = quality > 1 ? Math.min(quality, 100) / 100 : quality;
    } else if (imageValue.quality !== undefined) {
      problems.push("images.quality must be a number");
    }
  } else if (imageValue !== undefined) {
    problems.push("schreibstubeImages must be a map with maxPx and quality");
  }

  const data: Record<string, string> = {};
  const dataValue = record.schreibstubeData;
  if (isRecord(dataValue)) {
    for (const [key, value] of Object.entries(dataValue)) {
      const text = printableText(value);
      if (text === null) problems.push(`data.${key} is not a value a template can print`);
      else data[key] = text;
    }
  } else if (dataValue !== undefined) {
    problems.push("schreibstubeData must be a map");
  }

  const entryValue = str(record.schreibstubeEntry);
  let entry = DEFAULT_ENTRY;
  if (entryValue) {
    if (/^[a-z][a-z0-9-]{0,40}$/i.test(entryValue)) entry = entryValue;
    else problems.push(`entry ${JSON.stringify(entryValue)} is not a function name`);
  }

  return {
    template: {
      name,
      folder,
      page,
      hrIsPageBreak: record.schreibstubeHrIsPageBreak === true,
      images,
      data,
      entry
    },
    problems
  };
}

/**
 * What a layout is not allowed to contain.
 *
 * A package import would need the network at print time, and there is none: the
 * compiler runs on the device with the job's own files and nothing else. A path
 * that climbs out of the folder would read a file the person never offered to
 * the template. Both are refused before anything compiles, with the line named,
 * because a template author needs to know which line to fix.
 */
export function checkLayout(source: string): string[] {
  const problems: string[] = [];
  const words = t().print.layout;

  if (new TextEncoder().encode(source).byteLength > MAX_LAYOUT_BYTES) {
    problems.push(words.tooLarge(Math.round(MAX_LAYOUT_BYTES / 1024)));
  }

  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const at = index + 1;
    const code = line.replace(/\/\/.*$/, "");

    // Only a string that names a file is a path. Every string used to be read
    // as one, so a layout that printed "../" as text was refused for it.
    for (const match of code.matchAll(PATH_ARGUMENT)) {
      const value = match[1] ?? "";
      if (/^@(preview|local)\//.test(value)) {
        problems.push(words.package(at));
      } else if (/(^|[/\\])\.\.([/\\]|$)/.test(value)) {
        problems.push(words.leavesFolder(at));
      } else if (value.startsWith("/") && value.length > 1) {
        problems.push(words.absolute(at));
      }
    }
  });

  return [...new Set(problems)];
}

/**
 * A string literal in the place Typst reads a file from: after `import` or
 * `include`, or as the first argument of a function that opens one.
 */
const PATH_ARGUMENT =
  /(?:\b(?:import|include)\s+|\b(?:image|read|json|csv|yaml|toml|xml|cbor|plugin|bibliography)\s*\(\s*)"((?:[^"\\]|\\.)*)"/g;

/** What printing a note should do about which template to use. */
export type TemplateChoice =
  | { kind: "use"; template: PrintTemplate }
  | { kind: "ask"; among: PrintTemplate[] }
  | { kind: "unknown"; name: string };

/**
 * Which template a note gets.
 *
 * A note may name its template by folder name or by folder path. Two templates
 * can share a folder name in different places, which the picker already shows;
 * a name that fits more than one is asked about among those it fits, rather
 * than settled by whichever the vault happened to list first.
 */
export function chooseTemplate(
  templates: readonly PrintTemplate[],
  named: string | null
): TemplateChoice {
  if (named === null) return { kind: "ask", among: [...templates] };

  const path = named.replace(/^\/+|\/+$/g, "");
  const byPath = templates.find((template) => template.folder === path);
  if (byPath) return { kind: "use", template: byPath };

  const byName = templates.filter((template) => template.name === named);
  if (byName.length === 1 && byName[0]) return { kind: "use", template: byName[0] };
  if (byName.length > 1) return { kind: "ask", among: byName };
  return { kind: "unknown", name: named };
}

/** Whether a font file is one Typst can read. */
export function isFontFile(name: string): boolean {
  return /\.(ttf|otf|ttc|otc)$/i.test(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** One to four lengths, as a CSS-shaped margin is written. */
function isMargin(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return (
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((part) => /^-?\d+(\.\d+)?(mm|cm|in|pt|em)$/.test(part))
  );
}
