/**
 * Which typesetter the plugin runs, and how it knows it got the right one.
 *
 * Typst is compiled to WebAssembly, which is what lets a note become a PDF on
 * a phone with no server in the middle. The module is 28 MB: far too much for
 * a plugin bundle that is parsed on every start, so it is fetched once per
 * device from this plugin's own GitHub release and kept beside the plugin.
 *
 * A binary downloaded at runtime and then executed is the one thing in this
 * plugin that could quietly become something else, so the bytes are pinned.
 * The hashes below are committed; the release workflow verifies them before
 * attaching the files, and the plugin verifies them again before loading. A
 * mismatch is refused and reported — never loaded and never repaired silently.
 */

/** The typst.ts release these hashes belong to. Bumped deliberately. */
export const RUNTIME_VERSION = "0.7.0";

/**
 * Roughly what a device downloads, in megabytes, for a sentence a person reads.
 *
 * Rounded and stated rather than measured: it is used to warn somebody before
 * they spend it, and "about 28 MB" is what that sentence needs. The exact size
 * is whatever the pinned bytes weigh.
 */
export const RUNTIME_MEGABYTES = 28;

/** The Typst language version that build compiles. Templates are written for it. */
export const TYPST_VERSION = "0.14";

export interface RuntimeAsset {
  /** The file's name on the release and in the plugin's folder. */
  name: string;
  /** Lowercase hex SHA-256 of the exact bytes that must arrive. */
  sha256: string;
  /** What it is, for a message a person reads while waiting. */
  label: "compiler" | "loader";
}

/**
 * The two files the compiler is.
 *
 * Both come from `@myriaddreamin/typst-ts-web-compiler` at the pinned version:
 * the WebAssembly module itself, and the small JavaScript that instantiates it
 * and marshals calls across. They are separate assets rather than an archive
 * because unpacking one would mean carrying an unpacker for no gain.
 */
export const RUNTIME_ASSETS: readonly RuntimeAsset[] = [
  {
    name: `typst-runtime-${RUNTIME_VERSION}.wasm`,
    sha256: "1fc968438a672366dfec39c96c842c26ed29caff4eb1bcaab19a6c60867de5fd",
    label: "compiler"
  },
  {
    name: `typst-runtime-${RUNTIME_VERSION}.mjs`,
    sha256: "96735c6da3dd220255ba368e34c695227fc67e0b4104e7a8e039dd9bc2fc5312",
    label: "loader"
  }
];

export const WASM_ASSET = RUNTIME_ASSETS[0] as RuntimeAsset;
export const LOADER_ASSET = RUNTIME_ASSETS[1] as RuntimeAsset;

/** Where the npm package keeps each file, for the script that builds the assets. */
export const RUNTIME_PACKAGE = "@myriaddreamin/typst-ts-web-compiler";
export const RUNTIME_SOURCE_PATHS: Record<string, string> = {
  [WASM_ASSET.name]: "package/pkg/typst_ts_web_compiler_bg.wasm",
  [LOADER_ASSET.name]: "package/pkg/typst_ts_web_compiler.mjs"
};

/**
 * Where a device fetches the runtime.
 *
 * From the release of the plugin version that is installed, so the pair is
 * always the pair that was tested together, and a vault that never updates
 * keeps working against the release it has.
 */
export function runtimeAssetUrl(pluginVersion: string, asset: RuntimeAsset): string {
  return `https://github.com/smsag/schreibstube/releases/download/${encodeURIComponent(
    pluginVersion
  )}/${asset.name}`;
}

/** Where it is kept once fetched: beside the plugin, not inside the vault's notes. */
export function runtimeCachePath(pluginDir: string, asset: RuntimeAsset): string {
  return `${pluginDir.replace(/\/+$/, "")}/${asset.name}`;
}

/** A digest as the hashes above are written. */
export function toHex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether these bytes are the ones that were pinned.
 *
 * Returns the problem rather than a boolean: every caller has to say what went
 * wrong, and "the compiler downloaded for printing does not match what this
 * version of the plugin expects" is the whole message.
 */
export function checkRuntimeBytes(asset: RuntimeAsset, actualSha256: string): string | null {
  if (actualSha256 === asset.sha256) return null;
  return `${asset.name}: expected ${short(asset.sha256)}, got ${short(actualSha256)}`;
}

function short(hash: string): string {
  return hash.slice(0, 12);
}

/** What the compiler answered: a document, or the reasons it could not make one. */
export type CompileOutcome = { ok: true; pdf: Uint8Array } | { ok: false; diagnostics: string[] };

/**
 * Read the compiler's answer.
 *
 * Success is a `result` holding the bytes; failure is a list of messages that
 * already name the file, the line and the column. Those messages are the
 * template author's, so they are passed through rather than summarised — with
 * the job's own file names in them, which are the template's file names.
 */
export function readCompileResult(value: unknown): CompileOutcome {
  if (value instanceof Uint8Array) return { ok: true, pdf: value };

  const record = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;

  if (record.result instanceof Uint8Array) return { ok: true, pdf: record.result };

  const diagnostics = Array.isArray(record.diagnostics)
    ? record.diagnostics.map((entry) => String(entry))
    : [];
  return {
    ok: false,
    diagnostics: diagnostics.length > 0 ? diagnostics : ["the compiler gave no answer"]
  };
}

/**
 * The diagnostics, as a person reading a notice can take them.
 *
 * The first two lines only: a Typst error cascades, and the third message is
 * usually the second one's consequence. The panel has the rest.
 */
export function describeDiagnostics(diagnostics: readonly string[]): string {
  const lines = diagnostics.slice(0, 2).map((line) => line.replace(/^\/main\.typ:/, "note:"));
  return diagnostics.length > 2
    ? `${lines.join("; ")} (+${diagnostics.length - 2})`
    : lines.join("; ");
}
