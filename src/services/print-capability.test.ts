import { describe, expect, it } from "vitest";
import { missingCapability, readPlatformFeatures, type PlatformFeatures } from "./print-capability";

const complete: PlatformFeatures = { webAssembly: true, worker: true, digest: true };

describe("missingCapability", () => {
  it("says nothing is missing on a platform that has everything", () => {
    expect(missingCapability(complete)).toBeNull();
  });

  it("names the one thing that is missing", () => {
    expect(missingCapability({ ...complete, webAssembly: false })).toBe("webAssembly");
    expect(missingCapability({ ...complete, worker: false })).toBe("worker");
    expect(missingCapability({ ...complete, digest: false })).toBe("digest");
  });

  it("names the first when several are missing, since the rest do not help", () => {
    expect(missingCapability({ webAssembly: false, worker: false, digest: false })).toBe(
      "webAssembly"
    );
    expect(missingCapability({ webAssembly: true, worker: false, digest: false })).toBe("worker");
  });
});

describe("readPlatformFeatures", () => {
  it("finds all three on a platform that has them", () => {
    const scope = {
      WebAssembly: { compile: () => undefined },
      Worker: function Worker() {},
      crypto: { subtle: { digest: () => undefined } }
    } as unknown as typeof globalThis;
    expect(readPlatformFeatures(scope)).toEqual(complete);
  });

  it("reports a bare platform rather than throwing on it", () => {
    expect(readPlatformFeatures({} as typeof globalThis)).toEqual({
      webAssembly: false,
      worker: false,
      digest: false
    });
  });

  it("is not fooled by a name that is present but not callable", () => {
    const scope = {
      WebAssembly: { compile: "yes" },
      Worker: {},
      crypto: { subtle: {} }
    } as unknown as typeof globalThis;
    expect(readPlatformFeatures(scope)).toEqual({
      webAssembly: false,
      worker: false,
      digest: false
    });
  });
});
