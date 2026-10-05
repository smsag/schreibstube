/**
 * Check the search models' pins against Hugging Face, and say what to commit
 * when they are empty or wrong.
 *
 * `src/services/semantic/model-pins.json` names, for each model, a commit of
 * its repository and the length and SHA-256 of every file the plugin fetches
 * from it. A device refuses anything else. This script is how those values
 * are made and kept honest: CI runs it on every change and before every
 * release.
 *
 * For each model it reads the repository at the pinned commit — or, while the
 * pin is still empty, at `main`, to propose one — downloads every pinned file
 * at that commit, and hashes what arrived. Hugging Face's own record of each
 * file's size, and of an LFS file's SHA-256, is compared too, so a download
 * that went wrong is not mistaken for a new pin. When anything is empty or
 * differs, it prints the whole file as it should be committed, and fails.
 *
 * It also refuses a model whose configuration asks for its weights in a
 * separate data file: the pins would not cover it, and every device would
 * refuse to load the model.
 *
 *   node scripts/check-model-pins.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Both overridable only so the script's own test can run it against a local
// server; CI and a person running it use the defaults.
const HOST = process.env.MODEL_PINS_HOST ?? "https://huggingface.co";
const PINS =
  process.env.MODEL_PINS_FILE ??
  fileURLToPath(new URL("../src/services/semantic/model-pins.json", import.meta.url));

/** A repository's listing is a few kilobytes; the largest weights about 120 MB. */
const MAX_API_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const API_TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 600_000;

class Failure extends Error {}

/**
 * The body of a GET, read within a length and a deadline, hashed as it
 * arrives. The bytes are kept only when asked for: a model's weights are
 * hashed, never held.
 */
async function download(url, { maxBytes, timeoutMs, keep }) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Failure(`HTTP ${response.status} from ${url}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Failure(`${url}: ${declared} bytes, more than ${maxBytes}`);
  const hash = createHash("sha256");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Failure(`${url}: more than ${maxBytes} bytes`);
    hash.update(chunk);
    if (keep) chunks.push(chunk);
  }
  return { size, sha256: hash.digest("hex"), bytes: keep ? Buffer.concat(chunks) : null };
}

async function json(url) {
  const { bytes } = await download(url, {
    maxBytes: MAX_API_BYTES,
    timeoutMs: API_TIMEOUT_MS,
    keep: true
  });
  return JSON.parse(bytes.toString("utf8"));
}

/** What the pin for one model should say, and what is wrong with the one committed. */
async function check(pin) {
  const problems = [];
  const repo = pin.repoId;
  const pinned = /^[0-9a-f]{40}$/.test(pin.revision) ? pin.revision : null;
  const info = await json(
    pinned
      ? `${HOST}/api/models/${repo}/revision/${pinned}?blobs=true`
      : `${HOST}/api/models/${repo}?blobs=true`
  );
  const revision = info.sha;
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Failure(`${repo}: the listing names no commit`);
  }
  if (pinned === null) problems.push(`${repo}: no revision pinned; main is at ${revision}`);
  else if (revision !== pinned) {
    throw new Failure(`${repo}: asked for ${pinned}, the listing is of ${revision}`);
  }

  const siblings = new Map((info.siblings ?? []).map((entry) => [entry.rfilename, entry]));
  const files = {};
  for (const name of Object.keys(pin.files)) {
    const listed = siblings.get(name);
    if (!listed) throw new Failure(`${repo}@${revision} has no ${name}`);
    const got = await download(`${HOST}/${repo}/resolve/${revision}/${name}`, {
      maxBytes: MAX_FILE_BYTES,
      timeoutMs: FILE_TIMEOUT_MS,
      keep: name === "config.json"
    });
    // Hugging Face's own record, where it keeps one: a mismatch here is a
    // download that went wrong, not a pin to commit.
    if (typeof listed.size === "number" && listed.size !== got.size) {
      throw new Failure(`${repo}: ${name} is listed at ${listed.size} bytes, ${got.size} arrived`);
    }
    if (listed.lfs?.sha256 && listed.lfs.sha256 !== got.sha256) {
      throw new Failure(
        `${repo}: ${name} is listed as ${listed.lfs.sha256}, ${got.sha256} arrived`
      );
    }
    if (name === "config.json") {
      const external = JSON.parse(got.bytes.toString("utf8"))["transformers.js_config"]
        ?.use_external_data_format;
      if (external) {
        throw new Failure(
          `${repo}: config.json asks for external data files, which the pins do not cover`
        );
      }
    }
    files[name] = { size: got.size, sha256: got.sha256 };
    const committed = pin.files[name] ?? {};
    if (committed.size !== got.size || committed.sha256 !== got.sha256) {
      problems.push(
        `${repo}: ${name} pinned as ${committed.size ?? "nothing"} bytes / ` +
          `${committed.sha256 || "no hash"}, is ${got.size} bytes / ${got.sha256}`
      );
    }
    console.log(`${repo}@${revision.slice(0, 12)} ${name}: ${got.size} bytes, ${got.sha256}`);
  }
  return { pin: { repoId: repo, revision, files }, problems };
}

try {
  const committed = JSON.parse(readFileSync(PINS, "utf8"));
  const models = [];
  const problems = [];
  for (const pin of committed.models) {
    const result = await check(pin);
    models.push(result.pin);
    problems.push(...result.problems);
  }
  if (problems.length > 0) {
    console.error(`\nThe model pins are not what Hugging Face serves:\n  ${problems.join("\n  ")}`);
    console.error(
      "\nCheck the commits below are the ones meant, then commit this as " +
        "src/services/semantic/model-pins.json:\n"
    );
    console.log(JSON.stringify({ models }, null, 2));
    process.exitCode = 1;
  } else {
    console.log("Every model file matches its pin.");
  }
} catch (error) {
  console.error(error instanceof Failure ? error.message : error);
  process.exitCode = 1;
}
