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
import { fenceMarker } from "./markdown-fence";
import { typstArray, typstString } from "./typst-value";

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
  image?: (request: ImageRequest) => string | null;
}

export interface Conversion {
  /** Typst markup, ready to be placed inside a template's body. */
  body: string;
  /** Every diagram fence met, whether or not a picture was supplied. */
  diagrams: DiagramBlock[];
  /** What could not be carried over, in the words a notice can show. */
  warnings: string[];
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

export function markdownToTypst(source: string, options: ConvertOptions = {}): Conversion {
  return new Converter(source, options).run();
}

class Converter {
  private readonly lines: string[];
  private readonly footnotes = new Map<string, string>();
  private readonly diagrams: DiagramBlock[] = [];
  private readonly warnings: string[] = [];
  private at = 0;
  private heading = "";

  constructor(
    source: string,
    private readonly options: ConvertOptions
  ) {
    this.lines = stripFrontmatter(stripComments(source)).split(/\r?\n/);
    this.collectFootnotes();
  }

  run(): Conversion {
    const body = this.blocks(0).join("\n");
    return {
      body: `${body.replace(/\n{3,}/g, "\n\n").trim()}\n`,
      diagrams: this.diagrams,
      warnings: this.warnings
    };
  }

  /**
   * A footnote is defined anywhere and referenced anywhere, so the definitions
   * are read first and the reference sites carry the text. Typst places a
   * footnote where it is used, which is the same reading order.
   */
  private collectFootnotes(): void {
    for (const line of this.lines) {
      const match = FOOTNOTE_DEFINITION.exec(line);
      if (match?.[1] !== undefined) this.footnotes.set(match[1], match[2] ?? "");
    }
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

    if (DIAGRAM_LANGUAGES.has(language.toLowerCase())) {
      const block: DiagramBlock = {
        index: this.diagrams.length,
        language: language.toLowerCase(),
        source,
        caption: this.heading
      };
      this.diagrams.push(block);

      // A fence may hold several drawings — a carousel shows one panel and
      // hides the rest, and a page has no carousel — so the helper is given
      // every picture that was captured, not the first of them.
      const paths = this.options.diagramImage?.(block) ?? null;
      if (paths !== null && paths.length > 0) {
        const caption = diagramCaption(block.caption, this.options.diagramTitle?.(block) ?? "");
        return `#schreibstube-diagram(${typstArray(paths)}, ${quote(caption)})\n`;
      }
      this.warnings.push(`${language}: could not be drawn, printed as source`);
    }

    return `#schreibstube-code(${quote(source)}, ${quote(language)})\n`;
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
      const body = markdownToTypst(inner.slice(1).join("\n"), this.options);
      this.adopt(body);
      return `#schreibstube-callout(${quote(kind)}, [${this.inline(title)}])[\n${body.body}]\n`;
    }

    const body = markdownToTypst(inner.join("\n"), this.options);
    this.adopt(body);
    return `#quote(block: true)[\n${body.body}]\n`;
  }

  /** Diagrams and warnings found inside a nested conversion belong to this one. */
  private adopt(conversion: Conversion): void {
    for (const diagram of conversion.diagrams) {
      diagram.index = this.diagrams.length;
      this.diagrams.push(diagram);
    }
    this.warnings.push(...conversion.warnings);
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
      const marker = bullet ? "-" : "+";
      const parts = [this.inline(match[3] ?? "")];

      // Everything indented past the marker belongs to this item: a nested
      // list, a second paragraph, a fenced block.
      const contentIndent = indent + (match[2] ?? "").length + 2;
      const nested = this.blocks(Math.min(contentIndent, indent + 2));
      parts.push(...nested);

      const text = parts.join("\n").trimEnd();
      out.push(`${" ".repeat(indent)}${marker} ${indentContinuation(text, indent + 2)}`);
    }

    return `${out.join("\n")}\n`;
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

    const flush = (): void => {
      out += escapeText(plain);
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
          out += `#raw(${quote(code[2].trim())})`;
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
          out += " \\\n";
          i += br[0].length;
          continue;
        }
        const tag = /^<\/?[A-Za-z][^>]*>/.exec(rest);
        if (tag) {
          // Raw HTML has no meaning on paper and no safe rendering; dropping
          // the tag keeps the words it wrapped.
          this.warn("HTML is dropped when printing");
          i += tag[0].length;
          continue;
        }
      }

      if (char === "!" && rest.startsWith("![[")) {
        const embed = /^!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(rest);
        if (embed?.[1] !== undefined) {
          flush();
          out += this.embed(embed[1].trim(), (embed[2] ?? "").trim());
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
          out += escapeText(label);
          i += link[0].length;
          continue;
        }
      }

      if (char === "!") {
        const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
        if (image?.[2] !== undefined) {
          flush();
          out += this.image(image[2], image[1] ?? "");
          i += image[0].length;
          continue;
        }
      }

      if (char === "[") {
        const footnote = /^\[\^([^\]\s]+)\]/.exec(rest);
        if (footnote?.[1] !== undefined) {
          flush();
          const note = this.footnotes.get(footnote[1]);
          out += note === undefined ? "" : `#footnote[${this.inline(note)}]`;
          i += footnote[0].length;
          continue;
        }

        const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
        if (link?.[2] !== undefined) {
          flush();
          const label = this.inline(link[1] ?? "");
          const target = link[2];
          out += /^[a-z][a-z0-9+.-]*:/i.test(target) ? `#link(${quote(target)})[${label}]` : label;
          i += link[0].length;
          continue;
        }
      }

      const emphasis = matchEmphasis(rest);
      if (emphasis) {
        flush();
        out += `${emphasis.open}[${this.inline(emphasis.content)}]`;
        i += emphasis.length;
        continue;
      }

      const autolink = /^<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/.exec(rest);
      if (autolink?.[1] !== undefined) {
        flush();
        out += `#link(${quote(autolink[1])})`;
        i += autolink[0].length;
        continue;
      }

      plain += char;
      i += 1;
    }

    flush();
    return out;
  }

  private embed(target: string, alias: string): string {
    if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(target)) return this.image(target, alias);
    // An embedded note would have to be read and converted, which is a second
    // document inside this one; saying so beats printing a stray file name.
    this.warn(`embedded note is not printed: ${target}`);
    return escapeText(alias || target);
  }

  private image(source: string, alt: string): string {
    const path = this.options.image?.({ source, alt }) ?? null;
    if (path === null) {
      this.warn(`image not found: ${source}`);
      return escapeText(alt);
    }
    return `#schreibstube-image(${quote(path)}, ${quote(alt)})`;
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

/** Emphasis, strong, strikethrough and highlight, longest marker first. */
function matchEmphasis(rest: string): { open: string; content: string; length: number } | null {
  const markers: [string, string][] = [
    ["***", "#strong[#emph"],
    ["___", "#strong[#emph"],
    ["**", "#strong"],
    ["__", "#strong"],
    ["~~", "#strike"],
    ["==", "#highlight"],
    ["*", "#emph"],
    ["_", "#emph"]
  ];

  for (const [marker, open] of markers) {
    if (!rest.startsWith(marker)) continue;
    const close = rest.indexOf(marker, marker.length);
    if (close === -1) continue;
    const content = rest.slice(marker.length, close);
    if (content.trim() === "") continue;
    // An underscore inside a word is a word, not emphasis: snake_case names
    // would otherwise come out italic and missing their underscores.
    if (marker.startsWith("_") && /\w$/.test(rest.slice(0, 0) + content.slice(-1))) {
      const after = rest[close + marker.length];
      if (after !== undefined && /\w/.test(after)) continue;
    }
    const length = close + marker.length;
    return marker.length === 3 ? { open, content, length: length } : { open, content, length };
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
  const escaped = text.replace(/[\\#$*_`<>@~[\]]/g, (char) => `\\${char}`);
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

/** `%%…%%` is a note to oneself and never reaches paper. */
function stripComments(source: string): string {
  return source.replace(/%%[\s\S]*?%%/g, "");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
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
