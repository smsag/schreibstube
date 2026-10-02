/**
 * Markdown as the vault writes it, turned into Typst as a template compiles it.
 * PRINTING.md says why it is hand-written and what it carries over.
 */
import { t } from "../i18n";
import { parseImageAlt } from "./image-alt";
import { fencedLines, fenceMarker } from "./markdown-fence";
import { isTableDelimiter, rowCells } from "./markdown-table";
import { typstArray, typstString } from "./typst-value";
import { BLOCK_REPORT_LABEL } from "./print-breaks";
import { parseSlideshow, SLIDESHOW_LANGUAGE } from "./slideshow";
import { slideshowForPrint, type SlideshowPrintMode } from "./print-slideshow";
import {
  groupSlides,
  markSlideDirectives,
  readDirective,
  slidesMarkup,
  type SlideAlign,
  type SlidePart
} from "./print-slides";

/** What a tab is worth when a list's nesting is measured, as in the editor. */
const TAB_COLUMNS = 4;

/** A CSS pixel is 1/96 inch, a point 1/72: what the screen draws at 300 px prints at 225 pt. */
function cssPixelsToPoints(pixels: number): number {
  return Math.round(pixels * 0.75 * 100) / 100;
}

/** A fenced block a drawing plugin owns, in the order the note holds them. */
export interface DiagramBlock {
  /** Position among the diagrams of this note, which is how a capture is keyed. */
  index: number;
  /** The fence's info string: `mermaid`, `vizardry`, … */
  language: string;
  source: string;
  /** The nearest heading above it, offered to the template as a caption. */
  caption: string;
}

/** An image the note embeds, resolved by the caller to a path inside the job. */
export interface ImageRequest {
  /** `![alt](src)` or the target of `![[src]]`. */
  source: string;
  alt: string;
  /**
   * The share of the text width the picture takes on the page, when it is
   * less than all of it — a slideshow's tile — so it is read no larger than
   * it prints.
   */
  width?: number;
}

export interface ConvertOptions {
  /** A horizontal rule becomes a page break rather than a line. */
  hrIsPageBreak?: boolean;
  /**
   * The text is a passage of a note rather than the whole of one: a `---` at
   * its start is a rule, not the note's properties.
   */
  passage?: boolean;
  /**
   * The whole note a passage was taken from, read for its footnotes and
   * reference links after the passage's own: a footnote is defined anywhere
   * in a note, and a passage that uses one defined further down would print
   * it empty. Nothing else of it is printed.
   */
  definitionsFrom?: string;
  /**
   * Mark where each top-level block starts, and report it once the pages are
   * set, so the print dialog can read a click on its preview as a block. The
   * marks set nothing; see `print-breaks.ts`. Never in a deck.
   */
  blockMarkers?: boolean;
  /**
   * Top-level blocks, by the index the marks give them, that begin a new page:
   * the breaks a person set by pointing at the preview. Never in a deck.
   */
  breaksBefore?: readonly number[];
  /**
   * Where the captured picture of a diagram lives inside the job, or null when
   * the capture failed. A diagram without a picture prints as its own source
   * in a code block, with a warning, because a silently missing diagram is a
   * page that lies about what the note says.
   */
  diagramImage?: (block: DiagramBlock) => readonly string[] | null;
  /** What the plugin that drew it calls it, when it has a name for it. */
  diagramTitle?: (block: DiagramBlock) => string | null;
  /** The same for an embedded image: a path inside the job, or null. */
  image?: (request: ImageRequest) => string | null | ImageRefusal;
  /**
   * The note's properties, as key and value, to be printed at the top: after
   * the first heading when the note opens with one, so a title stays first.
   */
  properties?: readonly (readonly [string, string])[];
  /** How a slideshow is printed: as it stands on screen, or every picture stacked. */
  slideshows?: SlideshowPrintMode;
  /**
   * The note as a deck, one `#schreibstube-slide` per slide, grouped by its
   * headings as `print-slides.ts` decides. A horizontal rule then starts a
   * slide rather than a page, whatever `hrIsPageBreak` says.
   */
  slides?: boolean;
  /** Where a slide's content stands across the page: centred unless it says left. */
  slideAlign?: SlideAlign;
  /**
   * The speaker's notes — every `> [!notes]` callout, which a slide never
   * shows — on pages of their own after the deck.
   */
  speakerNotes?: boolean;
}

/**
 * A picture the caller found and will not print, with the reason in words a
 * notice can show — a format no print can carry is not a picture "not found".
 */
export interface ImageRefusal {
  refused: string;
}

export interface Conversion {
  /** Typst markup, ready to be placed inside a template's body. */
  body: string;
  /** Every diagram fence met, whether or not a picture was supplied. */
  diagrams: DiagramBlock[];
  /** What could not be carried over, in the words a notice can show. */
  warnings: string[];
  /** How many slideshows the note holds, so the dialog only asks when there are some. */
  slideshows: number;
}

/** Callout kinds Obsidian ships, mapped to the four the prelude draws. */
const CALLOUT_KINDS: Record<string, string> = {
  note: "note",
  abstract: "note",
  summary: "note",
  tldr: "note",
  info: "note",
  todo: "note",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  question: "warning",
  help: "warning",
  faq: "warning",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  failure: "danger",
  fail: "danger",
  missing: "danger",
  danger: "danger",
  error: "danger",
  bug: "danger",
  example: "note",
  quote: "note",
  cite: "note"
};

/** Fences drawn by a plugin rather than typeset: captured, not converted. */
const DIAGRAM_LANGUAGES = new Set(["mermaid", "vizardry"]);

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BLOCKQUOTE = /^ {0,3}>\s?(.*)$/;
/** `[!kind]`, where a kind may be a plugin's own, with dashes and digits in it. */
const CALLOUT = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/;
/** `[label]: target "title"` — where a reference-style link points. */
const REFERENCE_DEFINITION =
  /^ {0,3}\[([^\]^][^\]]*)\]:\s*<?([^\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;
/** A task's box. Any single character but a space is done, as the ribbon counts it. */
const TASK = /^\[(.)\](?:\s+|$)/;
/** The line under a setext heading: `===` makes the text above it level 1, `---` level 2. */
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
/** A line that opens a block of math. */
const MATH_BLOCK = /^ {0,3}\$\$/;
/**
 * The `(target "title")` of a link or an image. A target with a space in it is
 * written `<my photo.png>`, as CommonMark allows and Obsidian writes when it
 * does not encode the space; both used to print as the text of the link.
 */
const LINK_DESTINATION = /\(\s*(?:<([^<>\n]*)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/;
const INLINE_LINK = new RegExp(`^\\[([^\\]]*)\\]${LINK_DESTINATION.source}`);
const INLINE_IMAGE = new RegExp(`^!${INLINE_LINK.source.slice(1)}`);

/** The target a `LINK_DESTINATION` match names, whichever way it was written. */
function linkTarget(match: RegExpExecArray | null): string | null {
  if (!match) return null;
  const angled = match[match.length - 2];
  const bare = match[match.length - 1];
  const target = angled ?? bare ?? "";
  return target === "" ? null : target;
}

/**
 * The elements a note writes as raw HTML. Anything else between angle
 * brackets — `<Name>`, `<GOAL OR OBJECTIVE>` — is text, and prints as text.
 */
const HTML_ELEMENTS = new Set(
  (
    "a abbr address article aside audio b bdi bdo big blockquote body br button caption center " +
    "cite code col colgroup data dd del details dfn dialog div dl dt em embed fieldset figcaption " +
    "figure font footer form h1 h2 h3 h4 h5 h6 head header hr html i iframe img input ins kbd label " +
    "legend li link main mark meta meter nav noscript object ol optgroup option output p param " +
    "picture pre progress q rp rt ruby s samp script section select small source span strike " +
    "strong style sub summary sup svg table tbody td template textarea tfoot th thead time title tr " +
    "track tt u ul var video wbr"
  ).split(" ")
);

/**
 * What a callout or a quote shares with the note around it.
 *
 * A quote is converted as a document of its own, but it is not one: its
 * diagrams are numbered in the note's order — the capture was keyed that way,
 * and a diagram numbered from zero again inside a callout was handed the
 * note's first picture — and its footnote references reach definitions that
 * stand outside it.
 */
interface Shared {
  footnotes: Map<string, string>;
  /** Reference-style link targets, by their label as Markdown compares them. */
  references: Map<string, string>;
  diagrams: DiagramBlock[];
  warnings: string[];
  /** Footnotes being expanded right now, so one that cites itself ends. */
  expanding: Set<string>;
  slideshows: number;
  /**
   * Whether the note is printed as slides. Held here rather than read from the
   * options, which a callout's conversion turns off: a picture in a callout
   * on a slide is still a picture on a slide.
   */
  deck: boolean;
}

export function markdownToTypst(source: string, options: ConvertOptions = {}): Conversion {
  return new Converter(source, options, {
    footnotes: new Map(),
    references: new Map(),
    diagrams: [],
    warnings: [],
    expanding: new Set(),
    slideshows: 0,
    deck: options.slides === true
  }).run();
}

class Converter {
  private readonly lines: string[];
  private at = 0;
  /** Whether the last `inline` ended in an expression, for a caller that splices it in. */
  private endsOpen = false;
  /** Lines that belong to a definition — a footnote with its indented
   *  continuation, a link reference — and print nowhere of their own. */
  private readonly consumed = new Set<number>();
  /** What the block just converted was to a deck: a slide's heading, or a rule. */
  private marker: SlidePart | null = null;
  /** How many top-level blocks have been converted: the next one's index for the marks. */
  private topBlocks = 0;
  private readonly breaks: ReadonlySet<number>;

  constructor(
    source: string,
    private readonly options: ConvertOptions,
    private readonly shared: Shared,
    private heading = ""
  ) {
    // A slide's settings live in comments, so they are lifted out of theirs
    // before the comments go; only a deck reads them.
    const text = stripComments(options.slides ? markSlideDirectives(source) : source);
    this.lines = (options.passage ? text : stripFrontmatter(text)).split(/\r?\n/);
    this.breaks = new Set(options.breaksBefore ?? []);
    this.collectDefinitions(this.lines, this.consumed);
    if (options.definitionsFrom !== undefined) {
      // The note's lines are only read: they print nowhere, so what they
      // consume is their own business.
      const note = stripFrontmatter(stripComments(options.definitionsFrom)).split(/\r?\n/);
      this.collectDefinitions(note, new Set());
    }
  }

  run(): Conversion {
    const parts: SlidePart[] = [];
    const blocks = this.blocks(0, parts);
    const rows = this.options.properties ?? [];
    if (rows.length > 0) {
      const table = `#schreibstube-properties((${rows.map(([key, value]) => `(${typstString(key)}, ${typstString(value)}),`).join(" ")}))\n`;
      const first = parts[0]?.kind === "heading" ? 1 : 0;
      blocks.splice(/^= /.test(withoutLead(blocks[0] ?? "")) ? 1 : 0, 0, table);
      parts.splice(first, 0, { kind: "block", markup: table });
    }
    let body = blocks.join("\n");
    if (this.marking()) body += `\n${BLOCK_REPORT}\n`;
    if (this.options.slides) {
      const slides = groupSlides(parts);
      const words = t().print;
      for (const slide of slides) {
        for (const problem of slide.problems) {
          this.warn(
            problem.kind === "widths"
              ? words.slideWidths(slide.name, problem.given, problem.columns)
              : problem.kind === "layout"
                ? words.slideLayout(slide.name, problem.value)
                : words.slideNoPicture(slide.name, problem.layout)
          );
        }
      }
      body = slidesMarkup(slides, this.options.slideAlign);
      if (this.options.speakerNotes && slides.some((slide) => slide.notes.length > 0)) {
        body += `\n#schreibstube-slide-notes(heading: ${typstString(words.notesHeading)}, slide: ${typstString(words.notesSlide)})\n`;
      }
    }
    return {
      body: `${body.replace(/\n{3,}/g, "\n\n").trim()}\n`,
      diagrams: this.shared.diagrams,
      warnings: this.shared.warnings,
      slideshows: this.shared.slideshows
    };
  }

  /**
   * A footnote is defined anywhere and referenced anywhere, so the definitions
   * are read first and the reference sites carry the text. Typst places a
   * footnote where it is used, which is the same reading order. A line inside
   * a fence that happens to look like a definition is code, not a footnote,
   * and the first definition of a name wins, as it does in the editor.
   *
   * A footnote's text may go on over indented lines, as far as the next line
   * that is not indented; those lines are the footnote's, and used to print
   * in the body while the footnote itself came out empty. A reference-style
   * link's target is read the same way, and its definition line, which
   * Obsidian does not show, is not printed either.
   */
  private collectDefinitions(lines: readonly string[], consumed: Set<number>): void {
    const fenced = fencedLines(lines);
    for (let index = 0; index < lines.length; index += 1) {
      if (fenced[index]) continue;
      const line = lines[index] ?? "";

      const footnote = FOOTNOTE_DEFINITION.exec(line);
      if (footnote?.[1] !== undefined) {
        consumed.add(index);
        const text = [footnote[2] ?? ""];
        let next = index + 1;
        while (next < lines.length) {
          const more = lines[next] ?? "";
          const after = lines[next + 1] ?? "";
          if (more.trim() === "" && indentOf(after) >= 4 && after.trim() !== "") {
            consumed.add(next);
            next += 1;
            continue;
          }
          if (more.trim() === "" || indentOf(more) < 4) break;
          text.push(more.trim());
          consumed.add(next);
          next += 1;
        }
        if (!this.shared.footnotes.has(footnote[1])) {
          this.shared.footnotes.set(footnote[1], text.filter((part) => part !== "").join("\n"));
        }
        index = next - 1;
        continue;
      }

      // A definition cannot interrupt a paragraph: straight under a line of
      // text it is more of that text, as it is in the editor.
      const previous = lines[index - 1];
      const opens = previous === undefined || previous.trim() === "" || consumed.has(index - 1);
      const reference = opens ? REFERENCE_DEFINITION.exec(line) : null;
      if (reference?.[1] !== undefined && reference[2] !== undefined) {
        consumed.add(index);
        const label = referenceLabel(reference[1]);
        if (!this.shared.references.has(label)) this.shared.references.set(label, reference[2]);
      }
    }
  }

  /** A quote's inside, converted as part of this note rather than beside it. */
  private nested(source: string): string {
    // The properties belong to the document, not to every quote inside it, and
    // so do the slides: a heading inside a callout is the callout's.
    // Its definitions are the note's, read already; its blocks are not the
    // page's, so they carry no marks and no breaks.
    const options: ConvertOptions = {
      ...this.options,
      properties: [],
      slides: false,
      blockMarkers: false,
      breaksBefore: []
    };
    delete options.definitionsFrom;
    return new Converter(source, options, this.shared, this.heading).run().body;
  }

  /**
   * Every block at this indent, until the indent drops or the source ends.
   * `parts`, when given, receives the same blocks as a deck reads them.
   */
  private blocks(indent: number, parts?: SlidePart[]): string[] {
    const out: string[] = [];

    while (this.at < this.lines.length) {
      const line = this.lines[this.at];
      if (line === undefined) break;

      if (line.trim() === "") {
        this.at += 1;
        continue;
      }
      if (indentOf(line) < indent) break;
      if (this.consumed.has(this.at)) {
        this.at += 1;
        continue;
      }

      this.marker = null;
      const block = this.block(indent);
      // Given `parts`, these are the document's own blocks rather than a list
      // item's, which is where a mark and a break can stand.
      if (block !== null) out.push(parts ? this.lead() + block : block);
      const part = this.takeMarker() ?? (block === null ? null : { kind: "block", markup: block });
      if (part) parts?.push(part);
    }
    // A list item's own blocks are the list's, not the deck's: a rule inside
    // one must not make the whole list read as a slide break.
    if (!parts) this.marker = null;

    return out;
  }

  /** Whether this conversion marks and breaks its top-level blocks: a page's, never a deck's. */
  private marking(): boolean {
    return this.options.blockMarkers === true && this.options.slides !== true;
  }

  /**
   * What goes before a top-level block: the page break a person set in the
   * preview, and the mark that reports where the block starts. Both stand in
   * a paragraph of their own, which Typst sets as nothing.
   */
  private lead(): string {
    if (this.options.slides) return "";
    const index = this.topBlocks;
    this.topBlocks += 1;
    const page = index > 0 && this.breaks.has(index) ? "#pagebreak(weak: true)\n\n" : "";
    const mark = this.marking() ? `#metadata(${index}) <schreibstube-block>\n\n` : "";
    return page + mark;
  }

  /** What the block just converted was to a deck, if anything; read once. */
  private takeMarker(): SlidePart | null {
    const marker = this.marker;
    this.marker = null;
    return marker;
  }

  private block(indent: number): string | null {
    const line = this.lines[this.at] ?? "";

    const directive = readDirective(line);
    if (directive) {
      this.at += 1;
      this.marker = directive;
      return null;
    }

    const fence = fenceMarker(line);
    if (fence) return this.fence(fence);

    // Four spaces deeper than the block around it is code, as in the editor.
    // A list marker there is still a list: this converter has always read
    // loosely indented lists, and a note relies on that more than on code
    // written without a fence.
    if (indentOf(line) >= indent + 4 && !BULLET.test(line) && !ORDERED.test(line)) {
      return this.indentedCode(indent);
    }

    if (MATH_BLOCK.test(line)) return this.mathBlock();

    const heading = HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      this.at += 1;
      return this.headingBlock(heading[1].length, heading[2] ?? "");
    }

    if (HR.test(line)) {
      this.at += 1;
      this.marker = { kind: "break" };
      return this.options.hrIsPageBreak ? "#pagebreak(weak: true)\n" : "#line(length: 100%)\n";
    }

    if (BLOCKQUOTE.test(line)) return this.blockquote();
    if (BULLET.test(line) || ORDERED.test(line)) return this.list(indentOf(line));
    if (this.isTableStart()) return this.table();

    return this.paragraph(indent);
  }

  private headingBlock(level: number, text: string): string {
    this.heading = text.trim();
    const markup = this.inline(this.heading);
    this.marker = { kind: "heading", level, markup, text: this.heading };
    return `${"=".repeat(level)} ${markup}\n`;
  }

  /** Code written by indenting it four spaces, set as a fence without a language. */
  private indentedCode(indent: number): string {
    const content: string[] = [];
    while (this.at < this.lines.length) {
      const line = this.lines[this.at] ?? "";
      if (line.trim() !== "" && indentOf(line) < indent + 4) break;
      content.push(dropColumns(line, indent + 4));
      this.at += 1;
    }
    while (content.length > 0 && (content[content.length - 1] ?? "").trim() === "") content.pop();
    return `#schreibstube-code(${typstString(content.join("\n"))}, "")\n`;
  }

  /**
   * A block of math, printed as it was written, in the code face.
   *
   * The note writes TeX, which Typst does not read, and turning one into the
   * other needs packages a device without a network does not have. Set as
   * text, the backslashes went: `\int` printed as "int". Printed as its
   * source, with a warning, the formula is at least what the note says.
   */
  private mathBlock(): string {
    const first = (this.lines[this.at] ?? "").trim().slice(2);
    this.at += 1;
    const content: string[] = [];
    const close = first.indexOf("$$");
    if (close !== -1) {
      content.push(first.slice(0, close));
    } else {
      if (first.trim() !== "") content.push(first);
      while (this.at < this.lines.length) {
        const line = this.lines[this.at] ?? "";
        this.at += 1;
        const end = line.indexOf("$$");
        if (end !== -1) {
          content.push(line.slice(0, end));
          break;
        }
        content.push(line);
      }
    }
    this.warn(t().print.mathAsSource);
    return `#schreibstube-code(${typstString(content.join("\n").trim())}, "latex")\n`;
  }

  /**
   * A fenced block: a diagram to be captured, or code to be set as code.
   *
   * Typst's `raw` takes the text verbatim, so nothing inside a fence is
   * escaped or interpreted — which is the whole point of having written it in
   * a fence.
   */
  private fence(marker: string): string {
    const opening = this.lines[this.at] ?? "";
    const language = opening.trim().slice(marker.length).trim().split(/\s+/)[0] ?? "";
    this.at += 1;

    const content: string[] = [];
    while (this.at < this.lines.length) {
      const line = this.lines[this.at] ?? "";
      const closing = fenceMarker(line);
      this.at += 1;
      if (closing && closing[0] === marker[0] && closing.length >= marker.length) break;
      content.push(line);
    }

    const source = content.join("\n");

    if (language.toLowerCase() === SLIDESHOW_LANGUAGE) {
      const printed = this.slideshow(source);
      if (printed !== null) return printed;
    }

    if (DIAGRAM_LANGUAGES.has(language.toLowerCase())) {
      const block: DiagramBlock = {
        index: this.shared.diagrams.length,
        language: language.toLowerCase(),
        source,
        caption: this.heading
      };
      this.shared.diagrams.push(block);

      // A fence may hold several drawings — a carousel shows one panel and
      // hides the rest, and a page has no carousel — so the helper is given
      // every picture that was captured, not the first of them.
      const paths = this.options.diagramImage?.(block) ?? null;
      if (paths !== null && paths.length > 0 && this.shared.deck) {
        // On a slide a drawing is a picture like any other, laid out and
        // captioned as one. Its caption is the drawing's own name: the heading
        // above it is the slide's title, standing right over it already.
        const caption = this.options.diagramTitle?.(block) ?? "";
        return `${paths.map((path) => `#schreibstube-slide-image(${typstString(path)}, ${typstString(caption)})`).join("\n")}\n`;
      }
      if (paths !== null && paths.length > 0) {
        const caption = diagramCaption(block.caption, this.options.diagramTitle?.(block) ?? "");
        return `#schreibstube-diagram(${typstArray(paths)}, ${typstString(caption)})\n`;
      }
      this.shared.warnings.push(t().print.diagramAsSource(language));
    }

    return `#schreibstube-code(${typstString(source)}, ${typstString(language)})\n`;
  }

  /**
   * A slideshow, as the print dialog asked for it.
   *
   * Read by the same parser that renders it, so a block the screen refuses is
   * refused here too, and printed as its source with the screen's reason. A
   * picture that is not in the vault is left out and named, as an embedded
   * one would be; the rest of the slideshow still prints.
   */
  private slideshow(source: string): string | null {
    const parsed = parseSlideshow(source);
    if (!parsed.ok) {
      this.warn(t().print.slideshowUnreadable(parsed.message));
      return null;
    }
    this.shared.slideshows += 1;

    const plan = slideshowForPrint(parsed, this.options.slideshows ?? "layout");
    const placed: string[] = [];
    for (const image of plan.images) {
      const request = { source: image.src, alt: image.alt, width: image.width };
      const path = this.resolveImage(request);
      if (path !== null) placed.push(`(${typstString(path)}, ${typstString(image.alt)}),`);
    }
    if (placed.length === 0) return "";
    return `#schreibstube-slideshow(${typstString(plan.arrangement)}, (${placed.join(" ")}), columns: ${plan.columns})\n`;
  }

  /** A blockquote, or the callout Obsidian writes in the shape of one. */
  private blockquote(): string | null {
    const inner: string[] = [];
    while (this.at < this.lines.length) {
      const match = BLOCKQUOTE.exec(this.lines[this.at] ?? "");
      if (!match) break;
      inner.push(match[1] ?? "");
      this.at += 1;
    }

    const first = inner[0] ?? "";
    const callout = CALLOUT.exec(first);
    if (callout?.[1]?.toLowerCase() === "notes" && this.shared.deck) {
      // The speaker's, not the audience's: handed to the deck, off the slide.
      this.marker = { kind: "notes", markup: this.nested(inner.slice(1).join("\n")) };
      return null;
    }
    if (callout?.[1] !== undefined) {
      const kind = CALLOUT_KINDS[callout[1].toLowerCase()] ?? "note";
      const title = (callout[3] ?? "").trim() || titleCase(callout[1]);
      const body = this.nested(inner.slice(1).join("\n"));
      return `#schreibstube-callout(${typstString(kind)}, [${this.inline(title)}])[\n${body}]\n`;
    }

    return `#quote(block: true)[\n${this.nested(inner.join("\n"))}]\n`;
  }

  /**
   * A list, with its nesting.
   *
   * Typst takes the same shape Markdown does — a marker and indentation — so
   * the structure is carried rather than rebuilt. An item's continuation lines
   * are indented to match, which is what keeps a paragraph inside an item from
   * ending it.
   */
  private list(indent: number): string {
    const out: string[] = [];
    let first = true;

    while (this.at < this.lines.length) {
      const line = this.lines[this.at];
      if (line === undefined || line.trim() === "") {
        const next = this.lines[this.at + 1];
        if (next === undefined || next.trim() === "") break;
        if (indentOf(next) < indent) break;
        if (!BULLET.test(next) && !ORDERED.test(next) && indentOf(next) <= indent) break;
        this.at += 1;
        continue;
      }
      if (indentOf(line) < indent) break;

      const bullet = BULLET.exec(line);
      const ordered = bullet ? null : ORDERED.exec(line);
      const match = bullet ?? ordered;
      if (!match || indentOf(line) > indent + 3) break;

      this.at += 1;
      // A numbered list that starts somewhere other than one says so on its
      // first item, which Typst continues from; the rest number themselves.
      const start = ordered ? Number(ordered[2]) : 1;
      const marker = bullet ? "-" : first && start !== 1 ? `${start}.` : "+";
      first = false;
      // A bulleted task's box stands where the bullet would, as on screen. A
      // Typst list gives every item the same marker, so the item becomes a
      // list of its own whose marker is the box; a numbered task keeps its
      // number and draws the box beside it.
      const task = bullet ? TASK.exec(match[3] ?? "") : null;
      const parts = [
        task ? this.inline((match[3] ?? "").slice(task[0].length)) : this.item(match[3] ?? "")
      ];

      // Everything indented past the marker belongs to this item: a nested
      // list, a second paragraph, a fenced block.
      parts.push(...this.blocks(indent + 2));

      const text = indentContinuation(parts.join("\n").trimEnd(), indent + 2);
      out.push(
        task
          ? `${" ".repeat(indent)}#schreibstube-task-item(schreibstube-task(${task[1] !== " "}))[${text}]`
          : `${" ".repeat(indent)}${marker} ${text}`
      );
    }

    return `${out.join("\n")}\n`;
  }

  /** A numbered item's first line, with a task's box drawn rather than typed. */
  private item(text: string): string {
    const task = TASK.exec(text);
    if (!task) return this.inline(text);
    const done = task[1] !== " ";
    return `#schreibstube-task(${done ? "true" : "false"}) ${this.inline(text.slice(task[0].length))}`;
  }

  /**
   * A row with a pipe over a delimiter row of as many cells: the outer pipes
   * are optional, as on screen, and the cell count is what keeps a line with
   * a pipe in it over a `---` underline the heading it reads as.
   */
  private isTableStart(): boolean {
    const line = this.lines[this.at] ?? "";
    const next = this.lines[this.at + 1] ?? "";
    return (
      line.includes("|") &&
      isTableDelimiter(next) &&
      rowCells(line).length === rowCells(next).length
    );
  }

  /**
   * A pipe table.
   *
   * The delimiter row's colons decide the alignment of every column, which is
   * the one piece of a Markdown table that carries design intent — the sample
   * invoice right-aligns its money and centres its positions, and a table that
   * lost that would read as a mistake.
   */
  private table(): string {
    const header = rowCells(this.lines[this.at] ?? "");
    const aligns = rowCells(this.lines[this.at + 1] ?? "").map(alignmentOf);
    this.at += 2;

    const rows: string[][] = [];
    while (this.at < this.lines.length) {
      const line = this.lines[this.at] ?? "";
      if (line.trim() === "" || !line.includes("|")) break;
      rows.push(rowCells(line));
      this.at += 1;
    }

    const columns = Math.max(header.length, aligns.length, ...rows.map((row) => row.length));
    const cell = (text: string): string => `[${this.inline(text)}]`;
    const pad = (row: string[]): string[] => {
      const padded = [...row];
      while (padded.length < columns) padded.push("");
      return padded.slice(0, columns);
    };

    const alignList = pad(aligns).map((a) => a || "left");
    const headerCells = header.some((text) => text.trim() !== "")
      ? `  table.header(${pad(header).map(cell).join(", ")}),\n`
      : "";

    const bodyCells = rows.map((row) => `  ${pad(row).map(cell).join(", ")},`).join("\n");

    return (
      `#schreibstube-table(\n` +
      `  columns: ${columns},\n` +
      `  align: (${alignList.join(", ")}),\n` +
      headerCells +
      (bodyCells ? `${bodyCells}\n` : "") +
      `)\n`
    );
  }

  /**
   * Consecutive non-blank lines that are nothing else — or, when a `===` or
   * `---` line follows them, a heading written the setext way, which used to
   * print as the text and a row of equals signs, or the text and a rule.
   */
  private paragraph(indent: number): string {
    const parts: string[] = [];

    while (this.at < this.lines.length) {
      const line = this.lines[this.at];
      if (line === undefined || line.trim() === "") break;
      if (indentOf(line) < indent) break;
      if (this.consumed.has(this.at)) break;

      const setext = parts.length > 0 ? SETEXT.exec(line) : null;
      if (setext?.[1] !== undefined) {
        this.at += 1;
        const text = parts.map((part) => part.trim()).join(" ");
        return this.headingBlock(setext[1].startsWith("=") ? 1 : 2, text);
      }

      if (
        HEADING.test(line) ||
        HR.test(line) ||
        BLOCKQUOTE.test(line) ||
        MATH_BLOCK.test(line) ||
        fenceMarker(line) !== null ||
        this.isTableStart()
      ) {
        break;
      }
      if (parts.length > 0 && (BULLET.test(line) || ORDERED.test(line))) break;

      parts.push(line);
      this.at += 1;
    }

    if (parts.length === 0) {
      this.at += 1;
      return "";
    }

    return `${this.inline(joinLines(parts))}\n`;
  }

  /**
   * Inline markup.
   *
   * One pass, left to right, because the constructs nest and a series of
   * regular expressions over the whole string would match inside a code span
   * — the one place where a `*` is a `*` and nothing else.
   */
  private inline(text: string): string {
    let out = "";
    let plain = "";
    let i = 0;
    // Whether `out` ends in an embedded expression. Typst carries one on into
    // whatever touches it — `#raw("f")(x)` is a call, `#strong[A].b` a field —
    // so text that begins with one of those is kept apart by a `;`, which
    // Typst reads as the end of the expression and does not print.
    let open = false;

    const append = (markup: string, expression: boolean): void => {
      if (markup === "") return;
      if (open && /^[([.]/.test(markup)) out += ";";
      out += markup;
      open = expression;
    };
    const flush = (): void => {
      append(escapeText(plain), false);
      plain = "";
    };

    while (i < text.length) {
      const rest = text.slice(i);
      const char = text[i] ?? "";

      if (char === "\\" && i + 1 < text.length) {
        plain += text[i + 1];
        i += 2;
        continue;
      }

      // Math, inline or display, set as its source in the code face: see
      // `mathBlock`. Read before the backslash escapes can reach it, which is
      // what took `\frac` apart. `$` needs text right after it and right
      // before its closing `$`, and no digit after that, so "$5 and $10" is
      // two prices, not a formula.
      if (char === "$") {
        const math = /^\$\$([\s\S]+?)\$\$|^\$(?=\S)([^$\n]*?\S)\$(?!\d)/.exec(rest);
        const formula = math?.[1] ?? math?.[2];
        if (math && formula !== undefined) {
          flush();
          this.warn(t().print.mathAsSource);
          append(`#raw(${typstString(formula.trim())})`, true);
          i += math[0].length;
          continue;
        }
      }

      if (char === "`") {
        const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
        if (code?.[2] !== undefined) {
          flush();
          append(`#raw(${typstString(code[2].trim())})`, true);
          i += code[0].length;
          continue;
        }
      }

      if (char === "<") {
        const br = /^<br\s*\/?>[ \t]*\n?/i.exec(rest);
        if (br) {
          flush();
          // The line break Typst understands. The source's own newline after
          // the tag is eaten with it: leaving it would end the paragraph, and
          // a person who wrote `<br>` asked for the next line, not the next
          // block — which is how a sender's address is written in one breath.
          append(" \\\n", false);
          i += br[0].length;
          continue;
        }
        // Before the tag rule, not after: `<https://example.de>` starts with
        // a letter too, so the generic rule used to swallow every autolink
        // and report it as HTML that had been dropped.
        const autolink = /^<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/.exec(rest);
        if (autolink?.[1] !== undefined) {
          flush();
          append(`#link(${typstString(autolink[1])})`, true);
          i += autolink[0].length;
          continue;
        }

        // Sub- and superscript are the two tags a page can keep: H₂O and mc²
        // printed as "H2O" and "mc2", which reads as a different thing.
        const script = /^<(sub|sup)>([\s\S]*?)<\/\1>/i.exec(rest);
        if (script?.[1] !== undefined && script[2] !== undefined) {
          flush();
          const fn = script[1].toLowerCase() === "sub" ? "#sub" : "#super";
          append(`${fn}[${this.inline(script[2])}]`, true);
          i += script[0].length;
          continue;
        }

        // Only an element HTML knows is a tag. `<DOING SOMETHING>` in a
        // template sentence is a placeholder a person typed, and it used to be
        // dropped as HTML, taking the words it held off the page.
        const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/.exec(rest);
        if (tag && HTML_ELEMENTS.has((tag[1] ?? "").toLowerCase())) {
          // Raw HTML has no meaning on paper and no safe rendering; dropping
          // the tag keeps the words it wrapped.
          this.warn(t().print.htmlDropped);
          i += tag[0].length;
          continue;
        }
      }

      if (char === "!" && rest.startsWith("![[")) {
        const embed = /^!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(rest);
        if (embed?.[1] !== undefined) {
          flush();
          append(...this.embed(embed[1].trim(), (embed[2] ?? "").trim()));
          i += embed[0].length;
          continue;
        }
      }

      if (char === "[" && rest.startsWith("[[")) {
        const link = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(rest);
        if (link?.[1] !== undefined) {
          flush();
          // A wikilink points inside the vault, where paper cannot follow; the
          // words stay, the link does not.
          const label = (link[2] ?? "").trim() || (link[1].split("#").pop() ?? link[1]).trim();
          append(escapeText(label), false);
          i += link[0].length;
          continue;
        }
      }

      if (char === "!") {
        const image = INLINE_IMAGE.exec(rest);
        const target = linkTarget(image);
        if (image && target !== null) {
          flush();
          append(...this.image(target, image[1] ?? ""));
          i += image[0].length;
          continue;
        }
      }

      if (char === "[") {
        const footnote = /^\[\^([^\]\s]+)\]/.exec(rest);
        if (footnote?.[1] !== undefined) {
          flush();
          append(this.footnote(footnote[1]), true);
          i += footnote[0].length;
          continue;
        }

        const link = INLINE_LINK.exec(rest);
        const target = linkTarget(link);
        if (link && target !== null) {
          flush();
          const label = this.inline(link[1] ?? "");
          const labelOpen = this.endsOpen;
          this.appendLink(append, label, labelOpen, target);
          i += link[0].length;
          continue;
        }

        // A reference-style link, `[text][label]`, `[text][]` or `[label]`,
        // where a definition elsewhere in the note gives the target. Only a
        // label that is defined is a link; any other bracket is text.
        const reference = /^\[([^\]]+)\](?:\[([^\]]*)\])?/.exec(rest);
        if (reference?.[1] !== undefined) {
          const shortcut = reference[2] === undefined;
          const target = this.shared.references.get(referenceLabel(reference[2] || reference[1]));
          if (
            target !== undefined &&
            !(shortcut && /^[(:]/.test(rest.slice(reference[0].length)))
          ) {
            flush();
            const label = this.inline(reference[1]);
            this.appendLink(append, label, this.endsOpen, target);
            i += reference[0].length;
            continue;
          }
        }
      }

      const emphasis = matchEmphasis(rest, plain.slice(-1) || text[i - 1] || "");
      if (emphasis) {
        flush();
        append(`${emphasis.open}[${this.inline(emphasis.content)}${emphasis.close}`, true);
        i += emphasis.length;
        continue;
      }

      plain += char;
      i += 1;
    }

    flush();
    this.endsOpen = open;
    return out;
  }

  /** A link as paper can have it: to a web address, or its words alone. */
  private appendLink(
    append: (markup: string, expression: boolean) => void,
    label: string,
    labelOpen: boolean,
    target: string
  ): void {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target))
      append(`#link(${typstString(target)})[${label}]`, true);
    else append(label, labelOpen);
  }

  /** Markup, and whether it ends in an expression — see `inline`. */
  private embed(target: string, alias: string): [string, boolean] {
    if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif)$/i.test(target)) {
      return this.image(target, alias);
    }
    // An embedded note would have to be read and converted, which is a second
    // document inside this one; saying so beats printing a stray file name.
    this.warn(t().print.embedNotPrinted(target));
    return [escapeText(alias || target), false];
  }

  private image(source: string, alt: string): [string, boolean] {
    // `![[a.png|300]]` is a width and `| center` an alignment, neither of them
    // words a caption should carry, nor the text that stands in for a picture
    // that could not be found.
    const { caption, width, align } = parseImageAlt(alt);
    const path = this.resolveImage({ source, alt });
    if (path === null) return [escapeText(caption), false];
    if (this.shared.deck) {
      // A slide's layout places its pictures; the note's alignment is for a page.
      return [`#schreibstube-slide-image(${typstString(path)}, ${typstString(caption)})`, true];
    }
    const picture = `#schreibstube-image(${typstString(path)}, ${typstString(caption)})`;
    if (width === null && align === null) return [picture, true];
    // The picture stays a call of its own inside the placement, so a template
    // that restyles schreibstube-image restyles a sized one too: a helper that
    // called it from the prelude would only ever see the prelude's.
    const placement = [
      width === null ? null : `width: ${cssPixelsToPoints(width)}pt`,
      align === null ? null : `align: ${align}`
    ].filter((argument) => argument !== null);
    return [`#schreibstube-placement(${placement.join(", ")})[${picture}]`, true];
  }

  /** A picture's path in the job, or null after saying why there is none. */
  private resolveImage(request: ImageRequest): string | null {
    const answer = this.options.image?.(request) ?? null;
    if (typeof answer === "string") return answer;
    this.warn(answer === null ? t().print.imageNotFound(request.source) : answer.refused);
    return null;
  }

  /**
   * A footnote's text at the place it is cited.
   *
   * A definition that cites itself, directly or through another, would expand
   * for ever; the inner citation is dropped instead, which is all a page could
   * show of it anyway.
   */
  private footnote(name: string): string {
    const note = this.shared.footnotes.get(name);
    if (note === undefined) {
      this.warn(t().print.footnoteMissing(name));
      return "";
    }
    if (this.shared.expanding.has(name)) return "";
    this.shared.expanding.add(name);
    try {
      return `#footnote[${this.inline(note)}]`;
    } finally {
      this.shared.expanding.delete(name);
    }
  }

  private warn(message: string): void {
    if (!this.shared.warnings.includes(message)) this.shared.warnings.push(message);
  }
}

interface Emphasis {
  open: string;
  /** The brackets that close it: bold italic opens two and closes two. */
  close: string;
  content: string;
  length: number;
}

/**
 * Emphasis, strong, strikethrough and highlight, longest marker first.
 *
 * A marker opens only when text follows it at once, and closes only when text
 * stands right before it: `2 * 3 * 4` is arithmetic, and it used to print
 * with a 3 in italics. `before` is the character the text had just before the
 * marker, which is the whole of the intra-word rule: an underscore between two
 * word characters is part of the word. Only the closing side was checked, so
 * `my_var` opened emphasis on its own underscore and swallowed the rest of
 * the sentence. A code span is skipped whole on the way to the closer, because
 * the `*` inside one is a `*` and nothing else.
 */
function matchEmphasis(rest: string, before: string): Emphasis | null {
  const markers: [string, string, string][] = [
    // Two brackets opened, two closed. One of them used to be missing, and
    // Typst refuses the whole document for one bold italic word.
    ["***", "#strong[#emph", "]]"],
    ["___", "#strong[#emph", "]]"],
    ["**", "#strong", "]"],
    ["__", "#strong", "]"],
    ["~~", "#strike", "]"],
    ["==", "#highlight", "]"],
    ["*", "#emph", "]"],
    ["_", "#emph", "]"]
  ];

  for (const [marker, open, close] of markers) {
    if (!rest.startsWith(marker)) continue;
    if (/^\s/.test(rest.slice(marker.length))) continue;
    const end = findCloser(rest, marker);
    if (end === -1) continue;
    const content = rest.slice(marker.length, end);
    if (content.trim() === "") continue;

    if (marker.startsWith("_")) {
      if (/\w/.test(before)) continue;
      const after = rest[end + marker.length];
      if (/\w$/.test(content) && after !== undefined && /\w/.test(after)) continue;
    }

    return { open, close, content, length: end + marker.length };
  }

  return null;
}

/** Where `marker` closes what it opened at the start of `rest`, or -1. */
function findCloser(rest: string, marker: string): number {
  let at = marker.length;
  while (at < rest.length) {
    if (rest[at] === "`") {
      const run = /^`+/.exec(rest.slice(at))?.[0] ?? "`";
      const close = rest.indexOf(run, at + run.length);
      at = close === -1 ? at + run.length : close + run.length;
      continue;
    }
    if (rest[at] === marker[0]) {
      const run = new RegExp(`^\\${marker[0]}+`).exec(rest.slice(at))?.[0] ?? marker;
      if (run.length > marker.length) {
        // A longer run opens a span of its own inside this one: `*a **b** c*`.
        // Its closer is found the same way, and skipped over.
        const inner = findCloser(rest.slice(at), run);
        at += inner === -1 ? run.length : inner + run.length;
        continue;
      }
      if (run.length === marker.length && !/\s/.test(rest[at - 1] ?? "")) return at;
      at += run.length;
      continue;
    }
    at += 1;
  }
  return -1;
}

/**
 * Text that Typst will set exactly as it was written.
 *
 * Typst's markup gives meaning to a dozen characters, and a name, a path or a
 * price may hold any of them. Each is escaped; the smart substitutions Typst
 * makes for quotation marks and dashes are left alone, because on paper they
 * are what is wanted.
 */
export function escapeText(text: string): string {
  const escaped = text
    .replace(/[\\#$*_`<>@~[\]]/g, (char) => `\\${char}`)
    // `//` opens a line comment in Typst, so a bare URL in prose used to take
    // the rest of its line off the page without a word about it. (`/*`, the
    // block comment, is already broken up by the escaped `*` above.)
    .replace(/\/\//g, "\\//");
  // At the start of a line these would open a heading, a list or a term list.
  return escaped.replace(/^(\s*)([=+/-]|\d+[.)])/gm, (_all, space: string, token: string) => {
    return `${space}\\${token}`;
  });
}

/**
 * What to write under a drawing.
 *
 * The note first: a heading above the fence is what the person writing the note
 * chose to call it, in the words of the document it belongs to. A canvas's own
 * title is the drawing's name for itself, which is better than nothing and
 * worse than that. Neither, and the picture stands unlabelled rather than
 * carrying a caption nobody wrote.
 */
export function diagramCaption(fromNote: string, fromDrawing: string): string {
  const note = fromNote.trim();
  if (note.length > 0) return note;
  return fromDrawing.trim();
}

/**
 * The report of where every marked block came to stand, read by the worker
 * after the compile. One query over the marks rather than a position at each,
 * so each mark is a bare `metadata` — which sets nothing — and only this one
 * element at the end asks the layout anything.
 */
const BLOCK_REPORT =
  `#context [#metadata(query(<schreibstube-block>).map(mark => (` +
  `block: mark.value, page: mark.location().page(), ` +
  `y: mark.location().position().y.pt()))) <${BLOCK_REPORT_LABEL}>]`;

/** A top-level block's markup without its mark, to ask what it opens with. */
function withoutLead(markup: string): string {
  return markup.replace(/^#metadata\(\d+\) <schreibstube-block>\n\n/, "");
}

/** The note without its properties, which print through `options.properties`, not as text. */
function stripFrontmatter(source: string): string {
  const match = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(source);
  return match ? source.slice(match[0].length) : source;
}

/**
 * `%%…%%` and `<!-- … -->` are notes to oneself and never reach paper.
 *
 * Obsidian hides both, the HTML comment as a browser would; it used to be
 * printed as the text it is. Outside a fenced block only: Obsidian shows
 * either inside one as the characters they are, and a pre-pass over the whole
 * note used to delete from one line of code to another. Either may run over
 * several lines, and a line that is all comment leaves no blank behind.
 */
export function stripComments(source: string): string {
  return scanComments(source).out;
}

/**
 * Whether each line of a note begins inside a comment.
 *
 * A fence that opens inside `%%…%%` is hidden with the rest of the comment, so
 * nothing drawn from it may leave the vault: the comment is the one part of a
 * note a person never meant anyone to see.
 */
export function linesInComment(source: string): boolean[] {
  return scanComments(source).openAt;
}

function scanComments(source: string): { out: string; openAt: boolean[] } {
  const lines = source.split("\n");
  const fenced = fencedLines(lines);
  const closer: Record<string, string> = { "%%": "%%", "<!--": "-->" };

  let out = "";
  let open: string | null = null;
  const openAt: boolean[] = [];

  for (const [index, line] of lines.entries()) {
    const suffix = index === lines.length - 1 ? "" : "\n";
    openAt.push(open !== null);

    if (fenced[index] && open === null) {
      out += line + suffix;
      continue;
    }

    const startedOpen = open !== null;
    let rest = line;
    let kept = "";
    for (;;) {
      if (open !== null) {
        const close = rest.indexOf(open);
        if (close === -1) break;
        rest = rest.slice(close + open.length);
        open = null;
        continue;
      }
      const percent = rest.indexOf("%%");
      const html = rest.indexOf("<!--");
      const at = percent === -1 ? html : html === -1 ? percent : Math.min(percent, html);
      if (at === -1) {
        kept += rest;
        break;
      }
      const opener = at === percent ? "%%" : "<!--";
      kept += rest.slice(0, at);
      rest = rest.slice(at + opener.length);
      open = closer[opener] ?? null;
    }

    // A line inside a comment that never reached its end is not a line at all.
    if (startedOpen && open !== null && kept === "") continue;
    out += kept + suffix;
  }

  return { out, openAt };
}

/**
 * How far a line is indented, in columns.
 *
 * A tab counts four, as it does in the editor: counted as one character, a
 * tab-indented sub-item — which is what Obsidian inserts by default — never
 * reached the two columns that make it a child, and every level flattened
 * into one.
 */
function indentOf(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns += 1;
    else if (char === "\t") columns += TAB_COLUMNS;
    else break;
  }
  return columns;
}

/**
 * Continuation lines of a list item line up under its text.
 *
 * A line already indented that far keeps its own indent: a nested list is
 * drawn at its own depth, and pulling every line back to one column made a
 * third level print at the second.
 */
function indentContinuation(text: string, indent: number): string {
  const [first = "", ...rest] = text.split("\n");
  if (rest.length === 0) return first;
  return [
    first,
    ...rest.map((line) =>
      line.trim() === "" || indentOf(line) >= indent
        ? line
        : `${" ".repeat(indent)}${line.trimStart()}`
    )
  ].join("\n");
}

/**
 * A paragraph's lines, joined as Markdown joins them: a soft break is a space
 * on paper, and a line that ends in two spaces or a backslash keeps its break.
 * Both used to be lost — the lines were trimmed before anyone looked. The break
 * is handed on as `<br>`, which the inline pass already sets as Typst's.
 */
function joinLines(lines: readonly string[]): string {
  return lines
    .map((line, index) => {
      const last = index === lines.length - 1;
      const text = line.trim();
      if (last) return text;
      if (/ {2,}$/.test(line)) return `${text}<br>`;
      if (/(?:^|[^\\])(?:\\\\)*\\$/.test(text)) return `${text.slice(0, -1)}<br>`;
      return text;
    })
    .join("\n");
}

/** A reference label as Markdown compares them: case and runs of space do not count. */
function referenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A line with its first `columns` columns of indentation taken off. */
function dropColumns(line: string, columns: number): string {
  let taken = 0;
  let index = 0;
  while (index < line.length && taken < columns) {
    const char = line[index];
    if (char === " ") taken += 1;
    else if (char === "\t") taken += TAB_COLUMNS;
    else break;
    index += 1;
  }
  return line.slice(index);
}

function alignmentOf(cell: string): string {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
