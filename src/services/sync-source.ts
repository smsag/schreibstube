/**
 * Validates and normalizes the source URL a note is bound to.
 *
 * The URL comes out of a note's frontmatter, which means the plugin fetches
 * whatever a file in the vault tells it to. That makes it untrusted input, so
 * the rules are narrow on purpose: HTTPS only, Markdown paths only, and GitHub
 * page URLs rewritten to the raw form rather than fetched as HTML.
 */

export const SYNC_FRONTMATTER_KEY = "schreibstubeSyncedFrom";

export type SourceResult =
  | { ok: true; url: string; rewritten: boolean }
  | { ok: false; reason: string };

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd"];

/**
 * Turn a frontmatter value into a URL worth fetching.
 *
 * A GitHub page URL is rewritten to `raw.githubusercontent.com`, because
 * fetching the page itself would store a mountain of HTML into the note.
 */
export function resolveSourceUrl(raw: unknown): SourceResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: "Keine Quell-URL angegeben." };
  }

  const trimmed = raw.trim().replace(/^["'<]|[">']$/g, "");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Quell-URL ist keine gültige URL." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Nur HTTPS-Quellen werden geladen." };
  }

  const rewrite = rewriteGitHubUrl(parsed);
  const target = rewrite ?? parsed;

  // The extension is the filter, on every host. A source without one is either
  // a rendered page or something that is not a document at all.
  if (!hasMarkdownPath(target.pathname)) {
    return { ok: false, reason: "Quelle ist keine Markdown-Datei (.md)." };
  }

  return { ok: true, url: target.toString(), rewritten: rewrite !== null };
}

/** True when a URL is worth showing as a source at all, used to decide whether
 *  a note counts as bound before validation messages matter. */
export function hasSourceBinding(frontmatter: Record<string, unknown> | undefined): boolean {
  const value = frontmatter?.[SYNC_FRONTMATTER_KEY];
  return typeof value === "string" && value.trim().length > 0;
}

function hasMarkdownPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * `github.com/owner/repo/blob/ref/path.md` becomes
 * `raw.githubusercontent.com/owner/repo/ref/path.md`. The `raw` variant of the
 * page URL is handled the same way. Anything else on github.com is left alone
 * and will fail the Markdown check, which is the right answer for a repo or
 * issue URL.
 */
function rewriteGitHubUrl(url: URL): URL | null {
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 5) return null;

  const [owner, repo, kind, ...rest] = segments;
  if (kind !== "blob" && kind !== "raw") return null;

  const rewritten = new URL(
    `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join("/")}`
  );
  return rewritten;
}
