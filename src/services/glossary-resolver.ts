/**
 * Decides which glossaries apply to a note.
 *
 * Four sources, and the first that yields anything wins outright. Merging them
 * was the obvious alternative and was rejected: a user who sets a glossary on a
 * note needs that to be the whole answer, not a contribution to a set they
 * cannot see.
 */

export type GlossarySelectionSource = "frontmatter" | "folder" | "session" | "default" | "none";

export interface FolderRule {
  /** Vault folder path the rule applies to, including everything beneath it. */
  folder: string;
  glossaries: string[];
}

export interface GlossarySelectionInput {
  /** Path of the note being reviewed. */
  notePath: string;
  /** Glossaries named in the note's own frontmatter. */
  frontmatter?: string[];
  folderRules?: FolderRule[];
  /**
   * The user's pick in the panel header for this note. Undefined means they
   * have not touched it; an empty array is an explicit "no glossary" and is
   * honoured rather than falling through to the default.
   */
  session?: string[] | undefined;
  /** The vault-wide fallback from settings. */
  fallback?: string[];
}

export interface GlossarySelection {
  paths: string[];
  source: GlossarySelectionSource;
}

export function resolveGlossarySelection(input: GlossarySelectionInput): GlossarySelection {
  const frontmatter = clean(input.frontmatter);
  if (frontmatter.length > 0) {
    return { paths: frontmatter, source: "frontmatter" };
  }

  const folder = clean(matchFolderRule(input.notePath, input.folderRules ?? [])?.glossaries);
  if (folder.length > 0) {
    return { paths: folder, source: "folder" };
  }

  if (input.session !== undefined) {
    const session = clean(input.session);
    return session.length > 0
      ? { paths: session, source: "session" }
      : { paths: [], source: "none" };
  }

  const fallback = clean(input.fallback);
  if (fallback.length > 0) {
    return { paths: fallback, source: "default" };
  }

  return { paths: [], source: "none" };
}

/** The most specific folder rule containing the note. Deeper folders win, so a
 *  client folder can override the rule set for the project above it. */
export function matchFolderRule(notePath: string, rules: FolderRule[]): FolderRule | null {
  let best: FolderRule | null = null;

  for (const rule of rules) {
    const folder = normalizeFolder(rule.folder);
    if (!containsPath(folder, notePath)) continue;
    if (!best || normalizeFolder(best.folder).length < folder.length) {
      best = rule;
    }
  }

  return best;
}

/** Parse the settings text area: one rule per line, `folder | a.md, b.md`. */
export function parseFolderRules(text: string): FolderRule[] {
  const rules: FolderRule[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("|");
    if (separator === -1) continue;

    const folder = trimmed.slice(0, separator).trim();
    const glossaries = clean(trimmed.slice(separator + 1).split(","));
    if (!folder || glossaries.length === 0) continue;

    rules.push({ folder, glossaries });
  }

  return rules;
}

export function formatFolderRules(rules: FolderRule[]): string {
  return rules.map((rule) => `${rule.folder} | ${rule.glossaries.join(", ")}`).join("\n");
}

/** Split a frontmatter value that may be a single path, a comma list, or a
 *  YAML-ish inline list, and strip wikilink brackets from each entry. */
export function parseGlossaryList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return clean(value.map((entry) => String(entry)));
  }
  if (typeof value !== "string") {
    return [];
  }

  // A value that opens with `[[` is a wikilink, not an inline list, so the
  // outer-bracket strip has to stand aside and let `clean` unwrap it.
  const trimmed = value.trim();
  const inner = trimmed.startsWith("[[") ? trimmed : trimmed.replace(/^\[(.*)\]$/s, "$1");
  return clean(inner.split(","));
}

function clean(values: string[] | undefined): string[] {
  if (!values) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of values) {
    const value = String(raw)
      .trim()
      // A wikilink may carry an alias or a heading, and neither is part of the
      // path: `[[Glossar|G]]` used to resolve to a file called "Glossar|G",
      // which the picker had just offered and the note then reported missing.
      .replace(/^\[\[([^\]|#]*)(?:[#|][^\]]*)?\]\]$/s, "$1")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, "");
}

function containsPath(folder: string, notePath: string): boolean {
  if (folder === "" || folder === "/") return true;
  return notePath === folder || notePath.startsWith(`${folder}/`);
}
