import { describe, expect, it } from "vitest";
import { nextLinkMode } from "./link-mode";

describe("switching the side links open on", () => {
  it("walks normal, left, right and back to normal", () => {
    expect(nextLinkMode("default")).toBe("left");
    expect(nextLinkMode("left")).toBe("right");
    expect(nextLinkMode("right")).toBe("default");
  });
});
