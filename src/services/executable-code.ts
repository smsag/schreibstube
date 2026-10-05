/**
 * Where a note holds code that another plugin runs.
 *
 * Schreibstube never executes what a source sends, but Obsidian is not only
 * Schreibstube: Dataview runs a `dataviewjs` block with the app's full rights
 * the moment the note renders, Templater runs `<% %>` when the note is used as
 * a template, Buttons runs its action on a click. A document mirrored from
 * somebody else's server is somebody else's code once it holds one of those,
 * so an update that touches one has to be looked at, not waved through with
 * the rest.
 *
 * The list is of constructs that run JavaScript or commands by design. A plain
 * `js` fence is shown, not run, and is left alone; flagging every code sample
 * would teach a person to ignore the flag.
 */

import { fenceMarker } from "./markdown-fence";

/** Fence languages whose block another plugin executes. */
export const EXECUTING_FENCE_LANGUAGES: readonly string[] = [
  "dataviewjs",
  "datacorejs",
  "datacorejsx",
  "datacorets",
  "datacoretsx",
  "js-engine",
  "meta-bind-js-view",
  "button"
];

const EXECUTING_FENCES = new Set(EXECUTING_FENCE_LANGUAGES);

/** Dataview's inline JavaScript: an inline code span opening with `$=`. */
const INLINE_DATAVIEW_JS = /`\$=[^`\n]*`/g;

/** A Templater command, which may span lines. */
const TEMPLATER_TAG = /<%[\s\S]*?%>/g;

/** A stretch of the text that runs, and what runs it. */
export interface ExecutableRegion {
  from: number;
  to: number;
  kind: string;
}

/**
 * Every executing construct in `text`, as offsets into it.
 *
 * A fence counts from its opening line to its closing one, both included, and
 * an unclosed fence runs to the end of the text — that is how Obsidian reads
 * it, and so how the plugin running it sees it.
 */
export function findExecutableCode(text: string): ExecutableRegion[] {
  const regions: ExecutableRegion[] = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

  let offset = 0;
  let open: { marker: string; from: number; kind: string | null } | null = null;
  const prose: { from: number; to: number }[] = [];

  for (const line of lines) {
    const marker = fenceMarker(line);
    const end = offset + line.length;

    if (open) {
      if (marker && marker[0] === open.marker[0] && marker.length >= open.marker.length) {
        if (open.kind) regions.push({ from: open.from, to: end, kind: open.kind });
        open = null;
      }
    } else if (marker) {
      const language = fenceLanguage(line, marker);
      open = { marker, from: offset, kind: EXECUTING_FENCES.has(language) ? language : null };
    } else {
      prose.push({ from: offset, to: end });
    }

    offset = end;
  }

  if (open?.kind) regions.push({ from: open.from, to: text.length, kind: open.kind });

  // Inline constructs only count outside fences: inside one they are the
  // fence's text, run or shown by whatever owns the fence.
  for (const span of prose) {
    const slice = text.slice(span.from, span.to);
    for (const match of slice.matchAll(INLINE_DATAVIEW_JS)) {
      regions.push({
        from: span.from + match.index,
        to: span.from + match.index + match[0].length,
        kind: "dataviewjs"
      });
    }
  }

  // A Templater tag may cross lines, so it is looked for in the whole text and
  // kept when it does not start inside a fence.
  for (const match of text.matchAll(TEMPLATER_TAG)) {
    const from = match.index;
    if (!prose.some((span) => from >= span.from && from < span.to)) continue;
    regions.push({ from, to: from + match[0].length, kind: "templater" });
  }

  return regions.sort((a, b) => a.from - b.from);
}

/**
 * The constructs a change of `[from, to)` touches.
 *
 * A change with text touches whatever it overlaps. A pure deletion is a point,
 * and touches a region it falls strictly inside: a line taken out of the middle
 * of a block changes what the block does.
 */
export function executableTouched(
  regions: readonly ExecutableRegion[],
  from: number,
  to: number
): string[] {
  const kinds = regions
    .filter((region) =>
      to > from ? from < region.to && region.from < to : region.from < from && from < region.to
    )
    .map((region) => region.kind);
  return [...new Set(kinds)];
}

function fenceLanguage(line: string, marker: string): string {
  const info = line.trimStart().slice(marker.length).trim();
  return (info.split(/\s+/)[0] ?? "").toLowerCase();
}
