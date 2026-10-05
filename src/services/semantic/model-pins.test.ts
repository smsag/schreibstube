import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import PINS from "./model-pins.json";
import { EMBEDDING_MODELS } from "./embedding-models";
import {
  checkModelFile,
  isModelPinError,
  isSizeProbe,
  MAX_MODEL_FILE_BYTES,
  MODEL_FILES,
  modelFileUrl,
  modelPinFor,
  pinnedFetch,
  pinnedFileOf,
  readModelPin,
  readPinnedBody,
  type ModelPin
} from "./model-pins";

const REPO = "someone/model";
const REVISION = "0123456789abcdef0123456789abcdef01234567";

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A complete pin over these contents, one per model file. */
function pinOf(contents: Record<string, string>): ModelPin {
  const files = Object.fromEntries(
    Object.entries(contents).map(([name, text]) => [
      name,
      { size: Buffer.byteLength(text), sha256: hash(text) }
    ])
  );
  return { repoId: REPO, revision: REVISION, files };
}

const CONTENTS = Object.fromEntries(MODEL_FILES.map((name) => [name, `contents of ${name}`]));
const PIN = pinOf(CONTENTS);

describe("the committed pins", () => {
  it("name every model this plugin can run, each with exactly the files the pipeline fetches", () => {
    const repos = Object.values(EMBEDDING_MODELS).map((model) => model.repoId);
    expect(PINS.models.map((model) => model.repoId).sort()).toEqual([...repos].sort());
    for (const model of PINS.models) {
      expect(Object.keys(model.files).sort()).toEqual([...MODEL_FILES].sort());
    }
  });

  it("are each either empty, waiting for CI's values, or complete — never half of one", () => {
    // Read as CI will leave it, not as the empty file types it today.
    const models = PINS.models as {
      repoId: string;
      revision: string;
      files: Record<string, { size: unknown; sha256: string }>;
    }[];
    for (const model of models) {
      const pin = readModelPin(model, model.repoId);
      const empty =
        model.revision === "" &&
        Object.values(model.files).every((file) => file.size === null && file.sha256 === "");
      expect(empty || typeof pin !== "string").toBe(true);
    }
  });
});

describe("readModelPin", () => {
  it("accepts a complete pin for the repository asked about", () => {
    expect(readModelPin(PIN, REPO)).toEqual(PIN);
    expect(readModelPin(modelPinFor(REPO, { models: [PIN] }), REPO)).toEqual(PIN);
  });

  it("refuses a pin that is absent, empty, for another repository or malformed", () => {
    const cases: [unknown, RegExp][] = [
      [null, /no pin for someone\/model/],
      [modelPinFor(REPO, { models: [] }), /no pin for/],
      [modelPinFor(REPO, "nonsense"), /no pin for/],
      [{ ...PIN, repoId: "other/model" }, /no pin for/],
      [{ ...PIN, revision: "" }, /has no pinned revision/],
      [{ ...PIN, revision: "main" }, /has no pinned revision/],
      [{ ...PIN, files: {} }, /config\.json of someone\/model is not pinned/],
      [
        { ...PIN, files: { ...PIN.files, "tokenizer.json": { size: null, sha256: "" } } },
        /tokenizer\.json/
      ],
      [
        { ...PIN, files: { ...PIN.files, "config.json": { size: 0, sha256: hash("") } } },
        /config\.json/
      ],
      [
        {
          ...PIN,
          files: {
            ...PIN.files,
            "config.json": { size: MAX_MODEL_FILE_BYTES + 1, sha256: hash("") }
          }
        },
        /config\.json/
      ],
      [
        { ...PIN, files: { ...PIN.files, "config.json": { size: 4, sha256: "ABC" } } },
        /config\.json/
      ]
    ];
    for (const [raw, problem] of cases) {
      const read = readModelPin(raw, REPO);
      expect(read).toMatch(problem);
      expect(isModelPinError(read)).toBe(true);
    }
  });
});

describe("pinnedFileOf", () => {
  it("knows a pinned file at the pinned commit, and nothing else", () => {
    expect(modelFileUrl(PIN, "config.json")).toBe(
      `https://huggingface.co/${REPO}/resolve/${REVISION}/config.json`
    );
    expect(pinnedFileOf(PIN, modelFileUrl(PIN, "onnx/model_quantized.onnx"))).toEqual({
      file: "onnx/model_quantized.onnx",
      pinned: PIN.files["onnx/model_quantized.onnx"]
    });
    for (const url of [
      `https://huggingface.co/${REPO}/resolve/main/config.json`,
      modelFileUrl(PIN, "onnx/model.onnx"),
      modelFileUrl({ repoId: "other/model", revision: REVISION }, "config.json"),
      "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs"
    ]) {
      expect(pinnedFileOf(PIN, url)).toMatch(/model pin missing: .* is not a pinned file/);
    }
  });
});

describe("checkModelFile", () => {
  const pinned = { size: 4, sha256: hash("abcd") };
  it("passes the pinned bytes and names what differs otherwise", () => {
    expect(checkModelFile("f", pinned, 4, hash("abcd"))).toBeNull();
    expect(checkModelFile("f", pinned, 5, hash("abcd"))).toBe(
      "model pin mismatch: f: expected 4 bytes, got 5"
    );
    expect(checkModelFile("f", pinned, 4, hash("abce"))).toMatch(
      /^model pin mismatch: f: expected /
    );
  });
});

describe("readPinnedBody", () => {
  const pinned = { size: 4, sha256: hash("abcd") };
  const chunked = (...chunks: string[]): Response =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        }
      })
    );

  it("returns the pinned bytes however they were chunked", async () => {
    const bytes = await readPinnedBody(chunked("ab", "c", "d"), "f", pinned);
    expect(new TextDecoder().decode(bytes)).toBe("abcd");
  });

  it("refuses a declared length over the pin before reading", async () => {
    const response = new Response("abcdef", { headers: { "content-length": "6" } });
    await expect(readPinnedBody(response, "f", pinned)).rejects.toThrow(
      "model pin mismatch: f: expected 4 bytes, got 6"
    );
  });

  it("stops reading at the first byte past the pin", async () => {
    await expect(readPinnedBody(chunked("abc", "de"), "f", pinned)).rejects.toThrow(
      /got more than that/
    );
  });

  it("refuses a body that is short, or the right length with other bytes", async () => {
    await expect(readPinnedBody(chunked("abc"), "f", pinned)).rejects.toThrow(/got 3/);
    await expect(readPinnedBody(chunked("abce"), "f", pinned)).rejects.toThrow(
      /model pin mismatch/
    );
  });
});

describe("pinnedFetch", () => {
  const served = (url: string): Response => {
    const prefix = modelFileUrl(PIN, "");
    const name = url.slice(prefix.length);
    return name in CONTENTS
      ? new Response(CONTENTS[name], { headers: { "content-type": "application/json" } })
      : new Response("not found", { status: 404 });
  };

  it("hands on a pinned file once it has been checked", async () => {
    const requested: string[] = [];
    const fetch = pinnedFetch(async (input) => {
      requested.push(String(input));
      return served(String(input));
    }, PIN);
    const response = await fetch(modelFileUrl(PIN, "tokenizer.json"));
    expect(await response.text()).toBe(CONTENTS["tokenizer.json"]);
    expect(response.headers.get("content-length")).toBe(String(PIN.files["tokenizer.json"]?.size));
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(requested).toEqual([modelFileUrl(PIN, "tokenizer.json")]);
  });

  it("makes no request for anything that is not pinned", async () => {
    const requested: string[] = [];
    const fetch = pinnedFetch(async (input) => {
      requested.push(String(input));
      return served(String(input));
    }, PIN);
    await expect(fetch(`https://huggingface.co/${REPO}/resolve/main/config.json`)).rejects.toThrow(
      /model pin missing/
    );
    expect(requested).toEqual([]);
  });

  it("refuses a file that changed, and passes a failed answer on as it came", async () => {
    const tampered = pinnedFetch(async () => new Response("{}"), PIN);
    await expect(tampered(modelFileUrl(PIN, "config.json"))).rejects.toThrow(/model pin mismatch/);
    const missing = pinnedFetch(async () => new Response("gone", { status: 404 }), PIN);
    expect((await missing(modelFileUrl(PIN, "config.json"))).status).toBe(404);
  });

  it("answers a size probe from the pin, at any revision, without a request", async () => {
    const requested: string[] = [];
    const fetch = pinnedFetch(async (input) => {
      requested.push(String(input));
      return served(String(input));
    }, PIN);
    const atMain = await fetch(
      `https://huggingface.co/${REPO}/resolve/main/tokenizer_config.json`,
      {
        method: "GET",
        headers: new Headers({ Range: "bytes=0-0" }),
        cache: "no-store"
      }
    );
    expect(atMain.status).toBe(206);
    expect(atMain.headers.get("content-range")).toBe(
      `bytes 0-0/${PIN.files["tokenizer_config.json"]?.size}`
    );
    const head = await fetch(modelFileUrl(PIN, "config.json"), { method: "HEAD" });
    expect(head.status).toBe(206);
    const absent = await fetch(modelFileUrl(PIN, "preprocessor_config.json"), { method: "HEAD" });
    expect(absent.status).toBe(404);
    await expect(
      fetch("https://huggingface.co/other/model/resolve/main/config.json", { method: "HEAD" })
    ).rejects.toThrow(/model pin missing/);
    expect(requested).toEqual([]);
  });
});

describe("isSizeProbe", () => {
  it("knows a HEAD and a one-byte Range request, and nothing else", () => {
    expect(isSizeProbe({ method: "HEAD" })).toBe(true);
    expect(isSizeProbe({ headers: { Range: "bytes=0-0" } })).toBe(true);
    expect(isSizeProbe({ headers: { Range: "bytes=0-99" } })).toBe(false);
    expect(isSizeProbe({ method: "GET" })).toBe(false);
    expect(isSizeProbe()).toBe(false);
  });
});

describe("isModelPinError", () => {
  it("knows a pin refusal after it has crossed from a Worker as text", () => {
    expect(isModelPinError(new Error("Embedding worker: model pin mismatch: config.json"))).toBe(
      true
    );
    expect(isModelPinError("model pin missing: x")).toBe(true);
    expect(isModelPinError(new Error("Out of memory"))).toBe(false);
  });
});
