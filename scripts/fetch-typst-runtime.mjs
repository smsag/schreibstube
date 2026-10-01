/**
 * Build the two runtime files a release attaches, and prove they are the ones
 * the plugin expects.
 *
 * The plugin runs Typst as WebAssembly, fetched once per device. Those bytes
 * are executed, so they are pinned: `src/services/typst-runtime.ts` holds the
 * hashes, this script downloads the package, extracts the two files and checks
 * them. A mismatch fails the release rather than publishing something the
 * plugin would then refuse to load.
 *
 * The fonts go the same way. The typesetter has no typeface of its own, so
 * each set in `src/services/typst-fonts.json` is fetched from its upstream at
 * the pinned tag or commit, checked, and attached beside the compiler.
 *
 *   node scripts/fetch-typst-runtime.mjs           # verify and write to dist/
 *   node scripts/fetch-typst-runtime.mjs --print   # print the hashes, for a bump
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Above the code that runs: the top level executes as the module loads, and a
// class, unlike a function, does not exist until its line has. Declared any
// lower, `fail` and the catch's `instanceof Failure` throw a ReferenceError in
// place of the message.
class Failure extends Error {}

function fail(message) {
  throw new Failure(message);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = readFileSync(join(root, "src/services/typst-runtime.ts"), "utf8");

const version = read(/RUNTIME_VERSION = "([^"]+)"/, "RUNTIME_VERSION");
// The fonts are read from the JSON the plugin imports, so there is one copy of
// every hash and nothing to parse out of TypeScript.
const fontSets = JSON.parse(readFileSync(join(root, "src/services/typst-fonts.json"), "utf8")).sets;
const fonts = fontSets.flatMap((set) =>
  set.files.map(({ file, sha256 }) => ({
    file,
    sha256,
    url: `${set.source}${file}`,
    name: `typst-runtime-fonts-${set.version}-${file}`
  }))
);
const packageName = read(/RUNTIME_PACKAGE = "([^"]+)"/, "RUNTIME_PACKAGE");
const assets = [
  ...manifest.matchAll(
    /name: `([^`]+)`,\s*\n\s*sha256: "([0-9a-f]{64})",\s*\n\s*label: "(compiler|loader)"/g
  )
].map(([, name, sha256, label]) => ({
  name: name.replace("${RUNTIME_VERSION}", version),
  sha256,
  key: label === "compiler" ? "WASM_ASSET" : "LOADER_ASSET"
}));
const sources = Object.fromEntries(
  [...manifest.matchAll(/\[(\w+)\.name]: "([^"]+)"/g)].map(([, key, path]) => [key, path])
);

if (assets.length !== 2) {
  fail(`expected two pinned assets in typst-runtime.ts, found ${assets.length}`);
}

const printOnly = process.argv.includes("--print");
const work = mkdtempSync(join(tmpdir(), "typst-runtime-"));

// A font is a couple of megabytes; a download that is not one is not a font,
// and a stalled one is not waited on for the six hours a CI runner allows.
const FETCH_TIMEOUT_MS = 60_000;
const MAX_FONT_BYTES = 8 * 1024 * 1024;

try {
  execFileSync("npm", ["pack", `${packageName}@${version}`, "--pack-destination", work], {
    stdio: ["ignore", "ignore", "inherit"]
  });
  const tarball = readdirSync(work).find((name) => name.endsWith(".tgz"));
  if (!tarball) fail(`npm pack left no tarball in ${work}`);
  execFileSync("tar", ["-xzf", join(work, tarball), "-C", work]);

  const out = join(root, "dist");
  if (!printOnly) mkdirSync(out, { recursive: true });

  let failed = false;
  for (const asset of assets) {
    const source = sources[asset.key];
    if (!source) fail(`no source path for ${asset.key}`);

    const bytes = readFileSync(join(work, source));
    const actual = createHash("sha256").update(bytes).digest("hex");

    if (printOnly) {
      console.log(`${asset.name}\n  ${actual}  (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
      continue;
    }

    if (actual !== asset.sha256) {
      console.error(
        `${asset.name} does not match what the plugin expects.\n` +
          `  pinned:  ${asset.sha256}\n  package: ${actual}\n` +
          "Run with --print and update src/services/typst-runtime.ts deliberately."
      );
      failed = true;
      continue;
    }

    writeFileSync(join(out, asset.name), bytes);
    console.log(`${asset.name} verified (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  if (fonts.length === 0) fail("no pinned fonts found in typst-fonts.json");
  for (const font of fonts) {
    const response = await fetch(font.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) fail(`${font.file}: HTTP ${response.status} from ${font.url}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_FONT_BYTES) fail(`${font.file}: ${declared} bytes is not a font`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_FONT_BYTES) fail(`${font.file}: ${bytes.length} bytes is not a font`);
    const actual = createHash("sha256").update(bytes).digest("hex");

    if (printOnly) {
      console.log(`${font.file}\n  ${actual}  (${(bytes.length / 1024).toFixed(0)} KB)`);
      continue;
    }
    if (actual !== font.sha256) {
      console.error(
        `${font.file} does not match what the plugin expects.\n` +
          `  pinned:  ${font.sha256}\n  fetched: ${actual}`
      );
      failed = true;
      continue;
    }
    writeFileSync(join(out, font.name), bytes);
    console.log(`${font.name} verified (${(bytes.length / 1024).toFixed(0)} KB)`);
  }

  if (failed) process.exitCode = 1;
} catch (error) {
  // `process.exit` inside the `try` would skip the `finally` and leave the
  // 30 MB work directory behind on every failure; a thrown failure does not.
  console.error(error instanceof Failure ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}

function read(pattern, what) {
  const match = pattern.exec(manifest);
  if (!match) fail(`${what} not found in src/services/typst-runtime.ts`);
  return match[1];
}
