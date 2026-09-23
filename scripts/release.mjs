/**
 * Bump the four files that carry a version, together.
 *
 * `manifest.json` is what Obsidian reads, `package.json` is what the build
 * reads, and `versions.json` is what the installer reads to decide which
 * release an older app may have. Doing that by hand is three edits and one
 * chance to get one of them wrong, which the release workflow then discovers
 * after it has already started.
 *
 * A fourth file carries the number and nothing reads it for the release, which
 * is how it came to be left behind: npm keeps `package-lock.json` equal to
 * `package.json`, so a stale one says nothing until the next `npm install`
 * rewrites it and hands whoever ran it a hunk they did not write. It holds the
 * version twice, and both are set here, so that no branch starts dirty.
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
const lock = read("package-lock.json");

if (!isNewer(version, manifest.version)) {
  console.error(`${version} is not newer than the current ${manifest.version}.`);
  process.exit(1);
}

if (typeof lock.packages?.[""]?.version !== "string") {
  console.error(
    'package-lock.json has no packages[""].version — its format changed.\n' +
      "Bump it by hand, or with `npm install --package-lock-only`, and check this script."
  );
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

// Both, because npm writes the version in each and reconciles them on the
// next install whether or not anyone asked it to.
lock.version = version;
lock.packages[""].version = version;

write("manifest.json", manifest);
write("package.json", pkg);
write("versions.json", versions);
write("package-lock.json", lock);

console.log(
  `${version} set in manifest.json, package.json, versions.json and package-lock.json ` +
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
