import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Lint rules, deliberately few.
 *
 * Formatting belongs to Prettier, so nothing here argues about layout. What is
 * left are the mistakes a reviewer should never have to catch by eye: an
 * unhandled promise, a variable that is read before it is assigned, a `catch`
 * that swallows without saying so.
 */
export default tseslint.config(
  {
    ignores: ["main.js", "node_modules/**", "bridge/node_modules/**"]
  },

  // The plugin: browser-shaped, TypeScript, bundled by esbuild.
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error"
    }
  },

  // The bridge: Node, plain modules, no build step.
  {
    files: ["bridge/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" }
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error"
    }
  },

  // Tests may reach for shapes the source never would.
  {
    files: ["**/*.test.ts", "**/*.test.mjs", "**/sftp-fixture.mjs", "src/testing/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off"
    }
  }
);
