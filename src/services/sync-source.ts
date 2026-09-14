/**
 * Validates and normalizes the source URL a note is bound to.
 *
 * The URL comes out of a note's frontmatter, which means the plugin fetches
 * whatever a file in the vault tells it to. That makes it untrusted input, so
 * the rules are narrow on purpose: HTTPS only, Markdown paths only, and GitHub
 * page URLs rewritten to the raw form rather than fetched as HTML.
 */

import { t } from "../i18n";

export const SYNC_FRONTMATTER_KEY = "schreibstubeSyncedFrom";

/** Where a source lives, which decides how it is fetched and, crucially,
 *  whether a credential may be attached to the request. */
export type SourceTarget =
  { kind: "github"; owner: string; repo: string; ref: string; path: string } | { kind: "url" };

export type SourceResult =
  | { ok: true; url: string; rewritten: boolean; target: SourceTarget }
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
    return { ok: false, reason: t().source.missing };
  }

  const trimmed = raw.trim().replace(/^["'<]|[">']$/g, "");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: t().source.notAUrl };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: t().source.notHttps };
  }

  const rewrite = rewriteGitHubUrl(parsed);
  const resolved = rewrite?.url ?? parsed;

  // The extension is the filter, on every host. A source without one is either
  // a rendered page or something that is not a document at all.
  if (!hasMarkdownPath(resolved.pathname)) {
    return { ok: false, reason: t().source.notMarkdown };
  }

  return {
    ok: true,
    url: resolved.toString(),
    rewritten: rewrite !== null,
    target: rewrite?.target ?? describeHost(resolved)
  };
}

/** A raw GitHub URL is still a GitHub source, so a private repository works
 *  whether the user pasted the page link or the raw one. */
function describeHost(url: URL): SourceTarget {
  if (url.hostname !== "raw.githubusercontent.com") {
    return { kind: "url" };
  }

  const [owner, repo, ...tail] = url.pathname.split("/").filter(Boolean);
  const split = splitRef(tail);
  if (owner === undefined || repo === undefined || split === null) {
    return { kind: "url" };
  }

  return githubTarget(owner, repo, split);
}

/**
 * The target as the repository names things, not as the URL spells them.
 *
 * The URL parser writes a space as `%20` and an umlaut as its UTF-8 bytes,
 * and the API URL encodes each segment itself. Handed the URL's spelling it
 * encoded the percent sign a second time and asked for `Mein%2520Dokument`,
 * which no repository has. The raw host was handed the URL unchanged and
 * found the file, so again a public repository worked where a private one
 * did not.
 */
function githubTarget(
  owner: string,
  repo: string,
  split: { ref: string; path: string }
): SourceTarget {
  return {
    kind: "github",
    owner: decodeSegment(owner),
    repo: decodeSegment(repo),
    ref: split.ref.split("/").map(decodeSegment).join("/"),
    path: split.path.split("/").map(decodeSegment).join("/")
  };
}

/** A malformed escape is left as written rather than turned into a throw. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Where the ref ends and the file path begins.
 *
 * A raw URL names the ref as one segment — `main`, a tag, a commit — except
 * when GitHub itself wrote it: the "Raw" button has produced
 * `refs/heads/main/…` for some time, and the placeholder in the bind dialogue
 * invites exactly that link. Read as a single segment, the ref came out as
 * `refs` and the branch became the first folder of the path, so the contents
 * API was asked for a file that does not exist and answered 404. The raw host
 * resolved the same URL fine, which is why a public repository worked and a
 * private one, fetched through the API, silently did not.
 *
 * A branch with a slash in its name is still ambiguous here, with or without
 * the prefix, and is read as its first segment; there is nothing in the URL
 * to say otherwise.
 */
function splitRef(segments: string[]): { ref: string; path: string } | null {
  const [first, second, third] = segments;
  if (first === "refs" && (second === "heads" || second === "tags") && third !== undefined) {
    const rest = segments.slice(3);
    return rest.length === 0 ? null : { ref: `${first}/${second}/${third}`, path: rest.join("/") };
  }

  const [ref, ...rest] = segments;
  if (ref === undefined || rest.length === 0) return null;
  return { ref, path: rest.join("/") };
}

/**
 * The binding as the note itself spells it, for when the cache does not have it.
 *
 * Obsidian's metadata cache is updated after a write, not during one, so a
 * check made in the same breath as the binding — which is exactly what happens
 * when somebody has just typed a URL in — asks the cache a question it cannot
 * answer yet and is told the note names no source. Reading the note's own
 * frontmatter answers it now. Only this one key is looked for, and only as a
 * plain line: it is a fallback for a value this plugin wrote itself moments
 * ago, not a YAML parser.
 */
export function sourceUrlFromNote(text: string): string | null {
  return frontmatterLine(text, SYNC_FRONTMATTER_KEY);
}

/**
 * One key's value, read off the note's own frontmatter block.
 *
 * A plain line and not YAML: this is the fallback for a value written moments
 * ago, where the whole of the question is what a single key says.
 */
export function frontmatterLine(text: string, key: string): string | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return null;

  for (const line of (block[1] ?? "").split(/\r?\n/)) {
    const raw = new RegExp(`^${key}\\s*:\\s*(.+)$`).exec(line)?.[1];
    if (raw === undefined) continue;

    const value = raw
      .trim()
      .replace(/^["'<]|[">']$/g, "")
      .trim();
    return value.length > 0 ? value : null;
  }

  return null;
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
function rewriteGitHubUrl(url: URL): { url: URL; target: SourceTarget } | null {
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const [owner, repo, kind, ...tail] = url.pathname.split("/").filter(Boolean);
  const split = splitRef(tail);
  if (owner === undefined || repo === undefined || split === null) {
    return null;
  }
  if (kind !== "blob" && kind !== "raw") return null;

  // The raw host resolves ref and path itself, so the URL keeps the page's
  // own spelling; only the target needs them apart.
  return {
    url: new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${tail.join("/")}`),
    target: githubTarget(owner, repo, split)
  };
}

/** The GitHub contents API endpoint for a source, used when a token is
 *  configured because it is the path that works for a private repository. */
export function githubApiUrl(target: Extract<SourceTarget, { kind: "github" }>): string {
  const path = target.path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return (
    `https://api.github.com/repos/${encodeURIComponent(target.owner)}/` +
    `${encodeURIComponent(target.repo)}/contents/${path}` +
    `?ref=${encodeURIComponent(target.ref)}`
  );
}
