/**
 * The wire protocol for a proof-read run: what is sent, and how the answer is
 * read back.
 *
 * Blocks travel with explicit markers and come back the same way, so a response
 * that reorders or loses one is detectable instead of being silently misaligned
 * with the document. The model is asked for clean prose only. It is never asked
 * for offsets, line numbers, or a diff, because those are the parts it would
 * get wrong and the parts the local diff derives reliably.
 *
 * Kept free of Obsidian imports so it can be tested directly; the request side
 * lives in llm-proofread.
 */

import type { TermConstraint } from "./glossary-matcher";
import type { ProseBlock } from "./markdown-segments";
import { DEFAULT_PROOFREAD_PROMPT } from "./plugin-settings";

const MARKER_PREFIX = "<<<";
const MARKER_SUFFIX = ">>>";

/** Constraints are capped so a large glossary cannot crowd out the text. The
 *  local scan still catches every term, so nothing is lost by truncating here. */
const MAX_PROMPT_CONSTRAINTS = 40;

/** Rules that keep a response mechanically usable. Separate from the user's
 *  editable prompt so a customized prompt cannot break the protocol. */
const PROTOCOL_RULES =
  "Regeln für die Antwort:\n" +
  `- Gib jeden Abschnitt exakt mit seiner Markierung ${MARKER_PREFIX}id${MARKER_SUFFIX} in einer eigenen Zeile zurück.\n` +
  "- Gib alle Abschnitte zurück, in derselben Reihenfolge, auch unveränderte.\n" +
  "- Übernimm Platzhalter wie §P0§ unverändert und vollständig.\n" +
  "- Erhalte Markdown-Zeichen am Zeilenanfang (#, -, >, Ziffern) unverändert.\n" +
  "- Keine Erklärungen, keine Kommentare, kein Vorspann.";

export function buildProofreadSystemPrompt(
  basePrompt: string,
  constraints: TermConstraint[] = []
): string {
  const parts = [basePrompt.trim() || DEFAULT_PROOFREAD_PROMPT, PROTOCOL_RULES];

  const glossaryBlock = formatConstraints(constraints);
  if (glossaryBlock) {
    parts.splice(1, 0, glossaryBlock);
  }

  return parts.join("\n\n");
}

/** Only forbidden terms reach the prompt. Admitted ones are noise, and the
 *  preferred spelling is implied by the replacement. */
function formatConstraints(constraints: TermConstraint[]): string {
  if (constraints.length === 0) return "";

  const lines = constraints.slice(0, MAX_PROMPT_CONSTRAINTS).map((constraint) => {
    const base = constraint.use
      ? `- "${constraint.avoid}" → "${constraint.use}"`
      : `- "${constraint.avoid}" vermeiden`;
    return constraint.note ? `${base} (${constraint.note})` : base;
  });

  return `Hausglossar, verbindlich:\n${lines.join("\n")}`;
}

/** Serialize a chunk for the request body. */
export function encodeChunk(blocks: ProseBlock[]): string {
  return blocks
    .map((block) => `${MARKER_PREFIX}${block.id}${MARKER_SUFFIX}\n${block.masked}`)
    .join("\n\n");
}

/**
 * Read a response back into rewrites by block id.
 *
 * Only ids that were sent are accepted, so an invented marker is dropped rather
 * than matched against an unrelated block. A block the response never mentions
 * is simply absent, which the runner treats as "no change proposed".
 */
export function parseChunkResponse(response: string, blocks: ProseBlock[]): Map<string, string> {
  const expected = new Set(blocks.map((block) => block.id));
  const rewrites = new Map<string, string>();

  const pattern = /^<<<(\S+?)>>>[ \t]*$/gm;
  const markers: { id: string; from: number; to: number }[] = [];

  for (const match of response.matchAll(pattern)) {
    if (match.index === undefined) continue;
    markers.push({
      id: match[1],
      from: match.index,
      to: match.index + match[0].length
    });
  }

  markers.forEach((marker, index) => {
    if (!expected.has(marker.id) || rewrites.has(marker.id)) return;
    const end = index + 1 < markers.length ? markers[index + 1].from : response.length;
    rewrites.set(marker.id, trimBlockBody(response.slice(marker.to, end)));
  });

  return rewrites;
}

/** Strip the newlines the markers introduce without touching indentation the
 *  block itself carries. */
function trimBlockBody(body: string): string {
  return body.replace(/^\r?\n/, "").replace(/\r?\n\s*$/, "");
}

/** Token budget for one chunk. Output is about as long as input, so the budget
 *  follows the chunk size and the user's cap is the ceiling, not the target. */
export function tokensForChunk(blocks: ProseBlock[], maxTokens: number): number {
  const chars = blocks.reduce((total, block) => total + block.masked.length + 16, 0);
  return Math.max(256, Math.min(maxTokens, Math.ceil(chars / 2)));
}
