/**
 * Read a user's stack trace against a release's source map.
 *
 *   npm run trace -- 1.23.0 "at t.onload (plugin:schreibstube:12:48213)"
 *   pbpaste | npm run trace -- 1.23.0
 *   npm run trace -- ./main.js.map < report.txt
 *
 * The first argument is a release tag, whose main.js.map is fetched from the
 * GitHub release, or a path to a map on disk. The trace comes from the
 * remaining arguments or from stdin. Every position the map knows is rewritten
 * to its TypeScript file, line and column; everything else passes through.
 */
import { readFileSync, existsSync } from "node:fs";
import { createMapper, rewriteTrace } from "./source-map.mjs";

const REPO = "smsag/schreibstube";

const [where, ...rest] = process.argv.slice(2);
if (!where) {
  console.error("Usage: npm run trace -- <release-tag | path/to/main.js.map> [stack trace]");
  process.exit(1);
}

const map = existsSync(where)
  ? JSON.parse(readFileSync(where, "utf8"))
  : await fetchReleaseMap(where);
const trace = rest.length > 0 ? rest.join(" ") : readFileSync(0, "utf8");

process.stdout.write(rewriteTrace(trace, createMapper(map)));
if (!trace.endsWith("\n")) process.stdout.write("\n");

async function fetchReleaseMap(tag) {
  const url = `https://github.com/${REPO}/releases/download/${tag}/main.js.map`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(
      `No main.js.map on release ${tag} (HTTP ${response.status}).\n` +
        "Releases before 1.23.0 shipped the map inside main.js; for those, the trace already names TypeScript lines."
    );
    process.exit(1);
  }
  return response.json();
}
