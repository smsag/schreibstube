import { describe, expect, it } from "vitest";
import {
  checkRuntimeBytes,
  describeDiagnostics,
  LOADER_ASSET,
  readCompileResult,
  RUNTIME_ASSETS,
  RUNTIME_SOURCE_PATHS,
  RUNTIME_VERSION,
  runtimeAssetUrl,
  runtimeCachePath,
  staleRuntimeFiles,
  toHex,
  WASM_ASSET
} from "./typst-runtime";

describe("the pinned runtime", () => {
  it("pins both files by a full SHA-256", () => {
    expect(RUNTIME_ASSETS).toHaveLength(2);
    for (const asset of RUNTIME_ASSETS) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.name).toContain(RUNTIME_VERSION);
    }
  });

  it("knows where each file comes from in the package", () => {
    for (const asset of RUNTIME_ASSETS) {
      expect(RUNTIME_SOURCE_PATHS[asset.name]).toBeTruthy();
    }
  });

  it("fetches from the release of the version that is installed", () => {
    expect(runtimeAssetUrl("1.24.0", WASM_ASSET)).toBe(
      `https://github.com/smsag/schreibstube/releases/download/1.24.0/${WASM_ASSET.name}`
    );
  });

  it("keeps the files beside the plugin, whatever shape the folder was given in", () => {
    expect(runtimeCachePath(".obsidian/plugins/schreibstube", LOADER_ASSET)).toBe(
      `.obsidian/plugins/schreibstube/${LOADER_ASSET.name}`
    );
    expect(runtimeCachePath(".obsidian/plugins/schreibstube/", LOADER_ASSET)).toBe(
      `.obsidian/plugins/schreibstube/${LOADER_ASSET.name}`
    );
  });
});

describe("checkRuntimeBytes", () => {
  it("passes the bytes that were pinned", () => {
    expect(checkRuntimeBytes(WASM_ASSET, WASM_ASSET.sha256)).toBeNull();
  });

  it("refuses anything else, naming both hashes short enough to read", () => {
    const problem = checkRuntimeBytes(WASM_ASSET, "b".repeat(64));
    expect(problem).toBe(
      `${WASM_ASSET.name}: expected ${WASM_ASSET.sha256.slice(0, 12)}, got bbbbbbbbbbbb`
    );
  });

  it("refuses a hash that merely starts the same way", () => {
    const almost = `${WASM_ASSET.sha256.slice(0, 63)}0`;
    expect(checkRuntimeBytes(WASM_ASSET, almost)).not.toBeNull();
  });
});

describe("toHex", () => {
  it("writes a digest the way the pinned hashes are written", () => {
    expect(toHex(new Uint8Array([0, 15, 16, 255]).buffer)).toBe("000f10ff");
  });
});

describe("readCompileResult", () => {
  it("takes the document out of the answer, in either shape", () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    expect(readCompileResult(pdf)).toEqual({ ok: true, pdf });
    expect(readCompileResult({ result: pdf })).toEqual({ ok: true, pdf });
  });

  it("carries the diagnostics when there is no document", () => {
    expect(
      readCompileResult({ hasError: true, diagnostics: ["/main.typ:3:1: error: unknown variable"] })
    ).toEqual({ ok: false, diagnostics: ["/main.typ:3:1: error: unknown variable"] });
  });

  it("says something rather than nothing when the answer is empty", () => {
    expect(readCompileResult(null)).toEqual({
      ok: false,
      diagnostics: ["the compiler gave no answer"]
    });
    expect(readCompileResult({ diagnostics: [] }).ok).toBe(false);
  });
});

describe("describeDiagnostics", () => {
  it("names the note rather than the generated file a person never sees", () => {
    expect(describeDiagnostics(["/main.typ:3:1: error: unknown variable"])).toBe(
      "note:3:1: error: unknown variable"
    );
  });

  it("shows two and counts the rest, because Typst errors cascade", () => {
    expect(describeDiagnostics(["a", "b", "c", "d"])).toBe("a; b (+2)");
  });

  it("says nothing for nothing", () => {
    expect(describeDiagnostics([])).toBe("");
  });
});

describe("staleRuntimeFiles", () => {
  it("offers the runtimes of earlier versions and keeps the current one", () => {
    const current = RUNTIME_ASSETS.map((asset) => asset.name);
    const names = [
      ...current,
      "typst-runtime-0.6.0.wasm",
      "typst-runtime-0.6.0.mjs",
      "main.js",
      "data.json",
      "typst-runtime-notes.md"
    ];
    expect(staleRuntimeFiles(names)).toEqual([
      "typst-runtime-0.6.0.wasm",
      "typst-runtime-0.6.0.mjs"
    ]);
  });
});
