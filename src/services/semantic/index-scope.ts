// Pure folder-scope + note-cap selection for the vault index (Pythia ADR-119/120).
// Kept separate from the Obsidian-bound VaultRagService so the decision logic is
// unit-testable without a vault.

import { EMBEDDING_RUNTIME } from "./embedding-models";

export interface IndexScopeOptions {
  /** Normalized include folders (no trailing slash). Empty = the whole vault. */
  include: string[];
  /** Normalized skip folders (Pythia's own conversations/scratch). */
  skip: string[];
  /** Max notes to index. 0 = unlimited. Protects large vaults from an
   *  over-large index / build (Pythia ADR-120). */
  cap: number;
}

export interface IndexScopeResult {
  /** Selected paths, capped to `cap`. */
  paths: string[];
  /** In-scope count BEFORE the cap (for the "indexing N of M" warning). */
  total: number;
  /** Whether the cap trimmed the selection. */
  capped: boolean;
}

/** True when `path` is inside an include folder (or none is configured) and
 *  outside every skip folder. Folders are matched as path prefixes, so
 *  "Insights" matches "Insights/x.md" but not "Insights-old/y.md". */
export function isPathInScope(path: string, include: string[], skip: string[]): boolean {
  const under = (p: string, f: string) => p === f || p.startsWith(f + "/");
  return (
    (include.length === 0 || include.some((f) => under(path, f))) &&
    !skip.some((f) => under(path, f))
  );
}

/** Select which vault paths to index: those inside an include folder (or all,
 *  when none is configured) and outside every skip folder, trimmed to `cap`. */
export function selectIndexPaths(allPaths: string[], opts: IndexScopeOptions): IndexScopeResult {
  const scoped = allPaths.filter((p) => isPathInScope(p, opts.include, opts.skip));
  const capped = opts.cap > 0 && scoped.length > opts.cap;
  return {
    paths: capped ? scoped.slice(0, opts.cap) : scoped,
    total: scoped.length,
    capped
  };
}

/**
 * What this index is an index OF (Pythia ADR-184): the folders, the skip folders, the
 * note cap, the model and the runtime generation that embedded it. Persisted with the rows, so a session that starts
 * with different settings can tell the file no longer matches them.
 *
 * Narrowing `vaultContextFolders` is the case that matters: until the index is
 * rebuilt it still holds notes that are now out of scope, and retrieval would
 * keep inlining them into prompts. That is a privacy decision the user made
 * and the index has to honour.
 *
 * The generation is here for the same reason: an index finished under an older
 * runtime is not finished under this one. Without it the build would find the file
 * complete and never reach the rows `hashPolicyFor` refuses.
 */
export function scopeSignature(
  s: {
    vaultContextFolders: string[];
    conversationsFolder: string;
    scratchFolder: string;
    vaultContextMaxIndexedNotes: number;
  },
  /** The model's vector FAMILY, not the variant (Pythia ADR-200): the desktop's index
   *  must read as complete on a phone running the vector-identical variant. */
  family: string,
  generation: number = EMBEDDING_RUNTIME.generation
): string {
  const norm = (f: string) => (f ?? "").replace(/\/+$/, "");
  const folders = [...s.vaultContextFolders].map(norm).filter(Boolean).sort();
  const skip = [s.conversationsFolder, s.scratchFolder].map(norm).filter(Boolean).sort();
  const signature: unknown[] = [folders, skip, s.vaultContextMaxIndexedNotes, family];
  // Generation 1 is the four-part form every earlier file carries.
  if (generation > 1) signature.push(generation);
  return JSON.stringify(signature);
}
