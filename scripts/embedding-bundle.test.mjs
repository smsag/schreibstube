import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import esbuild from "esbuild";
import { buildEmbeddingBundle, CODE_CDNS, withoutCdnDefault } from "./embedding-bundle.mjs";
import { withWorkerPrelude } from "../src/controllers/semantic/host/worker-prelude.ts";

// The file esbuild bundles for a browser; the package's exports do not name it.
const transformersWeb = readFileSync(
  new URL("../node_modules/@huggingface/transformers/dist/transformers.web.js", import.meta.url),
  "utf8"
);

/**
 * Built once for the file, minified as the release builds it: what is checked
 * is the text main.js carries, not the sources it was made from.
 */
const bundle = await buildEmbeddingBundle(esbuild, { minify: true });

describe("withoutCdnDefault", () => {
  it("takes the CDN out of the transformers.js this lockfile installs", () => {
    expect(transformersWeb).toContain("cdn.jsdelivr.net");
    const edited = withoutCdnDefault(transformersWeb);
    expect(edited).not.toContain("cdn.jsdelivr.net");
    expect(edited).toContain('"unpinned-runtime-refused:"');
  });

  it("fails the build when a new version no longer holds the default once", () => {
    expect(() => withoutCdnDefault("export const nothing = 1;")).toThrow(/0 times, not once/);
    const twice = withoutCdnDefault(transformersWeb).replace(
      '"unpinned-runtime-refused:"',
      "`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_ENV.versions.web}/dist/`"
    );
    expect(() => withoutCdnDefault(twice + twice)).toThrow(/2 times, not once/);
  });
});

describe("the embedding bundle", () => {
  it("names no CDN, so no path in it fetches code from one", () => {
    for (const host of CODE_CDNS) expect(bundle).not.toContain(host);
  });

  it("runs onnxruntime-web's WebAssembly-only build, whose glue it carries", () => {
    // The WebGPU build would bring the JSEP and asyncify glue; the bundle
    // carries the plain one, which matches the pinned module.
    expect(bundle).not.toMatch(/ort-wasm-simd-threaded\.(jsep|jspi|asyncify)\.(mjs|wasm)/);
    expect(bundle).toContain("ort-wasm-simd-threaded.wasm");
  });

  it("still parses as a module with the Worker prelude in front of it", async () => {
    // A top-level declaration of a name the prelude shadows would be a
    // SyntaxError the Worker reports as "failed to start", nothing more.
    await expect(
      esbuild.transform(withWorkerPrelude(bundle), { loader: "js", format: "esm" })
    ).resolves.toBeDefined();
  });
});
