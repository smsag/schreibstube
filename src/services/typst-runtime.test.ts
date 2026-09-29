import { describe, expect, it } from "vitest";
import { t } from "../i18n";
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
  DEVICE_ASSETS,
  FONT_ASSETS,
  fontFaceOf,
  FONT_SETS,
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
      diagnostics: [t().print.compilerSilent]
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

describe("the fonts", () => {
  it("pins every face by hash, under the release's runtime glob and its set's version", () => {
    expect(FONT_ASSETS.length).toBe(FONT_SETS.reduce((n, set) => n + set.files.length, 0));
    for (const set of FONT_SETS) {
      expect(set.source).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/[\w-]+\/[\w-]+\/[\w.]+\//
      );
      // A branch name is not a pin: the bytes behind it can change.
      expect(set.source).not.toMatch(/\/(main|master)\//);
      for (const { file, sha256 } of set.files) {
        expect(sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file).toMatch(/^[\w-]+\.(otf|ttf)$/);
      }
    }
    for (const asset of FONT_ASSETS) {
      expect(asset.name).toMatch(/^typst-runtime-fonts-[\d.]+-[\w-]+\.(otf|ttf)$/);
      expect(asset.label).toBe("font");
    }
    expect(new Set(FONT_ASSETS.map((asset) => asset.name)).size).toBe(FONT_ASSETS.length);
  });

  it("keeps the names the Typst defaults were fetched under, so a device does not fetch them again", () => {
    expect(FONT_ASSETS.map((asset) => asset.name)).toContain(
      "typst-runtime-fonts-0.14.2-LibertinusSerif-Regular.otf"
    );
  });

  it("carries Typst's own defaults in all four styles, for a template that names no font", () => {
    const faces = FONT_ASSETS.map(fontFaceOf);
    for (const style of ["Regular", "Italic", "Bold", "BoldItalic"]) {
      expect(faces).toContain(`LibertinusSerif-${style}`);
    }
    expect(faces).toEqual(
      expect.arrayContaining([
        "DejaVuSansMono",
        "DejaVuSansMono-Oblique",
        "DejaVuSansMono-Bold",
        "DejaVuSansMono-BoldOblique"
      ])
    );
  });

  it("carries the condensed cuts the Lebenslauf template sets its headings in", () => {
    const faces = FONT_ASSETS.map(fontFaceOf);
    expect(faces).toEqual(
      expect.arrayContaining(["FiraSansCondensed-SemiBold", "FiraSansCondensed-Bold"])
    );
  });

  it("carries every face the Standard template sets text in", () => {
    const faces = FONT_ASSETS.map(fontFaceOf);
    expect(faces).toEqual(
      expect.arrayContaining([
        "FiraSans-Regular",
        "FiraSans-Italic",
        "FiraSans-SemiBold",
        "FiraSans-Bold",
        "FiraSans-BoldItalic",
        "JetBrainsMono-Regular",
        "JetBrainsMono-Italic",
        "JetBrainsMono-Bold",
        "JetBrainsMono-BoldItalic"
      ])
    );
  });

  it("counts them among what a device keeps, and as current rather than stale", () => {
    expect(DEVICE_ASSETS).toEqual([...RUNTIME_ASSETS, ...FONT_ASSETS]);
    const names = DEVICE_ASSETS.map((asset) => asset.name);
    expect(staleRuntimeFiles(names)).toEqual([]);
    expect(
      staleRuntimeFiles(["typst-runtime-fonts-0.13.0-LibertinusSerif-Regular.otf"])
    ).toHaveLength(1);
  });
});
