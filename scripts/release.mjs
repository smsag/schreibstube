/**
 * Bump the three files that carry a version, together.
 *
 * `manifest.json` is what Obsidian reads, `package.json` is what the build
 * reads, and `versions.json` is what the installer reads to decide which
 * release an older app may have. Doing that by hand is three edits and one
 * chance to get one of them wrong, which the release workflow then discovers
 * after it has already started.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: npm run release -- 1.8.0");
  process.exit(1);
}

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const manifest = read("manifest.json");
const pkg = read("package.json");
const versions = read("versions.json");

if (!isNewer(version, manifest.version)) {
  console.error(`${version} is not newer than the current ${manifest.version}.`);
  process.exit(1);
}

const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
if (dirty) {
  console.error("The working tree has changes. Commit them before releasing.");
  process.exit(1);
}

manifest.version = version;
pkg.version = version;
// The installer maps a plugin version to the oldest Obsidian that can run it,
// which is whatever the manifest currently requires.
versions[version] = manifest.minAppVersion;

write("manifest.json", manifest);
write("package.json", pkg);
write("versions.json", versions);

console.log(
  `${version} set in manifest.json, package.json and versions.json ` +
    `(minimum Obsidian ${manifest.minAppVersion}).\n` +
    "Next: update the changelog, commit, and run the Release workflow with the same version."
);

function isNewer(candidate, current) {
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
