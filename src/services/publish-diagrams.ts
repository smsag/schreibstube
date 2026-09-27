/**
 * A published page shows a Vizardry canvas as the picture it is on screen.
 *
 * The bridge renders Markdown on a server, and a canvas can only be drawn by
 * the plugin that owns it, inside Obsidian. So the plugin draws it before the
 * upload and the note the bridge receives says `![title](picture.png)` where
 * the fence was; the picture travels as one more asset. The bridge needs to
 * know nothing about canvases, and a bridge of any protocol version renders it.
 *
 * The note in the vault is never touched: only the copy that is uploaded is
 * rewritten, and only where a picture exists. A fence that could not be drawn
 * stays a fence, and the site shows its source as it did before.
 *
 * Mermaid is not among these. The site draws it in the reader's browser, where
 * it stays text and follows the page's colours; a picture would be worse.
 */
import { fenceMarker } from "./markdown-fence";
import { linesInComment } from "./markdown-typst";

/** The fences a published page shows as a picture drawn in the vault. */
export const PUBLISHED_DIAGRAM_LANGUAGES: ReadonlySet<string> = new Set(["vizardry"]);

/**
 * The largest picture of one canvas that is published.
 *
 * Under the bridge's default allowance for an image, so that a picture this
 * lets through is not refused on arrival and the whole publish with it.
 */
export const MAX_PUBLISHED_DIAGRAM_BYTES = 4_000_000;

/** More fences than this in one note are left as source, not drawn one by one. */
export const MAX_DIAGRAMS_PER_NOTE = 50;

/**
 * How long a picture's description may be.
 *
 * It comes from the drawing plugin's own title, which is text a person typed
 * into a canvas; it is read aloud by a screen reader, not meant to be an essay.
 */
export const MAX_DIAGRAM_ALT_CHARS = 200;

/** The name every published diagram picture begins with. */
const ASSET_PREFIX = "schreibstube-diagram";

export interface DiagramFence {
  /** Position among the diagram fences of this note. */
  index: number;
  language: string;
  /** The fence's text, without its quote markers or its own indentation. */
  source: string;
  /** First and last line of the fence, both inclusive. */
  start: number;
  end: number;
  /** What each line of the fence began with: quote markers and indentation. */
  lead: string;
}

/**
 * Every fence in a note that a published page shows as a picture.
 *
 * Read the way the bridge will read the uploaded copy: a fence inside another
 * fence is that fence's text, and a fence inside a callout or a quote is a
 * fence of its own. One that opens inside a comment is left out entirely — it
 * is hidden in the note, and drawing it would publish it.
 */
export function findDiagramFences(
  content: string,
  languages: ReadonlySet<string> = PUBLISHED_DIAGRAM_LANGUAGES
): DiagramFence[] {
  const lines = content.split("\n");
  const commented = linesInComment(content);
  const found: DiagramFence[] = [];

  let at = 0;
  while (at < lines.length) {
    const opening = splitQuote(lines[at] ?? "");
    const marker = fenceMarker(opening.rest);
    if (!marker) {
      at += 1;
      continue;
    }

    const indent = /^[ \t]*/.exec(opening.rest)?.[0] ?? "";
    const language =
      opening.rest.trim().slice(marker.length).trim().split(/\s+/)[0]?.toLowerCase() ?? "";

    const body: string[] = [];
    let end = lines.length - 1;
    for (let line = at + 1; line < lines.length; line += 1) {
      const inner = splitQuote(lines[line] ?? "");
      // A quote that ends ends the fence inside it, as it does in a renderer.
      if (inner.depth < opening.depth) {
        end = line - 1;
        break;
      }
      const closing = fenceMarker(inner.rest);
      if (closing && closing[0] === marker[0] && closing.length >= marker.length) {
        end = line;
        break;
      }
      body.push(dedent(inner.rest, indent.length));
    }

    if (languages.has(language) && !commented[at] && found.length < MAX_DIAGRAMS_PER_NOTE) {
      found.push({
        index: found.length,
        language,
        source: body.join("\n"),
        start: at,
        end,
        lead: opening.quote + indent
      });
    }
    at = end + 1;
  }

  return found;
}

/**
 * What a fence's content is known by: its language and its text, and nothing
 * about where it stands, so a canvas moved within a note is still the same
 * picture and is neither drawn nor uploaded again.
 */
export function diagramKeyInput(fence: Pick<DiagramFence, "language" | "source">): string {
  return `${fence.language}\n${fence.source}`;
}

/**
 * The published name of one picture of a fence, from the fence's key.
 *
 * Unlike any name a person gives an attachment, so a picture in the vault is
 * never shadowed by one of these; and the same for the same canvas, so a page
 * that did not change comes out the same and is not written again.
 */
export function diagramAssetName(key: string, panel: number): string {
  if (!/^[0-9a-f]{16,}$/.test(key)) throw new Error("A diagram key is a hex digest.");
  return `${ASSET_PREFIX}-${key.slice(0, 16)}-${panel + 1}.png`;
}

/**
 * A picture's description, made safe to stand between `![` and `]`.
 *
 * The title is another plugin's text. A bracket would end the description
 * early and print the rest as text, and a `|` followed by digits would be read
 * as a width; a line break would end the paragraph.
 */
export function diagramAlt(title: string, fallback: string): string {
  const cleaned = title
    // Control characters, line breaks included, are nothing a description says.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\\/g, "/")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DIAGRAM_ALT_CHARS)
    .trim();
  return cleaned || fallback;
}

/**
 * The note with each drawn fence replaced by its pictures.
 *
 * `pictures` maps a fence's index to the picture lines that stand for it; a
 * fence without an entry stays as it was. Each picture is its own paragraph,
 * written with the fence's own quote markers and indentation, so a canvas in a
 * callout stays in the callout.
 */
export function replaceDiagramFences(
  content: string,
  fences: readonly DiagramFence[],
  pictures: ReadonlyMap<number, readonly { name: string; alt: string }[]>
): string {
  const lines = content.split("\n");

  // From the end, so a replacement never moves a fence not yet replaced.
  for (const fence of [...fences].sort((a, b) => b.start - a.start)) {
    const drawn = pictures.get(fence.index);
    if (!drawn || drawn.length === 0) continue;

    const blank = fence.lead.replace(/\s+$/, "");
    const replacement = drawn.flatMap((picture, at) => [
      ...(at > 0 ? [blank] : []),
      `${fence.lead}![${picture.alt}](${picture.name})`
    ]);
    lines.splice(fence.start, fence.end - fence.start + 1, ...replacement);
  }

  return lines.join("\n");
}

/** A line's quote markers, how many there are, and what follows them. */
function splitQuote(line: string): { quote: string; depth: number; rest: string } {
  const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line)?.[0] ?? "";
  return { quote, depth: (quote.match(/>/g) ?? []).length, rest: line.slice(quote.length) };
}

/** Up to `columns` leading spaces off a line, as a renderer takes a fence's indent. */
function dedent(line: string, columns: number): string {
  let taken = 0;
  while (taken < columns && (line[taken] === " " || line[taken] === "\t")) taken += 1;
  return line.slice(taken);
}

/**
 * How many bytes of drawn pictures are kept between publishes.
 *
 * Drawing a canvas takes a moment and a site may hold dozens, so a picture is
 * kept for the next publish of the same canvas. On a phone every kept byte is
 * memory the WebView does not get back; past this, the oldest are let go and
 * simply drawn again when they are next needed.
 */
export const MAX_KEPT_DIAGRAM_BYTES = 24_000_000;

export interface DrawnPicture {
  name: string;
  sha256: string;
  bytes: Uint8Array;
}

export interface DrawnDiagram {
  pictures: DrawnPicture[];
  alt: string;
}

/** Drawn canvases by key, the oldest let go first once the budget is spent. */
export class DrawnDiagrams {
  private readonly kept = new Map<string, DrawnDiagram>();
  private total = 0;

  constructor(private readonly budget = MAX_KEPT_DIAGRAM_BYTES) {}

  get(key: string): DrawnDiagram | undefined {
    const found = this.kept.get(key);
    if (found) {
      // Used again, so it is the last to go.
      this.kept.delete(key);
      this.kept.set(key, found);
    }
    return found;
  }

  set(key: string, diagram: DrawnDiagram): void {
    this.drop(key);
    const size = sizeOf(diagram);
    // One drawing larger than the whole budget is used this once, not kept.
    if (size > this.budget) return;

    this.kept.set(key, diagram);
    this.total += size;
    for (const oldest of this.kept.keys()) {
      if (this.total <= this.budget) break;
      this.drop(oldest);
    }
  }

  /** The bytes held, for a test to see the budget kept. */
  get bytes(): number {
    return this.total;
  }

  private drop(key: string): void {
    const found = this.kept.get(key);
    if (!found) return;
    this.kept.delete(key);
    this.total -= sizeOf(found);
  }
}

function sizeOf(diagram: DrawnDiagram): number {
  return diagram.pictures.reduce((sum, picture) => sum + picture.bytes.byteLength, 0);
}
