/**
 * The title a note gives itself in its own frontmatter.
 *
 * A filename is a handle: short, unique, often a slug, and changing it moves
 * the file and rewrites every link into it. A `title` is what the note is
 * called. Where a row is there to be recognised rather than located — the
 * pinned block, which is a shortlist a person built by hand — the note's own
 * title is the better line to draw, and nothing about the file changes.
 *
 * Pure, because what YAML hands over is not always a string: `title: 2026` is a
 * number, `title: true` a boolean, a folded block a run of lines. Deciding what
 * of that is a title belongs in a function with tests rather than in a view.
 */

/**
 * The note's own title, or null when it does not have one worth showing.
 *
 * A string is taken, trimmed, and folded onto one line: a title that wrapped in
 * the frontmatter is still one title, and a row is one line high. A number is
 * taken too, because a year or a version is a title someone typed without
 * quotes. Everything else — a boolean, a list, a map, a date, an empty string —
 * is not a title, and the caller falls back to the filename.
 */
export function frontmatterTitle(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== "string") return null;

  const title = raw.replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : null;
}
