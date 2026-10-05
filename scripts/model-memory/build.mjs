// Build the embedding bundle exactly as the release does, the model table and
// the pinned runtime module, into scripts/model-memory/out/ for the measuring
// page. See CONTRIBUTING.md.
import esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildEmbeddingBundle } from "../embedding-bundle.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "bundle.mjs"), await buildEmbeddingBundle(esbuild, { minify: true }));
// The page hands the bundle its WebAssembly as the plugin does, from the file
// the release attaches.
const pin = JSON.parse(
  readFileSync(join(here, "../../src/services/semantic/search-runtime.json"), "utf8")
);
copyFileSync(join(here, "../../node_modules", pin.package, pin.source), join(out, "runtime.wasm"));
// And the model pins, which the bundle refuses to load a model without.
copyFileSync(join(here, "../../src/services/semantic/model-pins.json"), join(out, "pins.json"));
const table = await esbuild.build({
  stdin: {
    contents:
      'import { EMBEDDING_MODELS } from "./src/services/semantic/embedding-models";' +
      "export default EMBEDDING_MODELS;",
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false
});
const models = (
  await import(`data:text/javascript,${encodeURIComponent(table.outputFiles[0].text)}`)
).default;
writeFileSync(join(out, "models.json"), JSON.stringify(models));
