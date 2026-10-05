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

const PINNED =
  "https://huggingface.co/smoke/model/resolve/5a0be5a0be5a0be5a0be5a0be5a0be5a0be5a0be/";

describe("the embedding bundle, started as a Worker", () => {
  it("embeds with the pinned runtime, fetching each pinned model file once at its commit", async () => {
    const run = await smoke();
    expect(run.loadError).toBeNull();
    expect(run.nodeVisible).toBe(false);
    // "hello world" is ids 2 and 3 under a mask of ones: mean (2.5, 1), normalised.
    const [first, second] = run.answer.vectors;
    expect(first[0]).toBeCloseTo(2.5 / Math.hypot(2.5, 1), 5);
    expect(first[1]).toBeCloseTo(1 / Math.hypot(2.5, 1), 5);
    expect(second[0]).toBeCloseTo(4 / Math.hypot(4, 1), 5);
    // Exactly the files the pins cover (`MODEL_FILES`), and nothing at `main`.
    expect([...run.requested].sort()).toEqual(
      ["config.json", "onnx/model_quantized.onnx", "tokenizer.json", "tokenizer_config.json"].map(
        (file) => PINNED + file
      )
    );
  });

  it("refuses to load without the runtime, and asks the network for nothing", async () => {
    const run = await smoke("--without");
    expect(run.loadError).toBe("the runtime's WebAssembly module did not arrive");
    expect(run.requested).toEqual([]);
  });

  it("refuses to load a model this version has no pin for, and asks for nothing", async () => {
    const run = await smoke("--unpinned");
    expect(run.loadError).toBe(
      "model pin missing: smoke/model has no pinned revision in this version"
    );
    expect(run.requested).toEqual([]);
  });

  it("refuses a model file whose bytes are not the pinned ones", async () => {
    const run = await smoke("--tampered");
    expect(run.loadError).toMatch(/^model pin mismatch: tokenizer\.json: expected /);
    expect(run.answer.vectors).toEqual([]);
  });
});
