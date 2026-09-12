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
  test: {
    include: ["src/**/*.test.ts", "bridge/**/*.test.mjs"],
    exclude: ["**/node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/services/**/*.ts", "src/utils/**/*.ts", "bridge/**/*.mjs"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.mjs",
        "bridge/publish/sftp-fixture.mjs",
        "src/services/workspace-internals.ts"
      ],
      reporter: ["text-summary"],
      // A floor, not a target: it fails the build when a change takes the suite
      // backwards. Raise it when the number rises, never lower it to pass.
      thresholds: {
        lines: 68,
        functions: 85,
        statements: 68,
        branches: 85
      }
    }
  }
});
