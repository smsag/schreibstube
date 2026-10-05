/**
 * Which files of each search model a device accepts: one commit of the
 * model's repository, and the length and SHA-256 of every file the pipeline
 * reads from it.
 *
 * The model files are data, not code — the pinned runtime reads them — but
 * they decide what search by meaning finds, and one of the repositories is a
 * personal account's. Fetched from `main`, any push there reached every
 * device on its next first load. Pinned, a device fetches exactly the commit
 * this version was checked against and refuses a byte that differs.
 *
 * The pins live in JSON because `scripts/check-model-pins.mjs` reads the same
 * file in CI and prints the values to commit; nothing here is typed by hand.
 * A pin that is empty or malformed is refused rather than skipped: search by
 * meaning does not load an unpinned model.
 */
import PINS from "./model-pins.json";

export interface PinnedFile {
  size: number;
  sha256: string;
}

export interface ModelPin {
  repoId: string;
  /** A full commit id of the model's repository. */
  revision: string;
  /** Every file the pipeline fetches, by its path in the repository. */
  files: Record<string, PinnedFile>;
}

/** Where the model files come from. */
export const MODEL_HOST = "https://huggingface.co";

/**
 * The files transformers.js asks for with this plugin's settings — feature
 * extraction, 8-bit weights — as the smoke run observes them. A pin covers
 * exactly these; `model-pins.test.ts` holds the JSON to the list.
 */
export const MODEL_FILES = [
  "config.json",
  "tokenizer_config.json",
  "tokenizer.json",
  "onnx/model_quantized.onnx"
] as const;

/**
 * The most a device reads of one model file before refusing it, whatever its
 * pin says: the largest model's weights are about 120 MB.
 */
export const MAX_MODEL_FILE_BYTES = 512 * 1024 * 1024;

/**
 * Every refusal starts with this, so the host can tell a pin problem from a
 * backend that would not start when the message has crossed from a Worker as
 * plain text — and stop rather than try the next backend, which would be
 * refused the same way.
 */
const MISSING = "model pin missing";
const MISMATCH = "model pin mismatch";

export function isModelPinError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(MISSING) || message.includes(MISMATCH);
}

/** The pin this version carries for a repository, as written; checked where it is used. */
export function modelPinFor(repoId: string, pins: unknown = PINS): unknown {
  const models = (pins as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return null;
  return (
    models.find((entry: unknown) => (entry as { repoId?: unknown } | null)?.repoId === repoId) ??
    null
  );
}

/**
 * The pin, if it is complete and for this repository; otherwise what is
 * missing. It may have crossed from another context, so nothing about its
 * shape is promised.
 */
export function readModelPin(raw: unknown, repoId: string): ModelPin | string {
  const entry = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (entry.repoId !== repoId) return `${MISSING}: no pin for ${repoId} in this version`;
  const revision = entry.revision;
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) {
    return `${MISSING}: ${repoId} has no pinned revision in this version`;
  }
  const rawFiles = (
    typeof entry.files === "object" && entry.files !== null ? entry.files : {}
  ) as Record<string, unknown>;
  const files: Record<string, PinnedFile> = {};
  for (const name of MODEL_FILES) {
    const file = (rawFiles[name] ?? {}) as { size?: unknown; sha256?: unknown };
    if (
      typeof file.size !== "number" ||
      !Number.isInteger(file.size) ||
      file.size <= 0 ||
      file.size > MAX_MODEL_FILE_BYTES ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    ) {
      return `${MISSING}: ${name} of ${repoId} is not pinned in this version`;
    }
    files[name] = { size: file.size, sha256: file.sha256 };
  }
  return { repoId, revision, files };
}

/** A file's address at the pinned commit; also the key the browser caches it under. */
export function modelFileUrl(pin: Pick<ModelPin, "repoId" | "revision">, file: string): string {
  return `${MODEL_HOST}/${pin.repoId}/resolve/${pin.revision}/${file}`;
}

/** Which pinned file a request is for, or why it may not be made. */
export function pinnedFileOf(
  pin: ModelPin,
  url: string
): { file: string; pinned: PinnedFile } | string {
  const prefix = modelFileUrl(pin, "");
  const file = url.startsWith(prefix) ? url.slice(prefix.length) : null;
  const pinned = file === null ? undefined : pin.files[file];
  if (file === null || pinned === undefined) {
    return `${MISSING}: ${url} is not a pinned file of ${pin.repoId}`;
  }
  return { file, pinned };
}

/** Whether the bytes that arrived are the pinned ones: the length first, then the hash. */
export function checkModelFile(
  file: string,
  pinned: PinnedFile,
  size: number,
  actualSha256: string
): string | null {
  if (size !== pinned.size) {
    return `${MISMATCH}: ${file}: expected ${pinned.size} bytes, got ${size}`;
  }
  if (actualSha256 !== pinned.sha256) {
    return `${MISMATCH}: ${file}: expected ${pinned.sha256.slice(0, 12)}, got ${actualSha256.slice(0, 12)}`;
  }
  return null;
}

/**
 * Read a response's body, never past the pinned length, and check it.
 *
 * Read into one buffer of the pinned size, so a file that is too long is
 * refused at the first byte over rather than after it has all arrived, and
 * the check costs no second copy.
 */
export async function readPinnedBody(
  response: Response,
  file: string,
  pinned: PinnedFile
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > pinned.size) {
    await response.body?.cancel();
    throw new Error(`${MISMATCH}: ${file}: expected ${pinned.size} bytes, got ${declared}`);
  }
  const buffer = new Uint8Array(pinned.size);
  let length = 0;
  const reader = response.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > pinned.size) {
        await reader.cancel();
        throw new Error(`${MISMATCH}: ${file}: expected ${pinned.size} bytes, got more than that`);
      }
      buffer.set(value, length);
      length += value.byteLength;
    }
  }
  const bytes = buffer.subarray(0, length);
  // The view itself, not a copy of it: on a phone a second 75 MB is not spare.
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const problem = checkModelFile(file, pinned, length, digest);
  if (problem !== null) throw new Error(problem);
  return bytes;
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Whether a request only asks how large a file is: a HEAD, or the one-byte
 * Range request transformers.js sends for it.
 */
export function isSizeProbe(init?: RequestInit): boolean {
  if (init?.method === "HEAD") return true;
  return new Headers(init?.headers).get("range") === "bytes=0-0";
}

/**
 * The answer to a size probe, from the pin rather than the network.
 *
 * transformers.js 4.3 probes some files without the revision it was given —
 * the tokenizer's settings, at `main` — only to learn whether they exist and
 * how large they are. Both are what the pin states, so the probe is answered
 * here and never sent: no request at an unpinned revision leaves the device,
 * and the file itself is fetched at the pinned one. A file the pin does not
 * name does not exist, as far as this model is concerned.
 */
export function probeAnswer(pin: ModelPin, url: string): Response {
  const prefix = `${MODEL_HOST}/${pin.repoId}/resolve/`;
  const rest = url.startsWith(prefix) ? url.slice(prefix.length) : null;
  const slash = rest === null ? -1 : rest.indexOf("/");
  if (rest === null || slash <= 0) {
    throw new Error(`${MISSING}: ${url} is not a file of ${pin.repoId}`);
  }
  const pinned = pin.files[rest.slice(slash + 1)];
  if (pinned === undefined) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 206,
    headers: { "content-range": `bytes 0-0/${pinned.size}` }
  });
}

/**
 * A fetch that reaches only the pinned files of one model, at the pinned
 * commit, and hands transformers.js a file only once it has been checked.
 *
 * Anything else is refused before a request is made, and a size probe is
 * answered from the pin (`probeAnswer`). A response the server did not answer
 * with success is passed on as it is, so the library reports a missing file
 * the way it always has.
 */
export function pinnedFetch(fetchImpl: Fetch, pin: ModelPin): Fetch {
  return async (input, init) => {
    const url = String(input);
    if (isSizeProbe(init)) return probeAnswer(pin, url);
    const target = pinnedFileOf(pin, url);
    if (typeof target === "string") throw new Error(target);
    const response = await fetchImpl(url, init);
    if (!response.ok) return response;
    const bytes = await readPinnedBody(response, target.file, target.pinned);
    const headers = new Headers({ "content-length": String(bytes.byteLength) });
    const type = response.headers.get("content-type");
    if (type) headers.set("content-type", type);
    return new Response(bytes as BodyInit, { status: 200, headers });
  };
}
