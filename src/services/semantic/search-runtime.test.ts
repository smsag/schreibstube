import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMBEDDING_RUNTIME } from "./embedding-models";
import {
  checkSearchRuntime,
  checkSearchRuntimeSize,
  isSearchRuntimeError,
  MAX_SEARCH_RUNTIME_BYTES,
  SEARCH_RUNTIME,
  SearchRuntimeError,
  searchRuntimePath,
  searchRuntimeUrl,
  staleSearchRuntimeFiles
} from "./search-runtime";

const installed = new URL(
  `../../../node_modules/${SEARCH_RUNTIME.package}/${SEARCH_RUNTIME.source}`,
  import.meta.url
);

/**
 * The pin is checked against the file the lockfile installs, so a dependency
 * bump that forgets to move the hash fails here, on the pull request, rather
 * than in the release job or on a device that refuses the download.
 */
describe("the pinned search runtime", () => {
  it("is the file the installed onnxruntime-web carries, byte for byte", () => {
    const bytes = readFileSync(installed);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(SEARCH_RUNTIME.sha256);
    expect(bytes.length).toBe(SEARCH_RUNTIME.bytes);
  });

  it("is from the onnxruntime-web the lockfile installs and the bundle is built from", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL(`../../../node_modules/${SEARCH_RUNTIME.package}/package.json`, import.meta.url),
        "utf8"
      )
    ) as { version: string };
    expect(SEARCH_RUNTIME.version).toBe(manifest.version);
    expect(SEARCH_RUNTIME.version).toBe(EMBEDDING_RUNTIME.onnxruntimeWeb);
  });

  it("is the plain single-threaded build, whose JavaScript the bundle carries", () => {
    expect(SEARCH_RUNTIME.source).toBe("dist/ort-wasm-simd-threaded.wasm");
  });

  it("is named by its version, so a bump never meets the old file under the new name", () => {
    expect(SEARCH_RUNTIME.name).toBe(`search-runtime-${SEARCH_RUNTIME.version}.wasm`);
    expect(SEARCH_RUNTIME.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fits under the bound a device reads, with room for a bump", () => {
    expect(statSync(installed).size).toBeLessThan(MAX_SEARCH_RUNTIME_BYTES);
  });

  it("comes from the release of the installed version and is kept beside the plugin", () => {
    expect(searchRuntimeUrl("1.76.0")).toBe(
      `https://github.com/smsag/schreibstube/releases/download/1.76.0/${SEARCH_RUNTIME.name}`
    );
    expect(searchRuntimePath(".obsidian/plugins/schreibstube/")).toBe(
      `.obsidian/plugins/schreibstube/${SEARCH_RUNTIME.name}`
    );
  });
});

describe("checkSearchRuntime", () => {
  it("passes the pinned length and hash", () => {
    expect(checkSearchRuntime(SEARCH_RUNTIME.bytes, SEARCH_RUNTIME.sha256)).toBeNull();
  });

  it("refuses another length before a hash is looked at", () => {
    expect(checkSearchRuntimeSize(SEARCH_RUNTIME.bytes)).toBeNull();
    expect(checkSearchRuntimeSize(12)).toBe(
      `${SEARCH_RUNTIME.name}: expected ${SEARCH_RUNTIME.bytes} bytes, got 12`
    );
    expect(checkSearchRuntime(12, SEARCH_RUNTIME.sha256)).toContain("got 12");
  });

  it("refuses the right length with the wrong bytes", () => {
    expect(checkSearchRuntime(SEARCH_RUNTIME.bytes, "c".repeat(64))).toBe(
      `${SEARCH_RUNTIME.name}: expected ${SEARCH_RUNTIME.sha256.slice(0, 12)}, got cccccccccccc`
    );
  });
});

describe("staleSearchRuntimeFiles", () => {
  it("offers earlier versions and nothing else", () => {
    expect(
      staleSearchRuntimeFiles([
        SEARCH_RUNTIME.name,
        "search-runtime-1.22.0.wasm",
        "search-runtime-notes.md",
        "typst-runtime-0.7.0.wasm",
        "main.js",
        "my-search-runtime-1.0.wasm"
      ])
    ).toEqual(["search-runtime-1.22.0.wasm"]);
  });
});

describe("SearchRuntimeError", () => {
  it("is told apart from every other failure, keeping its cause", () => {
    const cause = new Error("HTTP 404");
    const err = new SearchRuntimeError("could not be fetched", { cause });
    expect(isSearchRuntimeError(err)).toBe(true);
    expect(err.cause).toBe(cause);
    expect(isSearchRuntimeError(new Error("could not be fetched"))).toBe(false);
  });
});
