/**
 * Which files in the plugin folder are a source's index.
 *
 * A source's files are `semantic-source-<id>-<family><suffix>`, and an id may
 * hold a hyphen, so `reader-sync`'s files begin with `semantic-source-reader-`
 * as well. Matched on that prefix, refusing `reader` deleted `reader-sync`'s
 * index too, though the person had allowed it. A name is a source's only when
 * a model family follows its id directly, then one of the endings its files
 * have. A file of a model this version no longer knows is left in place: of
 * the two mistakes, a stale file costs a few megabytes, another source's
 * index costs everything it held.
 */
import { EMBEDDING_MODEL_IDS, vectorFamily } from "./embedding-models";

const FAMILIES = [...new Set(EMBEDDING_MODEL_IDS.map(vectorFamily))];

/** The index, its two journals, a write's leftovers, iCloud's numbered copies. */
const ENDING = /^(?:\.journal|\.phone-journal)?(?: [1-9]\d{0,5})?\.bin(?:\.tmp|\.old)?$/;

export function isSourceFileName(name: string, sourceId: string): boolean {
  const prefix = `semantic-source-${sourceId}-`;
  if (!name.startsWith(prefix)) return false;
  const rest = name.slice(prefix.length);
  return FAMILIES.some(
    (family) => rest.startsWith(family) && ENDING.test(rest.slice(family.length))
  );
}
