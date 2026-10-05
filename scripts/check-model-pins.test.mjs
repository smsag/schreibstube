import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The script runs for real only in CI, against Hugging Face. Here it runs
 * against a local server that answers the same two kinds of request — a
 * repository's listing at a commit, and a file at a commit — so what it
 * proposes, and when it fails, is known before CI is asked.
 */
const REPO = "someone/model";
const SHA = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const FILES = {
  "config.json": JSON.stringify({ model_type: "bert" }),
  "tokenizer.json": "{}",
  "onnx/model_quantized.onnx": "weights"
};
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const COMPLETE = {
  repoId: REPO,
  revision: SHA,
  files: Object.fromEntries(
    Object.entries(FILES).map(([name, text]) => [
      name,
      { size: Buffer.byteLength(text), sha256: sha256(text) }
    ])
  )
};

/** What the server serves, changed per test. */
const served = { files: { ...FILES }, lfsSha: null };
let server;
let host;
let work;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const listing = [`/api/models/${REPO}`, `/api/models/${REPO}/revision/${SHA}`];
    if (listing.includes(url.pathname)) {
      const siblings = Object.entries(served.files).map(([rfilename, text]) => ({
        rfilename,
        size: Buffer.byteLength(text),
        ...(rfilename.endsWith(".onnx")
          ? { lfs: { sha256: served.lfsSha ?? sha256(text), size: Buffer.byteLength(text) } }
          : {})
      }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: REPO, sha: SHA, siblings }));
      return;
    }
    const prefix = `/${REPO}/resolve/${SHA}/`;
    const name = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : null;
    if (name !== null && name in served.files) {
      res.writeHead(200).end(served.files[name]);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  host = `http://127.0.0.1:${server.address().port}`;
  work = mkdtempSync(join(tmpdir(), "model-pins-"));
});

afterAll(() => {
  server.close();
  rmSync(work, { recursive: true, force: true });
});

async function run(pin) {
  const file = join(work, "pins.json");
  writeFileSync(file, JSON.stringify({ models: [pin] }));
  try {
    const { stdout } = await new Promise((resolve, reject) =>
      execFile(
        process.execPath,
        ["scripts/check-model-pins.mjs"],
        {
          cwd: new URL("..", import.meta.url),
          env: { ...process.env, MODEL_PINS_HOST: host, MODEL_PINS_FILE: file },
          timeout: 30_000
        },
        (error, stdout, stderr) =>
          error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout })
      )
    );
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

/** The JSON block the script prints for committing. */
function proposed(stdout) {
  return JSON.parse(stdout.slice(stdout.indexOf('{\n  "models"')));
}

describe("check-model-pins", () => {
  it("proposes the whole pin, from what it downloaded, when the committed one is empty", async () => {
    const empty = {
      repoId: REPO,
      revision: "",
      files: Object.fromEntries(
        Object.keys(FILES).map((name) => [name, { size: null, sha256: "" }])
      )
    };
    const result = await run(empty);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`no revision pinned; main is at ${SHA}`);
    expect(proposed(result.stdout)).toEqual({ models: [COMPLETE] });
  });

  it("passes a pin that matches what is served at its commit", async () => {
    const result = await run(COMPLETE);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Every model file matches its pin.");
  });

  it("fails on a file that differs from its pin, and proposes what is served", async () => {
    const wrong = {
      ...COMPLETE,
      files: { ...COMPLETE.files, "tokenizer.json": { size: 2, sha256: sha256("[]") } }
    };
    const result = await run(wrong);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("tokenizer.json pinned as 2 bytes");
    expect(proposed(result.stdout)).toEqual({ models: [COMPLETE] });
  });

  it("fails without proposing anything when the download disagrees with Hugging Face's record", async () => {
    served.lfsSha = "0".repeat(64);
    try {
      const result = await run(COMPLETE);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("is listed as 000000");
      expect(result.stdout).not.toContain('"models"');
    } finally {
      served.lfsSha = null;
    }
  });

  it("refuses a model whose weights come in a separate file the pins cannot cover", async () => {
    served.files["config.json"] = JSON.stringify({
      model_type: "bert",
      "transformers.js_config": { use_external_data_format: true }
    });
    try {
      const result = await run(COMPLETE);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("asks for external data files");
    } finally {
      served.files["config.json"] = FILES["config.json"];
    }
  });

  it("fails on a file the repository does not have at the commit", async () => {
    const result = await run({
      ...COMPLETE,
      files: { ...COMPLETE.files, "tokenizer_config.json": { size: 1, sha256: sha256("x") } }
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`${REPO}@${SHA} has no tokenizer_config.json`);
  });
});
