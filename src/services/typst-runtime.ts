/**
 * Which typesetter the plugin runs, and how it knows it got the right one:
 * the pinned bytes of the compiler and the fonts. PRINTING.md says why they
 * are fetched once per device and hashed on every start.
 */
import type { BlockPosition } from "./print-breaks";
import type { SlideFit } from "./print-slides";
import { t } from "../i18n";
import { declaredLength, exceedsBytes } from "./response-size";
import FONT_MANIFEST from "./typst-fonts.json";

/** The typst.ts release these hashes belong to. Bumped deliberately. */
export const RUNTIME_VERSION = "0.7.0";

/**
 * Roughly what a device downloads, in megabytes, for a sentence a person
 * reads: the compiler and the standard fonts together.
 *
 * Rounded and stated rather than measured: it is used to warn somebody before
 * they spend it, and a round figure is what that sentence needs. The exact
 * size is whatever the pinned bytes weigh.
 */
export const RUNTIME_MEGABYTES = 35;

/** Of that, the compiler alone, for the sentence said while it arrives. */
export const COMPILER_MEGABYTES = 28;

/** The Typst language version that build compiles. Templates are written for it. */
export const TYPST_VERSION = "0.14";

export interface RuntimeAsset {
  /** The file's name on the release and in the plugin's folder. */
  name: string;
  /** Lowercase hex SHA-256 of the exact bytes that must arrive. */
  sha256: string;
  /** What it is, for a message a person reads while waiting. */
  label: "compiler" | "loader" | "font";
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

/**
 * One set of the faces a device keeps beside the compiler, pinned in
 * `typst-fonts.json` because the release script reads the same file, and a
 * second copy of a hash is how the two would come apart. PRINTING.md says
 * which sets and why.
 */
export interface FontSet {
  /** What is in the set, for a person reading the manifest. */
  family: string;
  /** The upstream release, which also names the files on the release. */
  version: string;
  /** Where the release workflow fetches the files; `source + file`. */
  source: string;
  files: readonly { file: string; sha256: string }[];
}

/** How a font asset is named: under the release's `typst-runtime-*` glob, and by version. */
const FONT_PREFIX = "typst-runtime-fonts-";

export const FONT_SETS: readonly FontSet[] = FONT_MANIFEST.sets;

/** The fonts as release assets: named so the release's `typst-runtime-*` glob carries them. */
export const FONT_ASSETS: readonly RuntimeAsset[] = FONT_SETS.flatMap((set) =>
  set.files.map(({ file, sha256 }) => ({
    name: fontAssetName(set.version, file),
    sha256,
    label: "font" as const
  }))
);

/** Everything a device keeps beside the plugin to print. */
export const DEVICE_ASSETS: readonly RuntimeAsset[] = [...RUNTIME_ASSETS, ...FONT_ASSETS];

export function fontAssetName(version: string, file: string): string {
  return `${FONT_PREFIX}${version}-${file}`;
}

/** The face a font asset holds, for a message: `LibertinusSerif-Bold`. */
export function fontFaceOf(asset: RuntimeAsset): string {
  return asset.name
    .slice(FONT_PREFIX.length)
    .replace(/^[\w.]+?-(?=[A-Z])/, "")
    .replace(/\.[^.]+$/, "");
}

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

/**
 * Runtime files beside the plugin that no longer belong to it.
 *
 * Bumping the pinned version leaves the previous 28 MB where it was: nothing
 * reads it again, and nobody can see it from inside the app. Only files named
 * the way this module names them are ever offered, so a person's own file in
 * the plugin folder is never at risk.
 */
export function staleRuntimeFiles(names: readonly string[]): string[] {
  const current = new Set(DEVICE_ASSETS.map((asset) => asset.name));
  return names.filter(
    (name) => /^typst-runtime-[\w.-]+\.(wasm|mjs|otf|ttf)$/.test(name) && !current.has(name)
  );
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

/**
 * The most a download of each kind may weigh, a little above what the pinned
 * files weigh: the compiler 28.3 MB, its loader 60 KB, the largest font 507 KB.
 *
 * The hash already refuses wrong bytes, but only once they are all in memory;
 * a release asset swapped for something far larger would be held whole on a
 * phone before it was found wrong. A pin that grows past its bound fails
 * loudly on the first print rather than quietly, and the bound moves with it.
 */
export const MAX_ASSET_BYTES: Readonly<Record<RuntimeAsset["label"], number>> = {
  compiler: 32_000_000,
  loader: 256_000,
  font: 1_000_000
};

/** Why a download is refused for its size, or null when it is not. */
export function checkDownloadSize(
  asset: RuntimeAsset,
  headers: Record<string, string> | undefined,
  body: ArrayBuffer | Uint8Array
): string | null {
  const max = MAX_ASSET_BYTES[asset.label];
  if (!exceedsBytes(headers, body, max)) return null;
  const size = Math.max(declaredLength(headers) ?? 0, body.byteLength);
  return `${asset.name}: ${size} bytes, at most ${max}`;
}

function short(hash: string): string {
  return hash.slice(0, 12);
}

/** What the compiler answered: a document, or the reasons it could not make one. */
export type CompileOutcome =
  | {
      ok: true;
      pdf: Uint8Array;
      /** The slides the fit made smaller, when the document has any. */
      fits?: SlideFit[];
      /** Where each marked block starts, when the converter marked them. */
      blocks?: BlockPosition[];
    }
  | { ok: false; diagnostics: string[] };

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
    diagnostics: diagnostics.length > 0 ? diagnostics : [t().print.compilerSilent]
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
