/**
 * A mail carries a note's diagrams as numbered figures.
 *
 * No mail client can draw a Vizardry canvas or a Mermaid chart, so the plugin
 * draws them and attaches the pictures. The body stays plain text: where a
 * diagram stood, a line names the figure and its attachment, as a letter
 * would — "[Abbildung 1: SWOT — im Anhang: abbildung-1.png]".
 *
 * The limits are the bridge's own. A diagram that would pass one is sent as its
 * source instead, as one that could not be drawn is, and counted, so that the
 * dialogue can say so before the mail leaves: unlike a page, a mail cannot be
 * corrected afterwards.
 */
import {
  MAX_MAIL_ATTACHMENT_BYTES,
  MAX_MAIL_ATTACHMENTS,
  MAX_MAIL_ATTACHMENTS_TOTAL_BYTES
} from "./mail-protocol";
import { diagramAlt, replaceFences, type DiagramFence } from "./publish-diagrams";

/** Every fence a mail client cannot draw: the canvases, and Mermaid too. */
export const MAIL_DIAGRAM_LANGUAGES: ReadonlySet<string> = new Set(["vizardry", "mermaid"]);

export interface MailFigureWords {
  /** "Abbildung", "Figure": the word before the number, and the file's name. */
  figure: string;
  /** How the line says where the picture is. */
  attached: (filename: string) => string;
}

export interface DrawnFigure {
  pictures: readonly Uint8Array[];
  /** What the drawing calls itself; may be empty. */
  title: string;
}

export interface MailAttachmentDraft {
  filename: string;
  bytes: Uint8Array;
}

export interface MailFigures {
  /** The note's Markdown with each attached diagram replaced by its lines. */
  markdown: string;
  attachments: MailAttachmentDraft[];
  /** Diagrams sent as their source: not drawn, or past a limit. */
  undrawn: number;
}

export function mailFigures(
  markdown: string,
  fences: readonly DiagramFence[],
  drawn: ReadonlyMap<number, DrawnFigure>,
  words: MailFigureWords
): MailFigures {
  const attachments: MailAttachmentDraft[] = [];
  const lines = new Map<number, string[]>();
  const stem = fileStem(words.figure);
  let total = 0;
  let undrawn = 0;

  for (const fence of fences) {
    const figure = drawn.get(fence.index);
    const pictures = figure?.pictures ?? [];
    const size = pictures.reduce((sum, bytes) => sum + bytes.byteLength, 0);

    // A diagram goes whole or not at all: half a carousel, attached, would say
    // nothing about the half that was left out.
    const fits =
      pictures.length > 0 &&
      attachments.length + pictures.length <= MAX_MAIL_ATTACHMENTS &&
      pictures.every((bytes) => bytes.byteLength <= MAX_MAIL_ATTACHMENT_BYTES) &&
      total + size <= MAX_MAIL_ATTACHMENTS_TOTAL_BYTES;
    if (!figure || !fits) {
      undrawn += 1;
      continue;
    }

    const title = diagramAlt(figure.title, "");
    const placed: string[] = [];
    for (const bytes of pictures) {
      const number = attachments.length + 1;
      const filename = `${stem}-${number}.png`;
      attachments.push({ filename, bytes });
      const label = title ? `${words.figure} ${number}: ${title}` : `${words.figure} ${number}`;
      placed.push(`[${label} — ${words.attached(filename)}]`);
    }
    total += size;
    lines.set(fence.index, placed);
  }

  return { markdown: replaceFences(markdown, fences, lines), attachments, undrawn };
}

/** The figure word as the start of a file name every mail client saves as it is. */
function fileStem(word: string): string {
  const stem = word
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem || "figure";
}
