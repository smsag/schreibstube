/**
 * The publish capability: its routes and the order they happen in.
 *
 *   plan     hash comparison against the manifest; nothing is written
 *   source   upload one note, addressed by the hash of its content
 *   asset    upload one image or video, sent as raw bytes
 *   commit   render every note, write what changed, delete what went, save state
 *   render   rebuild from stored state alone, for a template change
 */
import { createHash } from "node:crypto";
import { httpError } from "../http.mjs";
import { TimeoutError, withDeadline } from "../timeout.mjs";
import {
  buildManifest,
  diffOutputs,
  normalizeManifest,
  orphanSources,
  planUploads
} from "./manifest.mjs";
import {
  assetPath,
  checkRelativePath,
  extensionOf,
  isThumbnailFormat,
  MAX_THUMBNAIL_BYTES,
  PathError,
  thumbnailExtension,
  thumbnailPath,
  VIDEO_EXTENSIONS
} from "./path.mjs";
import { RENDER_VERSION } from "./render/markdown.mjs";
import { buildSite, checkIndex, IndexError, sha256 } from "./site.mjs";
import { isSafeSvg } from "./site-icon.mjs";
import { connect, SftpError } from "./sftp.mjs";
import { createConnectionPool } from "./connection-pool.mjs";
import { mapLimit, SFTP_CONCURRENCY } from "./pool.mjs";
import { SourceCache } from "./source-cache.mjs";

const MANIFEST_FILE = "manifest.json";
const HISTORY_FILE = "history.json";
/** How many publishes the history keeps. Enough to answer "when did that page
 *  change", small enough that the file stays a file. */
const HISTORY_LENGTH = 50;
const INDEX_FILE = "index.json";
const SOURCE_DIRECTORY = "src";
const STATE_GUARD_FILE = ".htaccess";

/** The deny file for a state directory that lies inside the web root. */
export const STATE_GUARD = [
  "# Written by the Schreibstube bridge. Nothing in here is part of the site.",
  "<IfModule mod_authz_core.c>",
  "  Require all denied",
  "</IfModule>",
  "<IfModule !mod_authz_core.c>",
  "  Order allow,deny",
  "  Deny from all",
  "</IfModule>",
  ""
].join("\n");

/** Uploaded raster formats whose first bytes are checked, by the thumbnail
 *  helper's name for each. The other formats a target may serve have no
 *  helper and are taken on their extension, as before. */
const RASTER_SIGNATURES = new Map([
  ["png", "png"],
  ["jpg", "jpg"],
  ["jpeg", "jpg"]
]);

export function createPublishRoutes(config, { version }) {
  const publish = config.publish;
  const generator = `schreibstube-bridge/${version}`;
  const busy = new Set();
  const pool = createConnectionPool({
    connect: (name) => open(publish.targets[name], config)
  });
  const cache = new SourceCache();
  // Assets and thumbnails written since the last commit, per target: the
  // commit has to know a file is on the host before a page may point at it or
  // the manifest may claim it, and one it does not know of — the bridge
  // restarted in between — is asked for again by the next plan.
  const uploads = new UploadLedger();
  // Targets whose state directory is known to carry its deny file, so the
  // check costs one round trip per target and process rather than per upload.
  const guarded = new Set();
  const guard = async (remote, target) => {
    if (!target.stateInsideRoot || guarded.has(target.name)) return;
    await guardState(remote);
    guarded.add(target.name);
  };

  const route = (method, path, maxBytes, bodyType, handler, timeoutMs) => ({
    method,
    path,
    capability: "publish",
    maxBytes,
    bodyType,
    handler,
    timeoutMs
  });

  // Publishing is slower than anything mail does: an upload crosses a domestic
  // connection, and a commit renders every page before writing what differs.
  const uploadTimeoutMs = Math.max(config.requestTimeoutMs, 180_000);
  const commitTimeoutMs = Math.max(config.requestTimeoutMs, 300_000);

  return [
    route("GET", "/publish/targets", 0, "none", async () => ({
      targets: Object.values(publish.targets).map((target) => ({
        name: target.name,
        baseUrl: target.baseUrl,
        siteTitle: target.siteTitle
      }))
    })),

    route("POST", "/publish/diagnostics", 64_000, "json", async ({ body, log }) => {
      const target = targetOf(publish, body?.target);
      try {
        const remote = await open(target, config);
        try {
          // Listing a directory that is not there answers "empty", which is
          // not the answer: a site cannot be written to a root that is missing.
          if ((await remote.exists(target.root)) !== "d") {
            return { ok: false, target: target.name, error: "The web root does not exist." };
          }
          const entries = await remote.listNames(target.root);
          return { ok: true, target: target.name, root: target.root, entries: entries.length };
        } finally {
          await remote.end();
        }
      } catch (err) {
        log("warn", `diagnostics ${target.name}: ${detailOf(err)}`);
        return { ok: false, target: target.name, error: clientMessage(err) };
      }
    }),

    route("POST", "/publish/plan", publish.maxIndexBytes, "json", async ({ body, log }) => {
      const target = targetOf(publish, body?.target);
      const index = validateIndex(body?.index, publish);

      return withRemote(pool, target, config.requestTimeoutMs, async (remote) => {
        const manifest = normalizeManifest(
          await remote.readJson(remote.stateAbsolute(MANIFEST_FILE)),
          target.name
        );
        const stored = await storedSourceHashes(remote);
        const plan = planUploads({ index, manifest, storedSourceHashes: stored });

        log(
          "info",
          `plan ${target.name}: ${plan.uploadSources.length} source(s), ` +
            `${plan.uploadAssets.length} asset(s), ${plan.willDelete.length} to delete`
        );
        return { target: target.name, baseUrl: target.baseUrl, ...plan };
      });
    }),

    route(
      "PUT",
      "/publish/source",
      publish.maxSourceBytes,
      "raw",
      async ({ body, query, log }) => {
        const target = targetOf(publish, query.get("target"));
        const hash = verifyHash(body, query.get("sha256"));

        return withRemote(pool, target, uploadTimeoutMs, async (remote) => {
          await guard(remote, target);
          await remote.writeAbsolute(remote.stateAbsolute(`${SOURCE_DIRECTORY}/${hash}.md`), body);
          // The commit that follows renders this note; it need not read it back.
          cache.set(hash, body);
          log(
            "info",
            `source ${hash.slice(0, 12)} stored for ${target.name} (${body.length} bytes)`
          );
          return { sha256: hash, bytes: body.length };
        });
      },
      uploadTimeoutMs
    ),

    route(
      "PUT",
      "/publish/asset",
      // The limit for the kind of file the name says, decided before the body
      // is read: held to the video limit and checked against the image one
      // afterwards, an image upload could occupy two and a half times the
      // memory its own limit allows.
      (query) => assetLimit(publish, query.get("name") ?? ""),
      "raw",
      async ({ body, query, log }) => {
        const target = targetOf(publish, query.get("target"));
        const hash = verifyHash(body, query.get("sha256"));
        const name = query.get("name") ?? "";

        const extension = extensionOf(name);
        if (!target.assetExtensions.has(extension)) {
          throw httpError(
            400,
            "asset_rejected",
            `Not an allowed asset type: ${extension || name}.`
          );
        }
        if (!isAssetContent(body, extension)) {
          throw httpError(400, "asset_rejected", `Not a ${extension} the site can serve.`);
        }

        const path = safePath(assetPath(hash, name), target);

        return withRemote(pool, target, uploadTimeoutMs, async (remote) => {
          await remote.writeFile(path, body);
          uploads.record(target.name, path, { sha256: hash, bytes: body.length });
          log("info", `asset ${path} stored for ${target.name} (${body.length} bytes)`);
          return { sha256: hash, bytes: body.length, path };
        });
      },
      uploadTimeoutMs
    ),

    route(
      "PUT",
      "/publish/thumbnail",
      MAX_THUMBNAIL_BYTES,
      "raw",
      async ({ body, query, log }) => {
        const target = targetOf(publish, query.get("target"));
        const hash = verifyHash(body, query.get("sha256"));
        const source = String(query.get("source") ?? "");
        const name = query.get("name") ?? "";
        if (!/^[0-9a-f]{64}$/.test(source)) {
          throw httpError(400, "invalid_request", "A source query parameter is required.");
        }

        // Named after the picture it shows, so its own bytes are checked for
        // what they claim to be: a thumbnail, of the format the name implies.
        const extension = thumbnailExtension(name);
        if (!extension || !isThumbnailFormat(body, extension)) {
          throw httpError(400, "thumbnail_rejected", "Not a thumbnail the site can serve.");
        }
        const path = safePath(thumbnailPath(source, name), target);

        return withRemote(pool, target, uploadTimeoutMs, async (remote) => {
          await remote.writeFile(path, body);
          uploads.record(target.name, path, { sha256: hash, bytes: body.length });
          log("info", `thumbnail ${path} stored for ${target.name} (${body.length} bytes)`);
          return { sha256: hash, bytes: body.length, path };
        });
      },
      uploadTimeoutMs
    ),

    route(
      "POST",
      "/publish/commit",
      publish.maxIndexBytes,
      "json",
      async ({ body, log }) => {
        const target = targetOf(publish, body?.target);
        const index = validateIndex(body?.index, publish);

        return exclusive(busy, target.name, () =>
          withRemote(pool, target, commitTimeoutMs, async (remote) => {
            await guard(remote, target);
            const stored = await storedSourceHashes(remote);
            const storedSet = new Set(stored);
            const missing = index.notes.filter((note) => !storedSet.has(note.sha256));
            if (missing.length > 0) {
              throw httpError(
                409,
                "sources_missing",
                `${missing.length} source(s) were never uploaded; run the plan again.`
              );
            }

            const manifest = normalizeManifest(
              await remote.readJson(remote.stateAbsolute(MANIFEST_FILE)),
              target.name
            );
            const assets = availableAssets(index, manifest, uploads.written(target.name));
            if (assets.missing.length > 0) {
              throw httpError(
                409,
                "assets_missing",
                `${assets.missing.length} asset(s) were never uploaded; run the plan again: ` +
                  assets.missing.join(", ")
              );
            }

            await remote.writeAbsolute(
              remote.stateAbsolute(INDEX_FILE),
              Buffer.from(JSON.stringify(index, null, 2), "utf8")
            );

            return publishSite({
              remote,
              target,
              index,
              manifest,
              assets: assets.uploaded,
              generator,
              log,
              cache,
              stored,
              uploads
            });
          })
        );
      },
      commitTimeoutMs
    ),

    route(
      "POST",
      "/publish/render",
      64_000,
      "json",
      async ({ body, log }) => {
        const target = targetOf(publish, body?.target);

        return exclusive(busy, target.name, () =>
          withRemote(pool, target, commitTimeoutMs, async (remote) => {
            const stored = await remote.readJson(remote.stateAbsolute(INDEX_FILE));
            if (!stored) {
              throw httpError(409, "nothing_published", "This target has never been published.");
            }
            const index = validateIndex(stored, publish);
            const manifest = normalizeManifest(
              await remote.readJson(remote.stateAbsolute(MANIFEST_FILE)),
              target.name
            );
            // Rebuilt from what the last commit recorded: an asset it did not
            // record was never on the host, and a page may not point at it.
            const assets = availableAssets(index, manifest, uploads.written(target.name));
            if (assets.missing.length > 0) {
              throw httpError(
                409,
                "assets_missing",
                `${assets.missing.length} asset(s) were never uploaded; publish again: ` +
                  assets.missing.join(", ")
              );
            }
            return publishSite({
              remote,
              target,
              index,
              manifest,
              assets: assets.uploaded,
              generator,
              log,
              cache,
              uploads
            });
          })
        );
      },
      commitTimeoutMs
    )
  ];
}

/** Render, write what differs, delete what went, then record it. */
async function publishSite({
  remote,
  target,
  index,
  manifest,
  assets,
  generator,
  log,
  cache,
  stored,
  uploads
}) {
  const started = Date.now();

  const sources = new Map();
  const missing = [];
  for (const hash of new Set(index.notes.map((note) => note.sha256))) {
    const text = cache.get(hash);
    if (text === undefined) missing.push(hash);
    else sources.set(hash, text);
  }
  await mapLimit(missing, SFTP_CONCURRENCY, async (hash) => {
    const content = await remote.readFile(remote.stateAbsolute(`${SOURCE_DIRECTORY}/${hash}.md`));
    cache.set(hash, content);
    sources.set(hash, content.toString("utf8"));
  });

  // A page points at a thumbnail only once it is on the host: already in the
  // manifest, or written by an upload since.
  const onHost = availableThumbnails(index, manifest, uploads.written(target.name));

  const files = await buildSite(
    { ...index, siteTitle: index.siteTitle || target.siteTitle },
    sources,
    {
      allowHtml: target.allowHtml,
      allowDiagrams: target.allowDiagrams,
      thumbnails: new Set(onHost.keys())
    }
  );
  for (const path of files.keys()) safePath(path, target, { output: true });

  // Assets were written to the host by their own upload, so they are not
  // rebuilt here — but they belong in the manifest, because a file the
  // manifest does not know about is a file the bridge may never remove.
  const uploaded = new Map();
  for (const [path, entry] of assets) uploaded.set(safePath(path, target), entry);
  for (const [path, entry] of onHost) uploaded.set(safePath(path, target), entry);

  const difference = diffOutputs(files, manifest, sha256, uploaded);

  await mapLimit(difference.write, SFTP_CONCURRENCY, (path) =>
    remote.writeFile(path, files.get(path))
  );

  // A deletion that failed stays in the manifest, so the next publish tries
  // again; forgotten, the file would have stayed on the host for good.
  const deleted = [];
  const deleteFailed = [];
  await mapLimit(difference.delete, SFTP_CONCURRENCY, async (path) => {
    try {
      await remote.remove(path);
      deleted.push(path);
    } catch (err) {
      deleteFailed.push(path);
      log("warn", `publish ${target.name}: could not delete ${path}: ${detailOf(err)}`);
    }
  });
  const pruned = await remote.pruneEmptyDirectories(deleted);

  // A commit already listed the stored sources to check the index; a render
  // has not, and asks here.
  const collected = orphanSources(stored ?? (await storedSourceHashes(remote)), index);
  await mapLimit(collected, SFTP_CONCURRENCY, (hash) =>
    remote.removeAbsolute(remote.stateAbsolute(`${SOURCE_DIRECTORY}/${hash}.md`)).catch((err) => {
      log("warn", `publish ${target.name}: could not collect source ${hash}: ${detailOf(err)}`);
    })
  );

  const carried = new Map(deleteFailed.map((path) => [path, manifest.files[path]]));
  await remote.writeAbsolute(
    remote.stateAbsolute(MANIFEST_FILE),
    Buffer.from(
      JSON.stringify(
        buildManifest({
          target: target.name,
          files,
          uploaded,
          carried,
          hash: sha256,
          renderVersion: RENDER_VERSION,
          generator
        }),
        null,
        2
      ),
      "utf8"
    )
  );

  // The manifest now records every upload the site uses; what it does not
  // use is asked for again by the next plan, should a later index need it.
  uploads.clear(target.name);

  const summary = {
    at: new Date().toISOString(),
    target: target.name,
    baseUrl: target.baseUrl,
    written: difference.write.length,
    unchanged: difference.unchanged.length,
    deleted: deleted.length,
    deleteFailed: deleteFailed.length,
    pruned,
    collected: collected.length,
    durationMs: Date.now() - started
  };
  await appendHistory(remote, summary);

  log(
    "info",
    `publish ${summary.target}: ${summary.written} written, ${summary.unchanged} unchanged, ` +
      `${summary.deleted} deleted, ${summary.deleteFailed} not deleted, ` +
      `${summary.pruned} pruned in ${summary.durationMs}ms`
  );
  return summary;
}

/**
 * The thumbnails a build may point at, with what the manifest records for
 * each: those the index asks for that the host already has, or that an
 * upload wrote since the last commit.
 */
export function availableThumbnails(index, manifest, written = new Map()) {
  const available = new Map();
  for (const asset of index.assets) {
    if (asset.thumbnail !== true) continue;
    const path = thumbnailPath(asset.sha256, asset.name ?? asset.sourcePath);
    if (!path) continue;
    const entry = written.get(path) ?? manifest.files?.[path];
    if (entry) available.set(path, entry);
  }
  return available;
}

/**
 * The index's assets that are on the host — recorded by the last commit, or
 * uploaded since — and the source paths of those that are not. The commit
 * used to record every asset the index named as published; one the plugin
 * never managed to upload was then in the manifest, linked from its page,
 * and never asked for again.
 */
export function availableAssets(index, manifest, written = new Map()) {
  const uploaded = new Map();
  const missing = [];
  for (const asset of index.assets) {
    const path = assetPath(asset.sha256, asset.name ?? asset.sourcePath);
    const entry = written.get(path) ?? manifest.files?.[path];
    if (entry) uploaded.set(path, entry);
    else missing.push(asset.sourcePath);
  }
  return { uploaded, missing };
}

/** More uploads than a publish of the largest allowed site could make. */
export const MAX_LEDGER_ENTRIES = 10_000;

/** Uploads written since the last commit, per target. */
export class UploadLedger {
  #targets = new Map();

  constructor({ maxEntries = MAX_LEDGER_ENTRIES } = {}) {
    this.maxEntries = maxEntries;
  }

  record(target, path, entry) {
    if (!this.#targets.has(target)) this.#targets.set(target, new Map());
    const written = this.#targets.get(target);
    written.delete(path);
    written.set(path, entry);
    // Uploads that never see a commit — a plugin that gave up halfway, again
    // and again — would otherwise accumulate for the life of the process.
    for (const [oldest] of written) {
      if (written.size <= this.maxEntries) break;
      written.delete(oldest);
    }
  }

  written(target) {
    return this.#targets.get(target) ?? new Map();
  }

  /** Once the manifest records them, the ledger need not. */
  clear(target) {
    this.#targets.delete(target);
  }
}

/** Failing to write the history never fails a publish that succeeded. */
async function appendHistory(remote, summary) {
  try {
    const path = remote.stateAbsolute(HISTORY_FILE);
    const existing = await remote.readJson(path);
    const entries = Array.isArray(existing) ? existing : [];
    const next = [summary, ...entries].slice(0, HISTORY_LENGTH);
    await remote.writeAbsolute(path, Buffer.from(JSON.stringify(next, null, 2), "utf8"));
  } catch {
    // See above.
  }
}

/** Put the deny file into the state directory, unless one is there. */
async function guardState(remote) {
  const path = remote.stateAbsolute(STATE_GUARD_FILE);
  if (await remote.exists(path)) return;
  await remote.writeAbsolute(path, Buffer.from(STATE_GUARD, "utf8"));
}

async function storedSourceHashes(remote) {
  const names = await remote.listNames(remote.stateAbsolute(SOURCE_DIRECTORY));
  return names
    .filter((name) => /^[0-9a-f]{64}\.md$/.test(name))
    .map((name) => name.replace(/\.md$/, ""));
}

export function targetOf(publish, name) {
  const key = String(name ?? "").trim();
  // Own keys only: "constructor" is on every object and is not a target.
  const target = Object.hasOwn(publish.targets, key) ? publish.targets[key] : undefined;
  if (!target) {
    throw httpError(404, "unknown_target", `No such publish target: ${name ?? "(none)"}.`);
  }
  return target;
}

function validateIndex(index, publish) {
  try {
    const checked = checkIndex(index);
    const files = checked.notes.length + checked.assets.length;
    if (files > publish.maxFiles) {
      throw httpError(
        413,
        "too_many_files",
        `${files} files exceeds the ${publish.maxFiles} limit.`
      );
    }
    return checked;
  } catch (err) {
    if (err instanceof IndexError) throw httpError(400, "invalid_index", err.message);
    throw err;
  }
}

function safePath(path, target, { output = false } = {}) {
  try {
    return checkRelativePath(path, output ? undefined : { extensions: target.assetExtensions });
  } catch (err) {
    if (err instanceof PathError) throw httpError(400, "unsafe_path", err.message);
    throw err;
  }
}

/** An upload that does not hash to what it claims is a truncated upload. */
function verifyHash(body, claimed) {
  if (!/^[0-9a-f]{64}$/.test(String(claimed ?? ""))) {
    throw httpError(400, "invalid_request", "A sha256 query parameter is required.");
  }
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== claimed) {
    throw httpError(400, "hash_mismatch", "The uploaded bytes do not match the declared hash.");
  }
  return actual;
}

/**
 * Whether uploaded bytes are what their extension says. An SVG is served
 * from the site's own domain, where it would run whatever it carries, so it
 * is held to the tab icon's rule; a raster file has to begin like one where
 * there is a signature to check.
 */
export function isAssetContent(bytes, extension) {
  if (extension === "svg") return isSafeSvg(bytes.toString("utf8"), { embedded: true });
  const raster = RASTER_SIGNATURES.get(extension);
  return raster ? isThumbnailFormat(bytes, raster) : true;
}

async function open(target, config) {
  return withDeadline(
    connect({ ...target, timeoutMs: config.upstreamTimeoutMs }),
    config.upstreamTimeoutMs,
    "Connect"
  );
}

/**
 * Run `work` on the target's shared connection, under the request's deadline.
 *
 * The deadline is inside the pool's `use`, so running out of it retires the
 * connection: closing it is what fails the operation the server never
 * answered, and the request cannot hold the target's lock beyond its budget.
 */
export async function withRemote(pool, target, timeoutMs, work) {
  let started = false;
  try {
    return await pool.use(target.name, (remote) => {
      started = true;
      return withDeadline(work(remote), timeoutMs, `Publish to ${target.name}`);
    });
  } catch (err) {
    if (err.status || err instanceof TimeoutError) throw err;
    // Before the work began, the login itself failed.
    if (!started) throw httpError(502, "sftp_unreachable", clientMessage(err), detailOf(err));
    throw httpError(502, "sftp_error", clientMessage(err), detailOf(err));
  }
}

/**
 * One publish at a time per target.
 *
 * No deadline of its own: a deadline here cannot stop the work, only stop
 * waiting for it, and a lock released while the writes go on lets a second
 * publish share the connection with the first. The work is bounded inside
 * `withRemote`, where running out closes the connection and so ends it.
 */
export async function exclusive(busy, name, work) {
  if (busy.has(name)) {
    throw httpError(409, "publish_in_progress", `A publish to ${name} is already running.`);
  }
  busy.add(name);
  try {
    return await work();
  } finally {
    busy.delete(name);
  }
}

/** What the client is told when something upstream fails. */
export function clientMessage(err) {
  if (err instanceof SftpError) return err.clientMessage;
  if (err instanceof TimeoutError) return err.message;
  return "SFTP failed.";
}

/** How much a named asset may weigh: a video's allowance or an image's. */
function assetLimit(publish, name) {
  return VIDEO_EXTENSIONS.has(extensionOf(name)) ? publish.maxVideoBytes : publish.maxImageBytes;
}

/** What the operator's log gets, which is everything the client does not. */
function detailOf(err) {
  return err?.stack ?? err?.message ?? String(err);
}
