// Build the embedding bundle exactly as the release does, and the model table,
// into scripts/model-memory/out/ for the measuring page. See CONTRIBUTING.md.
import esbuild from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });
const bundle = await esbuild.build({
  entryPoints: ["src/controllers/semantic/host/frame/entry.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "esnext",
  write: false,
  minify: true,
  logLevel: "warning"
});
writeFileSync(join(out, "bundle.mjs"), bundle.outputFiles[0].text);
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
