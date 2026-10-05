/**
 * Put the search runtime's WebAssembly beside the release files, and prove it
 * is the one the plugin expects.
 *
 * The file is onnxruntime-web's own, taken from the tree `npm ci` installed —
 * the tree the bundle was built from, so the module and the JavaScript that
 * starts it come from one package at one version. The pin is
 * `src/services/semantic/search-runtime.json`, which the plugin reads too; a
 * file that does not match it fails the release rather than publishing
 * something every device would refuse to load.
 *
 *   node scripts/stage-search-runtime.mjs           # verify and write to dist/
 *   node scripts/stage-search-runtime.mjs --print   # print the pin, for a bump
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pin = JSON.parse(
  readFileSync(join(root, "src/services/semantic/search-runtime.json"), "utf8")
);
const packageDir = join(root, "node_modules", pin.package);
const installed = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
const bytes = readFileSync(join(packageDir, pin.source));
const sha256 = createHash("sha256").update(bytes).digest("hex");

if (process.argv.includes("--print")) {
  console.log(
    JSON.stringify(
      {
        ...pin,
        version: installed,
        name: `search-runtime-${installed}.wasm`,
        sha256,
        bytes: bytes.length
      },
      null,
      2
    )
  );
} else {
  const problems = [];
  if (installed !== pin.version) problems.push(`installed ${installed}, pinned ${pin.version}`);
  if (bytes.length !== pin.bytes) problems.push(`${bytes.length} bytes, pinned ${pin.bytes}`);
  if (sha256 !== pin.sha256) problems.push(`sha256 ${sha256}, pinned ${pin.sha256}`);
  if (problems.length > 0) {
    console.error(
      `${pin.package}/${pin.source} is not what the plugin expects:\n  ${problems.join("\n  ")}\n` +
        "Run with --print and update src/services/semantic/search-runtime.json deliberately."
    );
    process.exitCode = 1;
  } else {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", pin.name), bytes);
    console.log(`${pin.name} verified (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
  }
}
