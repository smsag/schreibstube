/**
 * Which PDFs a note points at.
 *
 * A PDF can arrive in a note two ways: embedded with `![[Bericht.pdf]]`, so
 * it is visible in the note, or linked with `[[Bericht.pdf]]`, so it is one
 * click away. Both count. Obsidian keeps them in separate lists, and a note
 * that does both would otherwise offer the same file twice.
 *
 * A link may carry a subpath — `Bericht.pdf#page=4` — because the note
 * already has a jump mark in it. The subpath is cut off here: what is wanted
 * is the file, and the page it happens to mention is not a second document.
 */

/** The link paths of a note's embeds and links, as Obsidian records them. */
export interface NoteLinkPaths {
  embeds: string[];
  links: string[];
}

function isPdfPath(linkPath: string): boolean {
  return /\.pdf$/i.test(linkPath);
}

/** Drop a `#page=…` or `#heading` tail, keeping the file it belongs to. */
function withoutSubpath(linkPath: string): string {
  const hash = linkPath.indexOf("#");
  return hash === -1 ? linkPath : linkPath.slice(0, hash);
}

/**
 * Every PDF the note references, once each, embeds before links.
 *
 * Embeds come first because a PDF shown in the note is the one a person means
 * when they say "the attached PDF"; a link further down is the second guess.
 * Order matters only when the caller has to ask which one — and the first
 * option in that list should be the likely answer.
 */
export function pdfReferences(paths: NoteLinkPaths): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of [...paths.embeds, ...paths.links]) {
    const linkPath = withoutSubpath(raw).trim();
    if (linkPath === "" || !isPdfPath(linkPath)) continue;
    const key = linkPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(linkPath);
  }

  return out;
}
