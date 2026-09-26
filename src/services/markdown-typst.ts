/**
 * Markdown as the vault writes it, turned into Typst as a template compiles it.
 *
 * Hand-written rather than borrowed. The bridge's site renderer uses
 * markdown-it, but the bridge is a server with room for a dependency tree and
 * this runs inside the plugin, whose whole bundle has a 400 KB budget and is
 * parsed on every start on every phone. What is needed here is also narrower:
 * one output format, no plugin ecosystem, and the Obsidian syntax that matters
 * on paper.
 *
 * Everything is a pure function of the source and the options. Nothing here
 * knows about Obsidian, a vault, or a file; images and diagrams are resolved
 * by callbacks the caller supplies, which is what keeps the whole conversion
 * testable in a few milliseconds.
 */
import { t } from "../i18n";
import { fencedLines, fenceMarker } from "./markdown-fence";
import { typstArray, typstString } from "./typst-value";
import { parseSlideshow, SLIDESHOW_LANGUAGE } from "./slideshow";
import { slideshowForPrint, type SlideshowPrintMode } from "./print-slideshow";

/** What a tab is worth when a list's nesting is measured, as in the editor. */
const TAB_COLUMNS = 4;

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
const CALLOUT = /^\[!([A-Za-z]+)\]([+-]?)\s*(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_DELIMITER = /^ {0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/;
const TASK = /^\[([ xX])\]\s+/;

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
  diagrams: DiagramBlock[];
  warnings: string[];
  /** Footnotes being expanded right now, so one that cites itself ends. */
  expanding: Set<string>;
  slideshows: number;
}

export function markdownToTypst(source: string, options: ConvertOptions = {}): Conversion {
  return new Converter(source, options, {
    footnotes: new Map(),
    diagrams: [],
    warnings: [],
    expanding: new Set(),
    slideshows: 0
  }).run();
}

class Converter {
  private readonly lines: string[];
  private at = 0;
  /** Whether the last `inline` ended in an expression, for a caller that splices it in. */
  private endsOpen = false;

  constructor(
    source: string,
    private readonly options: ConvertOptions,
    private readonly shared: Shared,
    private heading = ""
  ) {
    this.lines = stripFrontmatter(stripComments(source)).split(/\r?\n/);
    this.collectFootnotes();
  }

  run(): Conversion {
    const blocks = this.blocks(0);
    const rows = this.options.properties ?? [];
    if (rows.length > 0) {
      const table = `#schreibstube-properties((${rows.map(([key, value]) => `(${quote(key)}, ${quote(value)}),`).join(" ")}))\n`;
      blocks.splice(/^= /.test(blocks[0] ?? "") ? 1 : 0, 0, table);
    }
    const body = blocks.join("\n");
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
   */
  private collectFootnotes(): void {
    const fenced = fencedLines(this.lines);
    for (const [index, line] of this.lines.entries()) {
      if (fenced[index]) continue;
      const match = FOOTNOTE_DEFINITION.exec(line);
      if (match?.[1] !== undefined && !this.shared.footnotes.has(match[1])) {
        this.shared.footnotes.set(match[1], match[2] ?? "");
      }
    }
  }

  /** A quote's inside, converted as part of this note rather than beside it. */
  private nested(source: string): string {
    // The properties belong to the document, not to every quote inside it.
    const options = { ...this.options, properties: [] };
    return new Converter(source, options, this.shared, this.heading).run().body;
  }

  /** Every block at this indent, until the indent drops or the source ends. */
  private blocks(indent: number): string[] {
    const out: string[] = [];

    while (this.at < this.lines.length) {
      const line = this.lines[this.at];
      if (line === undefined) break;

      if (line.trim() === "") {
        this.at += 1;
        continue;
      }
      if (indentOf(line) < indent) break;
      if (FOOTNOTE_DEFINITION.test(line)) {
        this.at += 1;
        continue;
      }

      const block = this.block(indent);
      if (block !== null) out.push(block);
    }

    return out;
  }

  private block(indent: number): string | null {
    const line = this.lines[this.at] ?? "";

    const fence = fenceMarker(line);
    if (fence) return this.fence(fence);

    const heading = HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      this.at += 1;
      this.heading = (heading[2] ?? "").trim();
      return `${"=".repeat(heading[1].length)} ${this.inline(this.heading)}\n`;
    }

    if (HR.test(line)) {
      this.at += 1;
      return this.options.hrIsPageBreak ? "#pagebreak(weak: true)\n" : "#line(length: 100%)\n";
    }

    if (BLOCKQUOTE.test(line)) return this.blockquote();
    if (BULLET.test(line) || ORDERED.test(line)) return this.list(indentOf(line));
    if (this.isTableStart()) return this.table();

    return this.paragraph(indent);
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
      if (paths !== null && paths.length > 0) {
        const caption = diagramCaption(block.caption, this.options.diagramTitle?.(block) ?? "");
        return `#schreibstube-diagram(${typstArray(paths)}, ${quote(caption)})\n`;
      }
      this.shared.warnings.push(t().print.diagramAsSource(language));
    }

    return `#schreibstube-code(${quote(source)}, ${quote(language)})\n`;
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
      if (path !== null) placed.push(`(${quote(path)}, ${quote(image.alt)}),`);
    }
    if (placed.length === 0) return "";
    return `#schreibstube-slideshow(${quote(plan.arrangement)}, (${placed.join(" ")}), columns: ${plan.columns})\n`;
  }

  /** A blockquote, or the callout Obsidian writes in the shape of one. */
  private blockquote(): string {
    const inner: string[] = [];
    while (this.at < this.lines.length) {
      const match = BLOCKQUOTE.exec(this.lines[this.at] ?? "");
      if (!match) break;
      inner.push(match[1] ?? "");
      this.at += 1;
    }

    const first = inner[0] ?? "";
    const callout = CALLOUT.exec(first);
    if (callout?.[1] !== undefined) {
      const kind = CALLOUT_KINDS[callout[1].toLowerCase()] ?? "note";
      const title = (callout[3] ?? "").trim() || titleCase(callout[1]);
      const body = this.nested(inner.slice(1).join("\n"));
      return `#schreibstube-callout(${quote(kind)}, [${this.inline(title)}])[\n${body}]\n`;
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
        // A blank line ends the list only if the next content is not part of it.
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
      const parts = [this.item(match[3] ?? "")];

      // Everything indented past the marker belongs to this item: a nested
      // list, a second paragraph, a fenced block.
      parts.push(...this.blocks(indent + 2));

      const text = parts.join("\n").trimEnd();
      out.push(`${" ".repeat(indent)}${marker} ${indentContinuation(text, indent + 2)}`);
    }

    return `${out.join("\n")}\n`;
  }

  /** An item's first line, with a task's box drawn rather than typed. */
  private item(text: string): string {
    const task = TASK.exec(text);
    if (!task) return this.inline(text);
    const done = task[1] !== " ";
    return `#schreibstube-task(${done ? "true" : "false"}) ${this.inline(text.slice(task[0].length))}`;
  }

  private isTableStart(): boolean {
    const line = this.lines[this.at] ?? "";
    const next = this.lines[this.at + 1] ?? "";
    return line.trim().startsWith("|") && TABLE_DELIMITER.test(next) && next.includes("-");
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
    const header = splitRow(this.lines[this.at] ?? "");
    const aligns = splitRow(this.lines[this.at + 1] ?? "").map(alignmentOf);
    this.at += 2;

    const rows: string[][] = [];
    while (this.at < this.lines.length) {
      const line = this.lines[this.at] ?? "";
      if (!line.trim().startsWith("|")) break;
      rows.push(splitRow(line));
      this.at += 1;
    }

    const columns = Math.max(header.length, aligns.length, ...rows.map((row) => row.length));
    const cell = (text: string): string => `[${this.inline(text)}]`;
    const pad = (row: string[]): string[] => {
      const padded = [...row];
      while (padded.length < columns) padded.push("");
      return padded.slice(0, columns);
    };

    const alignList = pad(aligns.map((a) => a ?? "left")).map((a) => a || "left");
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

  /** Consecutive non-blank lines that are nothing else. */
  private paragraph(indent: number): string {
    const parts: string[] = [];

    while (this.at < this.lines.length) {
      const line = this.lines[this.at];
      if (line === undefined || line.trim() === "") break;
      if (indentOf(line) < indent) break;
      if (
        HEADING.test(line) ||
        HR.test(line) ||
        BLOCKQUOTE.test(line) ||
        fenceMarker(line) !== null ||
        this.isTableStart()
      ) {
        break;
      }
      if (parts.length > 0 && (BULLET.test(line) || ORDERED.test(line))) break;

      parts.push(line.trim());
      this.at += 1;
    }

    if (parts.length === 0) {
      this.at += 1;
      return "";
    }

    return `${this.inline(parts.join("\n"))}\n`;
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

      // A backslash escape in Markdown makes the next character literal.
      if (char === "\\" && i + 1 < text.length) {
        plain += text[i + 1];
        i += 2;
        continue;
      }

      if (char === "`") {
        const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
        if (code?.[2] !== undefined) {
          flush();
          append(`#raw(${quote(code[2].trim())})`, true);
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
          append(`#link(${quote(autolink[1])})`, true);
          i += autolink[0].length;
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
        const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
        if (image?.[2] !== undefined) {
          flush();
          append(...this.image(image[2], image[1] ?? ""));
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

        const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
        if (link?.[2] !== undefined) {
          flush();
          const label = this.inline(link[1] ?? "");
          const labelOpen = this.endsOpen;
          const target = link[2];
          if (/^[a-z][a-z0-9+.-]*:/i.test(target))
            append(`#link(${quote(target)})[${label}]`, true);
          else append(label, labelOpen);
          i += link[0].length;
          continue;
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
    const path = this.resolveImage({ source, alt });
    if (path === null) return [escapeText(alt), false];
    return [`#schreibstube-image(${quote(path)}, ${quote(alt)})`, true];
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
 * `before` is the character the text had just before the marker, which is the
 * whole of the intra-word rule: an underscore between two word characters is
 * part of the word. Only the closing side was checked, so `my_var` opened
 * emphasis on its own underscore and swallowed the rest of the sentence.
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
    const end = rest.indexOf(marker, marker.length);
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

function quote(value: string): string {
  return typstString(value);
}

function stripFrontmatter(source: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
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
function stripComments(source: string): string {
  const lines = source.split("\n");
  const fenced = fencedLines(lines);
  const closer: Record<string, string> = { "%%": "%%", "<!--": "-->" };

  let out = "";
  let open: string | null = null;

  for (const [index, line] of lines.entries()) {
    const suffix = index === lines.length - 1 ? "" : "\n";

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

  return out;
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

/** Continuation lines of a list item line up under its text. */
function indentContinuation(text: string, indent: number): string {
  const [first = "", ...rest] = text.split("\n");
  if (rest.length === 0) return first;
  return [
    first,
    ...rest.map((line) => (line.trim() === "" ? line : `${" ".repeat(indent)}${line.trimStart()}`))
  ].join("\n");
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
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
