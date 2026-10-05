import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/**
 * The smoke run is a process of its own: the Worker prelude it runs hides
 * Node's globals, which this test runner needs to keep.
 */
async function smoke(...args) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["scripts/embedding-smoke.mjs", ...args],
    { cwd: new URL("..", import.meta.url), timeout: 60_000 }
  );
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

describe("the embedding bundle, started as a Worker", () => {
  it("embeds with the pinned runtime, fetching nothing but the model's files", async () => {
    const run = await smoke();
    expect(run.loadError).toBeNull();
    expect(run.nodeVisible).toBe(false);
    // "hello world" is ids 2 and 3 under a mask of ones: mean (2.5, 1), normalised.
    const [first, second] = run.answer.vectors;
    expect(first[0]).toBeCloseTo(2.5 / Math.hypot(2.5, 1), 5);
    expect(first[1]).toBeCloseTo(1 / Math.hypot(2.5, 1), 5);
    expect(second[0]).toBeCloseTo(4 / Math.hypot(4, 1), 5);
    expect(run.requested.length).toBeGreaterThan(0);
    for (const url of run.requested) {
      expect(url.startsWith("https://huggingface.co/smoke/model/resolve/main/")).toBe(true);
    }
  });

  it("refuses to load without it, and asks the network for nothing", async () => {
    const run = await smoke("--without");
    expect(run.loadError).toBe("the runtime's WebAssembly module did not arrive");
    expect(run.requested).toEqual([]);
  });
});
