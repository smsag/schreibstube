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
  plannedOutputs,
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
import { isSafeSvg } from "./svg-guard.mjs";
import { hasSignature } from "./signatures.mjs";
import { HTACCESS_FILES, htaccessFiles } from "./site-headers.mjs";
import {
  matches,
  normalizePending,
  orphanUploads,
  serializePending,
  UploadQuota
} from "./pending.mjs";
import { opensTarget, presentedToken } from "./target-access.mjs";
import { AbandonedError, connect, SftpError } from "./sftp.mjs";
import { createConnectionPool } from "./connection-pool.mjs";
import { mapLimit, SFTP_CONCURRENCY } from "./pool.mjs";
import { SourceCache } from "./source-cache.mjs";

const MANIFEST_FILE = "manifest.json";
const HISTORY_FILE = "history.json";
const PENDING_FILE = "pending.json";
/** How many publishes the history keeps. Enough to answer "when did that page
 *  change", small enough that the file stays a file. */
const HISTORY_LENGTH = 50;
const INDEX_FILE = "index.json";
const SOURCE_DIRECTORY = "src";
const STATE_GUARD_FILE = ".htaccess";

/**
 * The most note text a commit holds at once. Every source is in memory while
 * the site renders; a site of two thousand long notes is a few dozen
 * megabytes, and a commit asked to hold more is refused rather than allowed
 * to take the process down.
 */
export const MAX_COMMIT_SOURCE_BYTES = 200_000_000;

/**
 * How long a connection test's answer stands. Each one is a login, and a
 * host that counts failed logins bans the address that makes them; a token
 * holder clicking "test" in a loop must not be the one who gets it banned.
 */
export const DIAGNOSTICS_INTERVAL_MS = 30_000;

/** How many paths a refusal names before it counts the rest. */
const NAMED_PATHS = 20;

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

export function createPublishRoutes(config, { version, now = () => Date.now() }) {
  const publish = config.publish;
  const generator = `schreibstube-bridge/${version}`;
  const busy = new Set();
  // Uploads running per target. A commit waits for none of them: it refuses,
  // as an upload refuses while a commit runs, so a file is never written
  // between the moment a commit decides what the site is and its manifest.
  const uploading = new Map();
  const pool = createConnectionPool({
    connect: (name) => open(publish.targets[name], config)
  });
  const cache = new SourceCache();
  // Assets and thumbnails written since the last commit, per target: the
  // commit has to know a file is on the host before a page may point at it or
  // the manifest may claim it, and one it does not know of — the bridge
  // restarted in between — is asked for again by the next plan.
  const uploads = new UploadLedger();
  const quota = new UploadQuota({
    maxBytes: publish.maxPublishBytes ?? Number.MAX_SAFE_INTEGER,
    maxUploads: publish.maxUploads ?? Number.MAX_SAFE_INTEGER
  });
  const pending = new PendingRecord();
  const diagnosed = new Map();
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

  /** An upload: never during a commit, and counted against the target's quota. */
  const asUpload = async (target, bytes, work) => {
    if (busy.has(target.name)) {
      throw httpError(409, "publish_in_progress", `A publish to ${target.name} is running.`);
    }
    quota.admit(target.name, bytes);
    uploading.set(target.name, (uploading.get(target.name) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const left = uploading.get(target.name) - 1;
      if (left > 0) uploading.set(target.name, left);
      else uploading.delete(target.name);
    }
  };

  /**
   * Whether an upload may land on `path`. A file the bridge never wrote is
   * not overwritten: neither the manifest nor the record of pending uploads
   * names it, so it is someone else's, and once overwritten the manifest
   * would claim it and a later publish delete it. One holding exactly the
   * bytes about to be written is the same file whoever wrote it.
   */
  const claim = async (remote, target, path, entry) => {
    const owned = (await pending.of(remote, target)).has(path);
    if (!owned && !uploads.written(target.name).has(path) && !target.adoptExisting) {
      const absolute = remote.absolute(path);
      const kind = await remote.exists(absolute);
      if (kind && !(kind === "-" && (await sameContent(remote, absolute, entry)))) {
        const manifest = await readManifest(remote, target);
        if (!manifest.files[path]) throw conflictError(target, [path]);
      }
    }
    // Recorded before the bytes go, so a crash between the two leaves a
    // record of a file that may be there, never a file nothing records.
    await pending.add(remote, target, path, entry);
  };

  return [
    route("GET", "/publish/targets", 0, "none", async ({ authorization }) => {
      const presented = presentedToken(authorization);
      return {
        targets: Object.values(publish.targets)
          .filter((target) => opensTarget(publish, target, presented))
          .map((target) => ({
            name: target.name,
            baseUrl: target.baseUrl,
            siteTitle: target.siteTitle
          }))
      };
    }),

    route("POST", "/publish/diagnostics", 64_000, "json", async ({ body, log, authorization }) => {
      const target = targetFor(publish, body?.target, authorization);
      const recent = diagnosed.get(target.name);
      if (recent && now() - recent.at < DIAGNOSTICS_INTERVAL_MS) return recent.result;

      let result;
      try {
        // Through the pool: a publish's own connection proves the same login,
        // and a test while one is open costs the host nothing.
        result = await withRemote(pool, target, config.requestTimeoutMs, async (remote) => {
          // Listing a directory that is not there answers "empty", which is
          // not the answer: a site cannot be written to a root that is missing.
          if ((await remote.exists(target.root)) !== "d") {
            return { ok: false, target: target.name, error: "The web root does not exist." };
          }
          const entries = await remote.listNames(target.root);
          // Whether the root is there, never where: the vault has no business
          // learning the host's directory layout.
          return { ok: true, target: target.name, rootExists: true, entries: entries.length };
        });
      } catch (err) {
        log("warn", `diagnostics ${target.name}: ${err.detail ?? detailOf(err)}`);
        result = { ok: false, target: target.name, error: err.message || "SFTP failed." };
      }
      diagnosed.set(target.name, { at: now(), result });
      return result;
    }),

    route(
      "POST",
      "/publish/plan",
      publish.maxIndexBytes,
      "json",
      async ({ body, log, authorization }) => {
        const target = targetFor(publish, body?.target, authorization);
        const index = validateIndex(body?.index, publish);

        return withRemote(pool, target, config.requestTimeoutMs, async (remote) => {
          const manifest = await readManifest(remote, target);
          const stored = await storedSourceHashes(remote);
          const plan = planUploads({ index, manifest, storedSourceHashes: stored });
          const conflicts = target.adoptExisting
            ? []
            : await planConflicts(remote, index, plan, manifest, await ownedPaths(remote, target));

          log(
            "info",
            `plan ${target.name}: ${plan.uploadSources.length} source(s), ` +
              `${plan.uploadAssets.length} asset(s), ${plan.willDelete.length} to delete, ` +
              `${conflicts.length} in the way`
          );
          return { target: target.name, baseUrl: target.baseUrl, ...plan, conflicts };
        });
      }
    ),

    route(
      "PUT",
      "/publish/source",
      publish.maxSourceBytes,
      "raw",
      async ({ body, query, log, authorization }) => {
        const target = targetFor(publish, query.get("target"), authorization);
        const hash = verifyHash(body, query.get("sha256"));

        return asUpload(target, body.length, () =>
          withRemote(pool, target, uploadTimeoutMs, async (remote) => {
            await guard(remote, target);
            await remote.writeAbsolute(
              remote.stateAbsolute(`${SOURCE_DIRECTORY}/${hash}.md`),
              body
            );
            // The commit that follows renders this note; it need not read it back.
            cache.set(hash, body);
            log(
              "info",
              `source ${hash.slice(0, 12)} stored for ${target.name} (${body.length} bytes)`
            );
            return { sha256: hash, bytes: body.length };
          })
        );
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
      async ({ body, query, log, authorization }) => {
        const target = targetFor(publish, query.get("target"), authorization);
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
        const entry = { sha256: hash, bytes: body.length };

        return asUpload(target, body.length, () =>
          withRemote(pool, target, uploadTimeoutMs, async (remote) => {
            await claim(remote, target, path, entry);
            await remote.writeFile(path, body);
            uploads.record(target.name, path, entry);
            log("info", `asset ${path} stored for ${target.name} (${body.length} bytes)`);
            return { sha256: hash, bytes: body.length, path };
          })
        );
      },
      uploadTimeoutMs
    ),

    route(
      "PUT",
      "/publish/thumbnail",
      MAX_THUMBNAIL_BYTES,
      "raw",
      async ({ body, query, log, authorization }) => {
        const target = targetFor(publish, query.get("target"), authorization);
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
        const entry = { sha256: hash, bytes: body.length };

        return asUpload(target, body.length, () =>
          withRemote(pool, target, uploadTimeoutMs, async (remote) => {
            await claim(remote, target, path, entry);
            await remote.writeFile(path, body);
            uploads.record(target.name, path, entry);
            log("info", `thumbnail ${path} stored for ${target.name} (${body.length} bytes)`);
            return { sha256: hash, bytes: body.length, path };
          })
        );
      },
      uploadTimeoutMs
    ),

    route(
      "POST",
      "/publish/commit",
      publish.maxIndexBytes,
      "json",
      async ({ body, log, authorization }) => {
        const target = targetFor(publish, body?.target, authorization);
        const index = validateIndex(body?.index, publish);
        if (uploading.has(target.name)) {
          throw httpError(
            409,
            "publish_in_progress",
            `Uploads to ${target.name} are still running; commit once they are done.`
          );
        }

        return exclusive(busy, target.name, () =>
          withRemote(pool, target, commitTimeoutMs, async (remote, signal) => {
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

            const manifest = await readManifest(remote, target);
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

            const summary = await publishSite({
              remote,
              signal,
              target,
              index,
              manifest,
              assets: assets.uploaded,
              generator,
              log,
              cache,
              stored,
              uploads,
              pending
            });
            quota.reset(target.name);
            return summary;
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
      async ({ body, log, authorization }) => {
        const target = targetFor(publish, body?.target, authorization);
        if (uploading.has(target.name)) {
          throw httpError(409, "publish_in_progress", `Uploads to ${target.name} are running.`);
        }

        return exclusive(busy, target.name, () =>
          withRemote(pool, target, commitTimeoutMs, async (remote, signal) => {
            const stored = await remote.readJson(remote.stateAbsolute(INDEX_FILE));
            if (!stored) {
              throw httpError(409, "nothing_published", "This target has never been published.");
            }
            const index = validateIndex(stored, publish);
            const manifest = await readManifest(remote, target);
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
              signal,
              target,
              index,
              manifest,
              assets: assets.uploaded,
              generator,
              log,
              cache,
              uploads,
              pending
            });
          })
        );
      },
      commitTimeoutMs
    )
  ];

  /** Paths this process, or the record of pending uploads, says are the bridge's own. */
  async function ownedPaths(remote, target) {
    const recorded = await pending.of(remote, target);
    return new Set([...uploads.written(target.name).keys(), ...recorded.keys()]);
  }
}

/** Render, write what differs, delete what went, then record it. */
async function publishSite({
  remote,
  signal,
  target,
  index,
  manifest,
  assets,
  generator,
  log,
  cache,
  stored,
  uploads,
  pending
}) {
  const started = Date.now();
  const sources = await readSources(remote, index, cache);
  signal?.throwIfAborted();

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

  // The header files are the bridge's only where it wrote them: a .htaccess
  // the operator keeps — rewrites, a password — is left exactly as it is.
  for (const [path, content] of htaccessFiles(target)) {
    if (!manifest.files[path] && (await remote.exists(remote.absolute(path)))) {
      log("warn", `publish ${target.name}: ${path} is not the bridge's; its headers are not set`);
      continue;
    }
    files.set(path, content);
  }

  // Assets were written to the host by their own upload, so they are not
  // rebuilt here — but they belong in the manifest, because a file the
  // manifest does not know about is a file the bridge may never remove.
  const uploaded = new Map();
  for (const [path, entry] of assets) uploaded.set(safePath(path, target), entry);
  for (const [path, entry] of onHost) uploaded.set(safePath(path, target), entry);

  const difference = diffOutputs(files, manifest, sha256, uploaded);

  // A page the manifest does not know and the host already has is someone
  // else's file — a placeholder index, another tool's page — and is refused
  // before anything is written, unless the target may take such files over.
  if (!target.adoptExisting) {
    const recorded = await pending.of(remote, target);
    const owned = new Set([...uploads.written(target.name).keys(), ...recorded.keys()]);
    const fresh = difference.write.filter(
      (path) => !manifest.files[path] && !owned.has(path) && !HTACCESS_FILES.has(path)
    );
    const taken = await present(remote, fresh);
    if (taken.length > 0) throw conflictError(target, taken);
  }
  signal?.throwIfAborted();

  await mapLimit(difference.write, SFTP_CONCURRENCY, (path) =>
    remote.writeFile(path, files.get(path))
  );
  signal?.throwIfAborted();

  // A deletion that failed stays in the manifest, so the next publish tries
  // again; forgotten, the file would have stayed on the host for good.
  const deleted = [];
  const deleteFailed = [];
  await mapLimit(difference.delete, SFTP_CONCURRENCY, async (path) => {
    try {
      await remote.remove(path);
      deleted.push(path);
    } catch (err) {
      if (err instanceof AbandonedError) throw err;
      deleteFailed.push(path);
      log("warn", `publish ${target.name}: could not delete ${path}: ${detailOf(err)}`);
    }
  });
  const pruned = await remote.pruneEmptyDirectories(deleted);
  signal?.throwIfAborted();

  // A commit already listed the stored sources to check the index; a render
  // has not, and asks here.
  const collected = orphanSources(stored ?? (await storedSourceHashes(remote)), index);
  await mapLimit(collected, SFTP_CONCURRENCY, (hash) =>
    remote.removeAbsolute(remote.stateAbsolute(`${SOURCE_DIRECTORY}/${hash}.md`)).catch((err) => {
      if (err instanceof AbandonedError) throw err;
      log("warn", `publish ${target.name}: could not collect source ${hash}: ${detailOf(err)}`);
    })
  );
  signal?.throwIfAborted();

  const carried = new Map(deleteFailed.map((path) => [path, manifest.files[path]]));
  const recorded = buildManifest({
    target: target.name,
    files,
    uploaded,
    carried,
    hash: sha256,
    renderVersion: RENDER_VERSION,
    generator
  });
  await remote.writeAbsolute(
    remote.stateAbsolute(MANIFEST_FILE),
    Buffer.from(JSON.stringify(recorded, null, 2), "utf8")
  );

  // The manifest now records every upload the site uses; what it does not
  // use is asked for again by the next plan, should a later index need it.
  uploads.clear(target.name);
  const abandoned = await pending.settle(remote, target, recorded.files, log);

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
    abandoned,
    durationMs: Date.now() - started
  };
  await appendHistory(remote, summary);

  log(
    "info",
    `publish ${summary.target}: ${summary.written} written, ${summary.unchanged} unchanged, ` +
      `${summary.deleted} deleted, ${summary.deleteFailed} not deleted, ` +
      `${summary.abandoned} abandoned upload(s) removed, ${summary.pruned} pruned ` +
      `in ${summary.durationMs}ms`
  );
  return summary;
}

/**
 * Every note's text, from memory where the bridge has it and from the host
 * where it has not. What is read back is hashed again: the file is named
 * after its content, and a file whose content no longer matches its name —
 * truncated, edited on the host — would otherwise be published as the note.
 * It is removed instead, so the next plan asks for it. All of it is held at
 * once while the site renders, so the total is bounded.
 */
async function readSources(remote, index, cache) {
  const sources = new Map();
  const missing = [];
  let held = 0;
  const hold = (bytes) => {
    held += bytes;
    if (held > MAX_COMMIT_SOURCE_BYTES) {
      throw httpError(
        413,
        "site_too_large",
        `The notes of this site exceed ${MAX_COMMIT_SOURCE_BYTES} bytes together.`
      );
    }
  };

  for (const hash of new Set(index.notes.map((note) => note.sha256))) {
    const text = cache.get(hash);
    if (text === undefined) {
      missing.push(hash);
    } else {
      hold(Buffer.byteLength(text));
      sources.set(hash, text);
    }
  }

  const corrupt = [];
  await mapLimit(missing, SFTP_CONCURRENCY, async (hash) => {
    const path = remote.stateAbsolute(`${SOURCE_DIRECTORY}/${hash}.md`);
    const content = await remote.readFile(path);
    if (sha256(content) !== hash) {
      corrupt.push(hash);
      await remote.removeAbsolute(path).catch((err) => {
        if (err instanceof AbandonedError) throw err;
      });
      return;
    }
    hold(content.length);
    cache.set(hash, content);
    sources.set(hash, content.toString("utf8"));
  });
  if (corrupt.length > 0) {
    throw httpError(
      409,
      "sources_missing",
      `${corrupt.length} stored source(s) no longer matched their hash and were removed; ` +
        "run the plan again."
    );
  }
  return sources;
}

/**
 * The paths the plan's commit would write over a file the bridge never
 * wrote: on the host, but in neither the manifest nor the record of pending
 * uploads. An asset already there with the very bytes the index promises is
 * the same file, and not in the way.
 */
async function planConflicts(remote, index, plan, manifest, known) {
  const promised = new Map(
    plan.uploadAssets.map((entry) => [
      entry.path,
      index.assets.find((asset) => asset.sha256 === entry.sha256)
    ])
  );
  const candidates = plannedOutputs(index, plan).filter(
    (path) => !manifest.files[path] && !known.has(path)
  );
  const conflicts = [];
  await mapLimit(candidates, SFTP_CONCURRENCY, async (path) => {
    const absolute = remote.absolute(path);
    const kind = await remote.exists(absolute);
    if (!kind) return;
    const asset = promised.get(path);
    if (kind === "-" && asset?.bytes !== undefined) {
      if (await sameContent(remote, absolute, { sha256: asset.sha256, bytes: asset.bytes })) {
        return;
      }
    }
    conflicts.push(path);
  });
  return conflicts.sort();
}

/** Which of `paths` the host has, file or directory. */
async function present(remote, paths) {
  const found = [];
  await mapLimit(paths, SFTP_CONCURRENCY, async (path) => {
    if (await remote.exists(remote.absolute(path))) found.push(path);
  });
  return found.sort();
}

/** Whether the file at `absolute` holds exactly the bytes `entry` promises. */
async function sameContent(remote, absolute, entry) {
  if ((await remote.sizeOf(absolute)) !== entry.bytes) return false;
  return matches(await remote.readFile(absolute), entry);
}

function conflictError(target, paths) {
  const named = paths.slice(0, NAMED_PATHS).join(", ");
  const more = paths.length > NAMED_PATHS ? ` and ${paths.length - NAMED_PATHS} more` : "";
  return httpError(
    409,
    "path_conflict",
    `${paths.length} file(s) on ${target.name} were not written by the bridge and would be ` +
      `overwritten: ${named}${more}. Remove them, or set ` +
      `PUBLISH_${target.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_ADOPT_EXISTING=true.`
  );
}

/**
 * The record of uploads not yet committed, per target, kept in the state
 * directory and read once per process. Written whole on each change, one
 * write at a time per target; an upload whose record could not be written is
 * not written either.
 */
class PendingRecord {
  #targets = new Map();

  async of(remote, target) {
    let slot = this.#targets.get(target.name);
    if (!slot) {
      const loading = remote
        .readJson(remote.stateAbsolute(PENDING_FILE))
        .then((raw) => normalizePending(raw));
      slot = { loading, chain: Promise.resolve() };
      this.#targets.set(target.name, slot);
      // A read that failed is tried again by the next request.
      loading.catch(() => {
        if (this.#targets.get(target.name) === slot) this.#targets.delete(target.name);
      });
    }
    return slot.loading;
  }

  async add(remote, target, path, entry) {
    const entries = await this.of(remote, target);
    const known = entries.get(path);
    if (known?.sha256 === entry.sha256) return;
    entries.set(path, entry);
    await this.#save(remote, target, entries);
  }

  /**
   * After a commit: remove the pending uploads the new manifest does not
   * keep, and record only those that could not be removed. Returns how many
   * went.
   */
  async settle(remote, target, manifestFiles, log) {
    const entries = await this.of(remote, target);
    const orphans = orphanUploads(entries, manifestFiles);
    let removed = 0;
    await mapLimit(orphans, SFTP_CONCURRENCY, async (path) => {
      try {
        if (await remote.exists(remote.absolute(path))) await remote.remove(path);
        entries.delete(path);
        removed += 1;
      } catch (err) {
        if (err instanceof AbandonedError) throw err;
        log("warn", `publish ${target.name}: could not remove ${path}: ${detailOf(err)}`);
      }
    });
    for (const path of [...entries.keys()]) {
      if (Object.hasOwn(manifestFiles, path)) entries.delete(path);
    }
    await this.#save(remote, target, entries);
    return removed;
  }

  #save(remote, target, entries) {
    const slot = this.#targets.get(target.name);
    const text = serializePending(target.name, entries);
    const write = slot.chain.then(() =>
      remote.writeAbsolute(remote.stateAbsolute(PENDING_FILE), Buffer.from(text, "utf8"))
    );
    slot.chain = write.catch(() => {});
    return write;
  }
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

async function readManifest(remote, target) {
  return normalizeManifest(await remote.readJson(remote.stateAbsolute(MANIFEST_FILE)), target.name);
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

/**
 * The target, if the token presented opens it. One that does not is answered
 * as a target that does not exist: a token for one site learns nothing about
 * the others.
 */
export function targetFor(publish, name, authorization) {
  const target = targetOf(publish, name);
  if (!opensTarget(publish, target, presentedToken(authorization))) {
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
 * is held to the tab icon's rule; a picture or a video has to begin like one.
 */
export function isAssetContent(bytes, extension) {
  if (extension === "svg") return isSafeSvg(bytes.toString("utf8"), { embedded: true });
  return hasSignature(bytes, extension);
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
 * connection. Running out also aborts the signal `work` is given and closes
 * the socket at once: the view of the connection `work` holds refuses every
 * operation from then on, so a commit that was given up on cannot write a
 * file after the lock it held is released and a second commit has begun.
 */
export async function withRemote(pool, target, timeoutMs, work) {
  let started = false;
  const controller = new AbortController();
  try {
    return await pool.use(target.name, async (remote) => {
      started = true;
      const scoped = remote.withSignal ? remote.withSignal(controller.signal) : remote;
      try {
        return await withDeadline(
          work(scoped, controller.signal),
          timeoutMs,
          `Publish to ${target.name}`
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          controller.abort(err);
          remote.destroy?.();
        }
        throw err;
      }
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
 * waiting for it. The work is bounded inside `withRemote`, where running out
 * aborts it and closes its connection, so the lock is released only once the
 * work can no longer write.
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
