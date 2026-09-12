/**
 * The plugin must keep running on mobile, where Obsidian has no Node runtime.
 * That holds only while nothing pulls a Node built-in into the bundle, which is
 * easy to break with one import and invisible until someone opens the vault on
 * a phone.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundle = fileURLToPath(new URL("../main.js", import.meta.url));
const source = readFileSync(bundle, "utf8");

const builtins = [...source.matchAll(/["'`](node:[a-z/]+)["'`]/g)].map((match) => match[1]);
const unique = [...new Set(builtins)];

if (unique.length > 0) {
  console.error(
    `main.js reaches for Node built-ins: ${unique.join(", ")}.\n` +
      "The plugin would stop loading on mobile. Move that code to the bridge."
  );
  process.exit(1);
}

console.log(`main.js is free of Node built-ins (${(source.length / 1024).toFixed(0)} KB).`);
