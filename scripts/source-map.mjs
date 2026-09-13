/**
 * Enough of the source map format to read a stack trace.
 *
 * The release ships a minified main.js and, beside it, the map that esbuild
 * wrote. A user's stack trace names positions in the former; this turns them
 * into positions in the TypeScript. Written by hand rather than pulled in as a
 * dependency because the format is one line of VLQ per generated line and the
 * decoder fits on a screen.
 *
 * Everything here is pure, which is what makes it testable without a release.
 */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode one segment of variable-length quantities. */
export function decodeVlq(segment) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) throw new Error(`Not a base64 VLQ character: ${JSON.stringify(char)}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >> 1) : value >> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

/**
 * Turn a map into a lookup: generated line, generated column → original
 * position. Lines and columns are 1-based on both sides, which is how a stack
 * trace prints them.
 */
export function createMapper(map) {
  if (map?.version !== 3 || typeof map.mappings !== "string") {
    throw new Error("Not a version 3 source map.");
  }

  const lines = [];
  let source = 0;
  let line = 0;
  let column = 0;
  let name = 0;

  for (const generatedLine of map.mappings.split(";")) {
    const segments = [];
    let generatedColumn = 0;
    for (const raw of generatedLine.split(",")) {
      if (!raw) continue;
      const fields = decodeVlq(raw);
      generatedColumn += fields[0];
      if (fields.length >= 4) {
        source += fields[1];
        line += fields[2];
        column += fields[3];
        if (fields.length >= 5) name += fields[4];
        segments.push({
          generatedColumn,
          source: map.sources[source],
          line: line + 1,
          column: column + 1,
          name: fields.length >= 5 ? map.names[name] : undefined
        });
      }
    }
    lines.push(segments);
  }

  return {
    /** The original position, or null when the map has nothing for it. */
    lookup(generatedLine, generatedColumn) {
      const segments = lines[generatedLine - 1];
      if (!segments || segments.length === 0) return null;
      // Segments are in generated-column order: the last one at or before the
      // column is the one that produced it.
      let low = 0;
      let high = segments.length - 1;
      let found = null;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (segments[mid].generatedColumn <= generatedColumn - 1) {
          found = segments[mid];
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return found
        ? { source: found.source, line: found.line, column: found.column, name: found.name }
        : null;
    }
  };
}

/**
 * The shapes a position takes in a trace from Obsidian's console.
 *
 * Electron names the plugin's script `plugin:schreibstube`; the same trace
 * copied from a file or a devtools pane can say `main.js` or a full path to
 * it. Line and column are what matter.
 */
const POSITION = /(?:plugin:schreibstube|(?:[\w./\\:-]*[/\\])?main\.js):(\d+):(\d+)/g;

/**
 * Rewrite every position in a trace. Lines that carry none pass through, so
 * a whole console dump can be pasted rather than one line at a time.
 */
export function rewriteTrace(trace, mapper) {
  return trace.replace(POSITION, (whole, lineText, columnText) => {
    const original = mapper.lookup(Number(lineText), Number(columnText));
    if (!original) return `${whole} (not in map)`;
    const at = `${original.source}:${original.line}:${original.column}`;
    return original.name ? `${at} ${original.name}` : at;
  });
}
