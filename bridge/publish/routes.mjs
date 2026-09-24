/**
 * The publish capability: its routes and the order they happen in.
 *
 *   plan     hash comparison against the manifest; nothing is written
 *   source   upload one note, addressed by the hash of its content
 *   asset    upload one image or video, sent as raw bytes
 *   commit   render every note, write what changed, delete what went, save state
 *   render   rebuild from stored state alone, for a template change
 *
 * Uploads are incremental and rendering is total: a title that changed in one
 * note changes the index page and every link pointing at it, and only a full
 * render gets that right. What is written is still only what differs.
 */
import { createHash } from "node:crypto";
import { httpError } from "../http.mjs";
import { withDeadline } from "../timeout.mjs";
import {
  buildManifest,
  diffOutputs,
  normalizeManifest,
  orphanSources,
  planUploads
} from "./manifest.mjs";
import { assetPath, checkRelativePath, extensionOf, PathError, VIDEO_EXTENSIONS } from "./path.mjs";
import { RENDER_VERSION } from "./render/markdown.mjs";
import { buildSite, checkIndex, IndexError, sha256 } from "./site.mjs";
import { connect, SftpError } from "./sftp.mjs";

const MANIFEST_FILE = "manifest.json";
const HISTORY_FILE = "history.json";
/** How many publishes the history keeps. Enough to answer "when did that page
 *  change", small enough that the file stays a file. */
const HISTORY_LENGTH = 50;
const INDEX_FILE = "index.json";
const SOURCE_DIRECTORY = "src";
const STATE_GUARD_FILE = ".htaccess";

/**
 * Written into a state directory that lies inside the web root.
 *
 * The directory holds every published note's Markdown as written — the
 * frontmatter and the `%%` comments the page leaves out — and an index naming
 * each note's place in the vault. Served, all of that is one guessable URL
 * away. Apache and its lookalikes, which is most shared hosting, read this file
 * and refuse; other servers need the deny rule the README names, and the bridge
 * says so when it starts.
 */
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

export function createPublishRoutes(config, { version }) {
  const publish = config.publish;
  const generator = `schreibstube-bridge/${version}`;
  // One publish at a time per target. The bridge runs as a single instance, so
  // an in-memory lock is the whole story.
  const busy = new Set();
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

    route("POST", "/publish/diagnostics", 64_000, "json", async ({ body }) => {
      const target = targetOf(publish, body?.target);
      try {
        const remote = await open(target, config);
        try {
          const entries = await remote.listNames(target.root);
          return { ok: true, target: target.name, root: target.root, entries: entries.length };
        } finally {
          await remote.end();
        }
      } catch (err) {
        return { ok: false, target: target.name, error: message(err) };
      }
    }),

    route("POST", "/publish/plan", publish.maxIndexBytes, "json", async ({ body, log }) => {
      const target = targetOf(publish, body?.target);
      const index = validateIndex(body?.index, publish);

      return withRemote(target, config, async (remote) => {
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

        return withRemote(target, config, async (remote) => {
          await guard(remote, target);
          await remote.writeAbsolute(remote.stateAbsolute(`${SOURCE_DIRECTORY}/${hash}.md`), body);
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

        // The name from the vault never becomes a path: it is slugified and
        // prefixed with the content hash, then checked like any other path.
        const path = safePath(assetPath(hash, name), target);

        return withRemote(target, config, async (remote) => {
          await remote.writeFile(path, body);
          log("info", `asset ${path} stored for ${target.name} (${body.length} bytes)`);
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
          withRemote(target, config, async (remote) => {
            await guard(remote, target);
            const stored = await storedSourceHashes(remote);
            const missing = index.notes.filter((note) => !stored.includes(note.sha256));
            if (missing.length > 0) {
              throw httpError(
                409,
                "sources_missing",
                `${missing.length} source(s) were never uploaded; run the plan again.`
              );
            }

            await remote.writeAbsolute(
              remote.stateAbsolute(INDEX_FILE),
              Buffer.from(JSON.stringify(index, null, 2), "utf8")
            );

            return publishSite({ remote, target, index, generator, log });
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
          withRemote(target, config, async (remote) => {
            const stored = await remote.readJson(remote.stateAbsolute(INDEX_FILE));
            if (!stored) {
              throw httpError(409, "nothing_published", "This target has never been published.");
            }
            return publishSite({
              remote,
              target,
              index: validateIndex(stored, publish),
              generator,
              log
            });
          })
        );
      },
      commitTimeoutMs
    )
  ];
}

/**
 * Render, write what differs, delete what went, then record it.
 *
 * The order is the recovery story. Output first, so a crash leaves files that
 * the next run recognises as already correct; the manifest last, so a crash
 * before it means the next run re-does work rather than losing a file.
 */
async function publishSite({ remote, target, index, generator, log }) {
  const started = Date.now();

  const sources = new Map();
  for (const note of index.notes) {
    if (sources.has(note.sha256)) continue;
    const content = await remote.readFile(
      remote.stateAbsolute(`${SOURCE_DIRECTORY}/${note.sha256}.md`)
    );
    sources.set(note.sha256, content.toString("utf8"));
  }

  const files = await buildSite(
    { ...index, siteTitle: index.siteTitle || target.siteTitle },
    sources,
    { allowHtml: target.allowHtml, allowDiagrams: target.allowDiagrams }
  );
  for (const path of files.keys()) safePath(path, target, { output: true });

  // Assets were written to the host by their own upload, so they are not
  // rebuilt here — but they belong in the manifest, because a file the
  // manifest does not know about is a file the bridge may never remove.
  const uploaded = new Map(
    index.assets.map((asset) => [
      safePath(assetPath(asset.sha256, asset.name ?? asset.sourcePath), target),
      { sha256: asset.sha256, bytes: asset.bytes ?? 0 }
    ])
  );

  const manifest = normalizeManifest(
    await remote.readJson(remote.stateAbsolute(MANIFEST_FILE)),
    target.name
  );
  const difference = diffOutputs(files, manifest, sha256, uploaded);

  for (const path of difference.write) {
    await remote.writeFile(path, files.get(path));
  }
  for (const path of difference.delete) {
    await remote.remove(path).catch(() => {});
  }
  const pruned = await remote.pruneEmptyDirectories(difference.delete);

  const collected = orphanSources(await storedSourceHashes(remote), index);
  for (const hash of collected) {
    await remote
      .removeAbsolute(remote.stateAbsolute(`${SOURCE_DIRECTORY}/${hash}.md`))
      .catch(() => {});
  }

  await remote.writeAbsolute(
    remote.stateAbsolute(MANIFEST_FILE),
    Buffer.from(
      JSON.stringify(
        buildManifest({
          target: target.name,
          files,
          uploaded,
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

  const summary = {
    at: new Date().toISOString(),
    target: target.name,
    baseUrl: target.baseUrl,
    written: difference.write.length,
    unchanged: difference.unchanged.length,
    deleted: difference.delete.length,
    pruned,
    collected: collected.length,
    durationMs: Date.now() - started
  };
  await appendHistory(remote, summary);

  log(
    "info",
    `publish ${summary.target}: ${summary.written} written, ${summary.unchanged} unchanged, ` +
      `${summary.deleted} deleted, ${summary.pruned} pruned in ${summary.durationMs}ms`
  );
  return summary;
}

/**
 * Keep the last publishes next to the manifest.
 *
 * The manifest says what the site is now; nothing said what changed when. A
 * short history answers that without a log server, and a failure to write it
 * never fails a publish that already succeeded.
 */
async function appendHistory(remote, summary) {
  try {
    const path = remote.stateAbsolute(HISTORY_FILE);
    const existing = await remote.readJson(path);
    const entries = Array.isArray(existing) ? existing : [];
    const next = [summary, ...entries].slice(0, HISTORY_LENGTH);
    await remote.writeAbsolute(path, Buffer.from(JSON.stringify(next, null, 2), "utf8"));
  } catch {
    // The site is published either way; a missing history entry is not a
    // reason to report a failure.
  }
}

/**
 * Put the deny file into the state directory, unless one is there.
 *
 * An existing file is left alone: an operator who wrote their own rules for
 * the directory knows their server better than this does.
 */
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

function targetOf(publish, name) {
  const target = publish.targets[String(name ?? "").trim()];
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

async function open(target, config) {
  return withDeadline(
    connect({ ...target, timeoutMs: config.upstreamTimeoutMs }),
    config.upstreamTimeoutMs,
    "Connect"
  );
}

async function withRemote(target, config, work) {
  let remote;
  try {
    remote = await open(target, config);
  } catch (err) {
    throw httpError(502, "sftp_unreachable", message(err), detailOf(err));
  }

  try {
    return await work(remote);
  } catch (err) {
    if (err.status) throw err;
    throw httpError(502, "sftp_error", message(err), detailOf(err));
  } finally {
    await remote.end();
  }
}

async function exclusive(busy, name, work) {
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

/**
 * What the client is told when something upstream fails.
 *
 * A host key mismatch is quoted in full, because it is the one failure a person
 * has to see word for word. Everything else is summarised: an SFTP error can
 * carry remote paths, and those are the operator's business, not the client's.
 */
function message(err) {
  if (err instanceof SftpError) return err.message;
  // Summarised, as the paragraph above promises: an ssh2 error carries the
  // absolute path it was working on, and the vault has no business learning
  // where the web root lives. The detail is in the bridge's own log, with the
  // request id.
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
