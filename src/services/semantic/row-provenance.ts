// Which rows of a shared index a device may reuse (Pythia ADR-201).
//
// Pythia ADR-200 names index files by VECTOR FAMILY, so a phone on the Latin-script
// variant and a desktop on the full multilingual model read and write the same
// file. That is exact for Latin-script text — the variant's vectors are the full
// model's there — and only there. A note or conversation that contains a
// Cyrillic, Greek or CJK word is embedded differently by the variant (those words
// fall back to single characters). Keyed by content hash alone, such a row looked
// "unchanged" to the other device and was reused forever: the desktop ranked it
// with the phone's degraded vector until the text happened to change.
//
// So a row records, through its hash, whether it could differ from the family's:
//  - a variant writes `<hash>~<tag>` for text it cannot reproduce exactly, and the
//    plain hash for text it can (those rows really are interchangeable);
//  - the full model accepts only the plain hash, so it re-embeds a tagged row;
//  - the variant accepts the plain hash too — the full model's vector is the better
//    one, and refusing it would make the two devices overwrite each other forever.
//
// The index format is unchanged: the tag lives inside the hash string both
// services already compare, so an existing file stays valid.
//
// The runtime generation rides the same string (`EMBEDDING_RUNTIME`): a row embedded
// under generation 2 or later ends in `@g<n>`, and a device accepts only rows of its
// own generation. A row from an older runtime — this plugin's before an upgrade, or
// an index copied from Pythia, whose files predate the mark — is re-embedded, never ranked
// beside the new ones. Generation 1 is the unmarked hash, so files written before
// the mark existed read as what they are.

import { conversationContentHash } from "./embedding-index";
import { EMBEDDING_RUNTIME, embeddingModelConfig, type EmbeddingModelId } from "./embedding-models";

export interface HashPolicy {
  /** The hash this device writes for a row built from `chunks`. */
  rowHash(chunks: string[]): string;
  /** Whether a stored row with `stored` may be reused for `chunks` instead of re-embedding. */
  accepts(stored: string, chunks: string[]): boolean;
}

/** A letter that is not Latin script — the text the Latin-script variant cannot
 *  segment the way the full model does. Deliberately a letter test: digits,
 *  punctuation, symbols and marks are kept by the pruning rule and change nothing. */
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u;

/** Whether the Latin-script variant embeds `chunks` exactly like the full model. */
export function isLatinExact(chunks: string[]): boolean {
  return !chunks.some((c) => NON_LATIN_LETTER.test(c));
}

/** The mark a row of runtime `generation` carries at the end of its hash. */
export function generationMark(generation: number): string {
  return generation > 1 ? `@g${generation}` : "";
}

/** The policy for the model this device embeds with, under the runtime it ships. */
export function hashPolicyFor(
  modelId: EmbeddingModelId,
  generation: number = EMBEDDING_RUNTIME.generation
): HashPolicy {
  const config = embeddingModelConfig(modelId);
  const mark = generationMark(generation);
  if (!config.variantOf) {
    return {
      rowHash: (chunks) => conversationContentHash(chunks) + mark,
      accepts: (stored, chunks) => stored === conversationContentHash(chunks) + mark
    };
  }
  const tag = `~${config.variantNote ?? "variant"}`;
  const exact = config.variantNote === "latinScript" ? isLatinExact : () => false;
  return {
    rowHash: (chunks) => conversationContentHash(chunks) + (exact(chunks) ? "" : tag) + mark,
    accepts: (stored, chunks) => {
      const plain = conversationContentHash(chunks);
      return stored === plain + mark || stored === plain + tag + mark;
    }
  };
}

/** The one reuse decision both index services make: keep the stored row's hash
 *  when this device accepts it, otherwise the hash a fresh embed would carry. */
export function resolveRowHash(
  policy: HashPolicy,
  stored: string | undefined,
  chunks: string[]
): { hash: string; reuse: boolean } {
  if (stored !== undefined && policy.accepts(stored, chunks)) return { hash: stored, reuse: true };
  return { hash: policy.rowHash(chunks), reuse: false };
}
