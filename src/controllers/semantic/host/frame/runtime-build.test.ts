import { describe, it, expect } from "vitest";
import { plainRuntimePaths } from "./runtime-build";

describe("plainRuntimePaths", () => {
  it("names the plain build of the bundled version, never the asyncify one", () => {
    const paths = plainRuntimePaths("1.31.0-dev.20260914-8d85527a0");
    expect(paths).toEqual({
      mjs: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.mjs",
      wasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.wasm"
    });
    expect(JSON.stringify(paths)).not.toMatch(/asyncify|jsep|jspi/);
    expect(plainRuntimePaths("1.22.0")?.wasm).toMatch(/@1\.22\.0\/dist\//);
  });

  it("leaves the choice to the library when the version is not one", () => {
    for (const bad of [
      undefined,
      null,
      1.31,
      "",
      "latest",
      "1.31",
      "1.31.0/../../evil",
      "1.31.0?x=1"
    ]) {
      expect(plainRuntimePaths(bad)).toBeNull();
    }
  });
});
