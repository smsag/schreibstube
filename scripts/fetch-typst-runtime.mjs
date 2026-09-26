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
 * The standard fonts go the same way. The typesetter has no typeface of its
 * own, so the faces Typst defaults to are fetched from typst-assets at the
 * pinned tag, checked, and attached beside the compiler.
 *
 *   node scripts/fetch-typst-runtime.mjs           # verify and write to dist/
 *   node scripts/fetch-typst-runtime.mjs --print   # print the hashes, for a bump
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = readFileSync(join(root, "src/services/typst-runtime.ts"), "utf8");

const version = read(/RUNTIME_VERSION = "([^"]+)"/, "RUNTIME_VERSION");
const fontsVersion = read(/FONTS_VERSION = "([^"]+)"/, "FONTS_VERSION");
const fontSource = read(/FONT_SOURCE = `([^`]+)`/, "FONT_SOURCE").replace(
  "${FONTS_VERSION}",
  fontsVersion
);
// Whitespace-tolerant, because Prettier wraps a long entry over three lines —
// which this once did not allow for, and it found three fonts of eight.
const fonts = [
  ...manifest.matchAll(/\[\s*"([\w.-]+\.(?:otf|ttf))",\s*"([0-9a-f]{64})"\s*,?\s*\]/g)
].map(([, file, sha256]) => ({
  file,
  sha256,
  name: `typst-runtime-fonts-${fontsVersion}-${file}`
}));
// Every font file the manifest names must have been read with its hash; one
// the pattern missed would be left out of the release, and a device would
// then fail to fetch it on its first print.
const named = manifest.match(/"[\w.-]+\.(?:otf|ttf)"/g) ?? [];
if (named.length !== fonts.length) {
  fail(
    `typst-runtime.ts names ${named.length} font files, but ${fonts.length} were read with a hash`
  );
}
const packageName = read(/RUNTIME_PACKAGE = "([^"]+)"/, "RUNTIME_PACKAGE");
const assets = [...manifest.matchAll(/name: `([^`]+)`,\s*\n\s*sha256: "([0-9a-f]{64})"/g)].map(
  ([, name, sha256]) => ({ name: name.replace("${RUNTIME_VERSION}", version), sha256 })
);
const sources = Object.fromEntries(
  [...manifest.matchAll(/\[(\w+)\.name]: "([^"]+)"/g)].map(([, key, path]) => [key, path])
);

if (assets.length !== 2) {
  fail(`expected two pinned assets in typst-runtime.ts, found ${assets.length}`);
}

const printOnly = process.argv.includes("--print");
const work = mkdtempSync(join(tmpdir(), "typst-runtime-"));

try {
  execFileSync("npm", ["pack", `${packageName}@${version}`, "--pack-destination", work], {
    stdio: ["ignore", "ignore", "inherit"]
  });
  const tarball = execFileSync("ls", [work], { encoding: "utf8" }).trim().split("\n")[0];
  execFileSync("tar", ["-xzf", join(work, tarball), "-C", work]);

  const out = join(root, "dist");
  if (!printOnly) mkdirSync(out, { recursive: true });

  let failed = false;
  for (const [index, asset] of assets.entries()) {
    // The order in the manifest is the order the keys are declared in.
    const key = index === 0 ? "WASM_ASSET" : "LOADER_ASSET";
    const source = sources[key];
    if (!source) fail(`no source path for ${key}`);

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

  if (fonts.length === 0) fail("no pinned fonts found in typst-runtime.ts");
  for (const font of fonts) {
    const response = await fetch(`${fontSource}${font.file}`);
    if (!response.ok) fail(`${font.file}: HTTP ${response.status} from typst-assets`);
    const bytes = Buffer.from(await response.arrayBuffer());
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

  if (failed) process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}

function read(pattern, what) {
  const match = pattern.exec(manifest);
  if (!match) fail(`${what} not found in src/services/typst-runtime.ts`);
  return match[1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
