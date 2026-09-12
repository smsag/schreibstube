/**
 * The suite covers the bridge as well as the plugin, and the bridge keeps its
 * own dependency tree. A fresh clone that runs the tests would otherwise fail
 * on a module resolution error that says nothing about what to do.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bridgeModules = fileURLToPath(new URL("../bridge/node_modules", import.meta.url));

if (!existsSync(bridgeModules)) {
  console.error(
    "The bridge's dependencies are not installed, and the test suite covers the bridge.\n" +
      "Run: npm run setup"
  );
  process.exit(1);
}
