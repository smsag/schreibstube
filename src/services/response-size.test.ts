import { describe, expect, it } from "vitest";
import { declaredLength, exceedsBytes, megabytes } from "./response-size";

describe("declaredLength", () => {
  it("reads the header in whatever case the server wrote it", () => {
    expect(declaredLength({ "Content-Length": "1234" })).toBe(1234);
    expect(declaredLength({ "content-length": " 7 " })).toBe(7);
  });

  it("is null when nothing usable is declared", () => {
    expect(declaredLength(undefined)).toBeNull();
    expect(declaredLength({})).toBeNull();
    expect(declaredLength({ "content-length": "" })).toBeNull();
    expect(declaredLength({ "content-length": "-1" })).toBeNull();
    expect(declaredLength({ "content-length": "1e9" })).toBeNull();
  });
});

describe("exceedsBytes", () => {
  it("refuses a body that declares itself too large, before measuring it", () => {
    expect(exceedsBytes({ "content-length": "11" }, "", 10)).toBe(true);
  });

  it("refuses a body that is too large although it declares less, or nothing", () => {
    expect(exceedsBytes({ "content-length": "1" }, new Uint8Array(11), 10)).toBe(true);
    expect(exceedsBytes(undefined, new ArrayBuffer(11), 10)).toBe(true);
  });

  it("measures text in UTF-8 bytes, not characters", () => {
    expect(exceedsBytes(undefined, "ä".repeat(6), 10)).toBe(true);
    expect(exceedsBytes(undefined, "a".repeat(10), 10)).toBe(false);
  });

  it("lets a body at the bound through", () => {
    expect(exceedsBytes({ "content-length": "10" }, new ArrayBuffer(10), 10)).toBe(false);
  });
});

describe("megabytes", () => {
  it("rounds to whole megabytes, never to none", () => {
    expect(megabytes(4_000_000)).toBe(4);
    expect(megabytes(1_000)).toBe(1);
  });
});
