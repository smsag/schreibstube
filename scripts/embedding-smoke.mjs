/**
 * Start the embedding bundle main.js carries, as a Worker would, and embed two
 * texts with it — no Obsidian, no network.
 *
 * What the unit tests cannot show is that the pieces fit: transformers.js
 * importing the WebAssembly-only build in place of the WebGPU one, the glue
 * that build carries starting from the bytes it is handed, and no fetch of code
 * on the way, and the model's files fetched at their pinned commit and checked
 * against their pinned hashes. So this runs the production bundle, with the
 * Worker prelude in front of it, against a model small enough to write here
 * and a Hugging Face that answers from memory, and reports every request it saw.
 *
 *   node scripts/embedding-smoke.mjs             # pinned runtime, pinned model
 *   node scripts/embedding-smoke.mjs --without   # no runtime: the bundle must refuse
 *   node scripts/embedding-smoke.mjs --unpinned  # no model pin: the bundle must refuse
 *   node scripts/embedding-smoke.mjs --tampered  # a file that changed: the bundle must refuse
 *
 * Prints one line of JSON. The prelude hides `process` from everything after
 * it, this script included, so what it needs of `process` is read first.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { buildEmbeddingBundle } from "./embedding-bundle.mjs";
import { withWorkerPrelude } from "../src/controllers/semantic/host/worker-prelude.ts";

const PIN = JSON.parse(
  readFileSync(new URL("../src/services/semantic/search-runtime.json", import.meta.url), "utf8")
);
const without = process.argv.includes("--without");
const unpinned = process.argv.includes("--unpinned");
const tampered = process.argv.includes("--tampered");
const host = process;
const setExitCode = (code) => (host.exitCode = code);

/** The model: input ids and mask, cast to floats side by side, [b, s, 2]. */
const MODEL = onnxModel();
const REPO = "smoke/model";
const REVISION = "5a0be5a0be5a0be5a0be5a0be5a0be5a0be5a0be";
const FILES = {
  "config.json": JSON.stringify({ model_type: "bert", hidden_size: 2 }),
  "tokenizer_config.json": JSON.stringify({
    tokenizer_class: "PreTrainedTokenizer",
    pad_token: "[PAD]",
    unk_token: "[UNK]",
    model_max_length: 128
  }),
  "tokenizer.json": JSON.stringify({
    version: "1.0",
    truncation: null,
    padding: null,
    added_tokens: ["[PAD]", "[UNK]"].map((content, id) => ({
      id,
      content,
      single_word: false,
      lstrip: false,
      rstrip: false,
      normalized: false,
      special: true
    })),
    normalizer: null,
    pre_tokenizer: { type: "WhitespaceSplit" },
    post_processor: null,
    decoder: null,
    model: {
      type: "WordLevel",
      vocab: { "[PAD]": 0, "[UNK]": 1, hello: 2, world: 3, again: 4 },
      unk_token: "[UNK]"
    }
  }),
  "onnx/model_quantized.onnx": MODEL
};

/** The pin the host would send, over the files as written above. */
const MODEL_PIN = {
  repoId: REPO,
  revision: REVISION,
  files: Object.fromEntries(
    Object.entries(FILES).map(([name, contents]) => {
      const bytes = typeof contents === "string" ? Buffer.from(contents) : contents;
      return [
        name,
        { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
      ];
    })
  )
};

const requested = [];
globalThis.fetch = async (input) => {
  const url = String(input);
  requested.push(url);
  const prefix = `https://huggingface.co/${REPO}/resolve/${REVISION}/`;
  const name = url.startsWith(prefix) ? url.slice(prefix.length) : undefined;
  let file = name === undefined ? undefined : FILES[name];
  // One character of the tokenizer changed, at the same length.
  if (tampered && name === "tokenizer.json") file = file.replace("hello", "hellp");
  return file === undefined
    ? new Response("not found", { status: 404 })
    : new Response(file, { status: 200 });
};

const work = mkdtempSync(join(tmpdir(), "embedding-smoke-"));
const replies = [];
try {
  const bundle = withWorkerPrelude(await buildEmbeddingBundle(esbuild, { minify: true }));
  const file = join(work, "bundle.mjs");
  writeFileSync(file, bundle);
  const wasm = readFileSync(
    new URL(`../node_modules/${PIN.package}/${PIN.source}`, import.meta.url)
  );

  globalThis.self = globalThis;
  globalThis.postMessage = (message) => replies.push(message);
  await import(pathToFileURL(file).href);

  const runtime = without
    ? undefined
    : wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
  const config = {
    id: "smoke",
    label: "smoke",
    repoId: REPO,
    dim: 2,
    maxTokens: 128,
    pooling: "mean"
  };
  const pin = unpinned ? { repoId: REPO, revision: "", files: {} } : MODEL_PIN;
  globalThis.onmessage({ data: { type: "init", config, runtime, pin } });
  globalThis.onmessage({ data: { requestId: 1, texts: ["hello world", "again"] } });
  for (let i = 0; i < 200 && !replies.some((m) => m.requestId === 1); i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const answer = replies.find((m) => m.requestId === 1) ?? null;
  console.log(
    JSON.stringify({
      answer,
      loadError: replies.find((m) => m.type === "model-load-error")?.message ?? null,
      requested,
      nodeVisible: typeof globalThis.process !== "undefined"
    })
  );
  if (!answer) setExitCode(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * The smallest graph a feature-extraction pipeline accepts, written as the
 * protobuf ONNX is: no tool to make one is installed, and the five nodes are
 * clearer read here than shipped as an opaque file.
 */
function onnxModel() {
  const utf8 = new TextEncoder();
  const varint = (value) => {
    let n = BigInt(value);
    const out = [];
    do {
      let byte = Number(n & 0x7fn);
      n >>= 7n;
      if (n > 0n) byte |= 0x80;
      out.push(byte);
    } while (n > 0n);
    return out;
  };
  const int = (field, value) => [...varint(field << 3), ...varint(value)];
  const bytes = (field, data) => {
    const raw = typeof data === "string" ? [...utf8.encode(data)] : [...data];
    return [...varint((field << 3) | 2), ...varint(raw.length), ...raw];
  };
  const message = (field, parts) => bytes(field, parts.flat());
  const dims = (shape) =>
    message(
      2,
      shape.map((dim) => message(1, [typeof dim === "number" ? int(1, dim) : bytes(2, dim)]))
    );
  const value = (field, name, type, shape) =>
    message(field, [bytes(1, name), message(2, [message(1, [int(1, type), dims(shape)])])]);
  const attribute = (name, value) => message(5, [bytes(1, name), int(3, value), int(20, 2)]);
  const op = (inputs, outputs, type, attributes = []) =>
    message(1, [
      ...inputs.map((name) => bytes(1, name)),
      ...outputs.map((name) => bytes(2, name)),
      bytes(4, type),
      ...attributes
    ]);
  const FLOAT = 1;
  const INT64 = 7;
  const axes = message(5, [
    int(1, 1),
    int(2, INT64),
    bytes(8, "axes"),
    bytes(9, new Uint8Array(new BigInt64Array([2n]).buffer))
  ]);
  const graph = [
    op(["input_ids"], ["ids"], "Cast", [attribute("to", FLOAT)]),
    op(["attention_mask"], ["mask"], "Cast", [attribute("to", FLOAT)]),
    op(["ids", "axes"], ["ids3"], "Unsqueeze"),
    op(["mask", "axes"], ["mask3"], "Unsqueeze"),
    op(["ids3", "mask3"], ["last_hidden_state"], "Concat", [attribute("axis", 2)]),
    axes,
    bytes(2, "smoke"),
    value(11, "input_ids", INT64, ["b", "s"]),
    value(11, "attention_mask", INT64, ["b", "s"]),
    value(12, "last_hidden_state", FLOAT, ["b", "s", 2])
  ];
  return new Uint8Array([
    ...int(1, 8),
    ...message(8, [bytes(1, ""), int(2, 13)]),
    ...message(7, graph)
  ]);
}
