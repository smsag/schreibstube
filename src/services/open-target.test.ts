import { describe, expect, it } from "vitest";
import { pressTarget } from "./open-target";

describe("pressTarget", () => {
  it("opens in place on a plain press", () => {
    expect(pressTarget({ ctrlKey: false, metaKey: false })).toBe("here");
  });

  it("opens a new tab on a modifier press, either modifier", () => {
    expect(pressTarget({ ctrlKey: true })).toBe("tab");
    expect(pressTarget({ metaKey: true })).toBe("tab");
  });

  it("opens in place from the keyboard, which brings no event", () => {
    expect(pressTarget(undefined)).toBe("here");
  });
});
