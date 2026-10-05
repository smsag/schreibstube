import { describe, it, expect } from "vitest";
import { pinRuntime, type WasmFlags } from "./runtime-build";

/** The settings transformers.js leaves behind at import, CDN default and all. */
function librarySettings(): WasmFlags {
  return {
    numThreads: 4,
    proxy: true,
    wasmPaths: {
      mjs: "unpinned-runtime-refused:ort-wasm-simd-threaded.asyncify.mjs",
      wasm: "unpinned-runtime-refused:ort-wasm-simd-threaded.asyncify.wasm"
    }
  };
}

describe("pinRuntime", () => {
  it("hands over the module and takes away every way to fetch one", () => {
    const wasm = librarySettings();
    const module = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;
    expect(pinRuntime(wasm, module)).toBeNull();
    expect(wasm.wasmPaths).toBeUndefined();
    expect(wasm.proxy).toBe(false);
    expect(wasm.numThreads).toBe(1);
    expect(wasm.wasmBinary).toBeInstanceOf(Uint8Array);
    expect((wasm.wasmBinary as Uint8Array).buffer).toBe(module);
  });

  it("refuses to start without the module, and leaves nothing to fetch it with", () => {
    for (const missing of [undefined, null, "", "AGFzbQ==", [0, 97], new ArrayBuffer(0)]) {
      const wasm = librarySettings();
      expect(pinRuntime(wasm, missing)).toBe("the runtime's WebAssembly module did not arrive");
      expect(wasm.wasmPaths).toBeUndefined();
      expect(wasm.wasmBinary).toBeUndefined();
    }
  });

  it("says so when the runtime has no WebAssembly settings at all", () => {
    expect(pinRuntime(undefined, new ArrayBuffer(8))).toBe(
      "the runtime has no WebAssembly settings to pin"
    );
  });
});
