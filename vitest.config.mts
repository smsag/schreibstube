import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The suite covers the plugin (`src`) and the bridge (`bridge`) together, so a
 * change to a shared rule is checked on both sides in one run.
 *
 * Coverage is measured over the modules that hold decisions. Files that only
 * wire Obsidian's API to those decisions are excluded rather than pretended
 * about: they are covered by the controller tests through a fake app, and
 * counting their glue would only dilute the number.
 */
export default defineConfig({
  resolve: {
    alias: {
      // `obsidian` is a types-only dependency: there is no runtime module to
      // import, which is why the controllers had no tests. The stub is the
      // smallest surface they actually touch.
      obsidian: fileURLToPath(new URL("./src/testing/obsidian-stub.ts", import.meta.url))
    }
  },
  test: {
    include: ["src/**/*.test.ts", "bridge/**/*.test.mjs", "scripts/**/*.test.mjs"],
    exclude: ["**/node_modules/**"],
    coverage: {
      provider: "v8",
      include: [
        "src/services/**/*.ts",
        "src/utils/**/*.ts",
        "src/controllers/publish-commands.ts",
        "bridge/**/*.mjs"
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.mjs",
        "bridge/publish/sftp-fixture.mjs",
        "bridge/publish/bench.mjs",
        "src/services/workspace-internals.ts",
        "src/testing/**"
      ],
      reporter: ["text-summary"],
      // A floor, not a target: it fails the build when a change takes the suite
      // backwards. Raise it when the number rises, never lower it to pass.
      //
      // Re-based once, with Vitest 5: its coverage maps the V8 profile through
      // the AST, so it counts arrow functions and short-circuit branches that
      // the old remapping never saw. The suite did not change; the instrument
      // did, and these are the same margin under the new one (measured 79 / 74
      // / 78 / 76 on the day).
      thresholds: {
        lines: 80,
        functions: 75,
        statements: 79,
        branches: 75
      }
    }
  }
});
