import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("every embedding deadline is measured on the visible clock (Pythia ADR-202)", () => {
  const read = (f: string): string =>
    readFileSync(resolve(process.cwd(), "src/controllers/semantic/host", f), "utf8");

  it("the shared protocol client arms its timeouts on it (Pythia ADR-204)", () => {
    // Both backends' deadlines live here since the extraction, so this is the
    // one file that has to name the clock.
    const src = read("post-message-backend.ts");
    expect(src).toContain("visibleClock.timeout(");
    expect(src).toContain("visibleClock.elapsed()");
  });

  for (const f of [
    "post-message-backend.ts",
    "worker-embedding-provider.ts",
    "iframe-embedding-provider.ts"
  ]) {
    it(`${f} has no wall-clock deadline left`, () => {
      const src = read(f);
      expect(src).not.toMatch(/Date\.now\(\)\s*-\s*started/);
      expect(src).not.toMatch(/clearTimeout\(\w+\.timeout\)/);
    });
  }
});
