import { describe, expect, it } from "vitest";
import { linkCallAllowed, NEW_NOTE_LINK_INTERVAL_MS } from "./link-rate";

describe("linkCallAllowed", () => {
  it("acts on the first call", () => {
    expect(linkCallAllowed(null, 1_000)).toBe(true);
  });

  it("ignores a call inside the window after the last one acted on", () => {
    expect(linkCallAllowed(1_000, 1_000)).toBe(false);
    expect(linkCallAllowed(1_000, 1_000 + NEW_NOTE_LINK_INTERVAL_MS - 1)).toBe(false);
  });

  it("acts again once the window has passed", () => {
    expect(linkCallAllowed(1_000, 1_000 + NEW_NOTE_LINK_INTERVAL_MS)).toBe(true);
  });

  it("lets a flood through at most once per window", () => {
    let last: number | null = null;
    let acted = 0;
    for (let now = 0; now < 60_000; now += 50) {
      if (!linkCallAllowed(last, now)) continue;
      last = now;
      acted += 1;
    }
    expect(acted).toBe(60_000 / NEW_NOTE_LINK_INTERVAL_MS);
  });

  it("does not stay shut when the clock was set back", () => {
    expect(linkCallAllowed(10_000, 2_000)).toBe(true);
  });

  it("takes another window when asked", () => {
    expect(linkCallAllowed(0, 500, 1_000)).toBe(false);
    expect(linkCallAllowed(0, 1_000, 1_000)).toBe(true);
  });
});
