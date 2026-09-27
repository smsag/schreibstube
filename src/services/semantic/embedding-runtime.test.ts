import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMBEDDING_RUNTIME } from "./embedding-models";

/**
 * A new transformers or onnxruntime-web can change every vector without changing
 * a line of this plugin. `EMBEDDING_RUNTIME` names the versions whose vectors the
 * current generation stands for, so a bump — Dependabot's included — stops here
 * until someone embeds the same notes with both runtimes and decides: vectors
 * moved, raise the generation (every index rebuilds); vectors identical, record
 * the new versions and keep it.
 */
const lock = JSON.parse(
  readFileSync(new URL("../../../package-lock.json", import.meta.url), "utf8")
) as {
  packages: Record<string, { version?: string }>;
};

describe("EMBEDDING_RUNTIME", () => {
  it("names the transformers the lockfile installs", () => {
    expect(lock.packages["node_modules/@huggingface/transformers"]?.version).toBe(
      EMBEDDING_RUNTIME.transformers
    );
  });

  it("names the onnxruntime-web the lockfile installs", () => {
    expect(lock.packages["node_modules/onnxruntime-web"]?.version).toBe(
      EMBEDDING_RUNTIME.onnxruntimeWeb
    );
  });

  it("is a generation a row hash can carry", () => {
    expect(Number.isInteger(EMBEDDING_RUNTIME.generation)).toBe(true);
    expect(EMBEDDING_RUNTIME.generation).toBeGreaterThanOrEqual(1);
  });
});
