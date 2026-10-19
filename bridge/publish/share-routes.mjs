/**
 * The shared-link routes and the sweep that closes links on time.
 *
 *   GET  /publish/shares         the target's open links
 *   POST /publish/share          write a link, or rewrite one by its code
 *   POST /publish/share/revoke   take a link down
 *
 * A share is written beside the site, never as part of it: its files are
 * under `s/<code>/`, recorded in `<state>/shares.json` rather than in the
 * site's manifest, so a publish neither sees nor deletes them, and a share
 * never waits for a publish. The decisions are in `share.mjs`.
 */
import { readFile } from "node:fs/promises";
import { httpError } from "../http.mjs";
import { generatorAssets } from "./assets.mjs";
import { createConnectionPool } from "./connection-pool.mjs";
import { checkRelativePath } from "./path.mjs";
import { mapLimit, SFTP_CONCURRENCY } from "./pool.mjs";
import { exclusive, openRemote, STATE_GUARD, targetFor, withRemote } from "./routes.mjs";
import {
  checkShareRequest,
  describeShare,
  encryptShare,
  expiredShares,
  isShareCode,
  MAX_SHARE_REQUEST_BYTES,
  MAX_SHARES,
  newShareCode,
  nextExpiry,
  normalizeShares,
  renderShare,
  serializeShares,
  SHARE_DIRECTORY,
  SHARE_INDEX_GUARD,
  shareDirectory,
  ShareError,
  shareHtaccess,
  sharePage,
  sharePlaintext
} from "./share.mjs";
import { AbandonedError } from "./sftp.mjs";

export const SHARES_FILE = "shares.json";

/** How often the sweep looks whether a link is due; it logs in only when one is. */
export const SWEEP_INTERVAL_MS = 60_000;

/** How long a sweep that could not reach the host waits before it tries again:
 *  a host that counts failed logins must not be given one a minute. */
export const SWEEP_RETRY_MS = 15 * 60_000;

/** How many fresh codes are drawn before giving up; one is all it ever takes. */
const CODE_ATTEMPTS = 5;

let unlockScript;

export function createShareRoutes(
  config,
  {
    now = () => Date.now(),
    random,
    log = () => {},
    pool = createConnectionPool({
      connect: (name) => openRemote(config.publish.targets[name], config)
    })
  } = {}
) {
  const publish = config.publish;
  const busy = new Set();
  // When each target's next link runs out: null when none will, absent until
  // the record has been read once since the start.
  const due = new Map();
  const writeTimeoutMs = Math.max(config.requestTimeoutMs, 180_000);

  const route = (method, path, maxBytes, bodyType, handler, timeoutMs) => ({
    method,
    path,
    capability: "publish",
    maxBytes,
    bodyType,
    handler,
    timeoutMs
  });

  async function load(remote) {
    return normalizeShares(await remote.readJson(remote.stateAbsolute(SHARES_FILE)));
  }

  async function save(remote, target, shares) {
    await remote.writeAbsolute(
      remote.stateAbsolute(SHARES_FILE),
      Buffer.from(serializeShares(target.name, shares), "utf8")
    );
    due.set(target.name, nextExpiry(shares));
  }

  /** The files that could not be removed; a missing one is removed already. */
  async function removeFiles(remote, paths) {
    const left = [];
    const gone = [];
    await mapLimit(paths, SFTP_CONCURRENCY, async (path) => {
      try {
        if (await remote.exists(remote.absolute(path))) await remote.remove(path);
        gone.push(path);
      } catch (err) {
        if (err instanceof AbandonedError) throw err;
        left.push(path);
      }
    });
    await remote.pruneEmptyDirectories(gone);
    return left.sort();
  }

  /**
   * Take down every link whose time is up. One whose files could not all be
   * removed keeps its record with what is left, so the next sweep tries again.
   */
  async function settle(remote, target, shares, say) {
    const codes = expiredShares(shares, now());
    for (const code of codes) {
      const share = shares.get(code);
      const left = await removeFiles(remote, share.files);
      if (left.length === 0) shares.delete(code);
      else shares.set(code, { ...share, files: left });
      say("info", `share ${target.name}/${code}: expired, ${left.length} file(s) left`);
    }
    return codes.length;
  }

  async function guardState(remote, target) {
    if (!target.stateInsideRoot) return;
    const path = remote.stateAbsolute(".htaccess");
    if (!(await remote.exists(path))) {
      await remote.writeAbsolute(path, Buffer.from(STATE_GUARD, "utf8"));
    }
  }

  async function freshCode(remote, shares) {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = newShareCode(random);
      if (shares.has(code)) continue;
      if (!(await remote.exists(directoryOf(remote, shareDirectory(code))))) return code;
    }
    throw httpError(500, "share_failed", "No free share code was found.");
  }

  async function guardIndex(remote) {
    const path = `${SHARE_DIRECTORY}/index.html`;
    if (!(await remote.exists(remote.absolute(path)))) {
      await remote.writeFile(path, Buffer.from(SHARE_INDEX_GUARD, "utf8"));
    }
  }

  async function sweep() {
    for (const target of Object.values(publish.targets)) {
      const at = due.get(target.name);
      if (at === null || (at !== undefined && at > now()) || busy.has(target.name)) continue;
      try {
        await exclusive(busy, target.name, () =>
          withRemote(pool, target, config.requestTimeoutMs, async (remote) => {
            const shares = await load(remote);
            if ((await settle(remote, target, shares, log)) > 0) await save(remote, target, shares);
            else due.set(target.name, nextExpiry(shares));
          })
        );
      } catch (err) {
        due.set(target.name, now() + SWEEP_RETRY_MS);
        log("warn", `share sweep ${target.name}: ${err.detail ?? err.message}`);
      }
    }
  }

  /** The sweep on a timer that does not keep the process alive; returns its stop. */
  function start(intervalMs = SWEEP_INTERVAL_MS) {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      sweep().finally(() => {
        running = false;
      });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  const routes = [
    route("GET", "/publish/shares", 0, "none", async ({ query, log: say, authorization }) => {
      const target = targetFor(publish, query.get("target"), authorization);
      return exclusive(busy, target.name, () =>
        withRemote(pool, target, config.requestTimeoutMs, async (remote) => {
          const shares = await load(remote);
          if ((await settle(remote, target, shares, say)) > 0) await save(remote, target, shares);
          else due.set(target.name, nextExpiry(shares));
          return {
            target: target.name,
            shares: [...shares.values()]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((share) => describeShare(share, target.baseUrl))
          };
        })
      );
    }),

    route(
      "POST",
      "/publish/share",
      MAX_SHARE_REQUEST_BYTES,
      "json",
      async ({ body, log: say, authorization }) => {
        const target = targetFor(publish, body?.target, authorization);
        const request = checked(() =>
          checkShareRequest(body, {
            now: now(),
            maxSourceBytes: publish.maxSourceBytes,
            maxImageBytes: publish.maxImageBytes
          })
        );
        const rendered = renderShare({ ...request, allowHtml: target.allowHtml });

        return exclusive(busy, target.name, () =>
          withRemote(pool, target, writeTimeoutMs, async (remote) => {
            await guardState(remote, target);
            const shares = await load(remote);
            await settle(remote, target, shares, say);

            const existing = request.code ? shares.get(request.code) : undefined;
            if (request.code && !existing) {
              throw httpError(404, "unknown_share", `No such share: ${request.code}.`);
            }
            if (!existing && shares.size >= MAX_SHARES) {
              throw httpError(
                409,
                "too_many_shares",
                `${target.name} keeps at most ${MAX_SHARES} links.`
              );
            }
            const code = existing?.code ?? (await freshCode(remote, shares));
            const files = await shareFiles({ code, request, rendered, target, random });

            const at = new Date(now()).toISOString();
            const record = {
              code,
              title: request.title,
              sourcePath: request.sourcePath,
              createdAt: existing?.createdAt ?? at,
              updatedAt: at,
              expiresAt: request.expiresAt,
              protected: request.password !== null,
              files: [...files.keys()].sort()
            };
            // Recorded before the bytes go, old files and new, so a crash in
            // between leaves a record of files that may be there, never a
            // file that nothing records.
            const stale = (existing?.files ?? []).filter((path) => !files.has(path));
            shares.set(code, { ...record, files: [...record.files, ...stale].sort() });
            await save(remote, target, shares);

            await guardIndex(remote);
            await mapLimit([...files.keys()], SFTP_CONCURRENCY, (path) =>
              remote.writeFile(path, files.get(path))
            );
            const left = await removeFiles(remote, stale);
            shares.set(code, { ...record, files: [...record.files, ...left].sort() });
            await save(remote, target, shares);

            say(
              "info",
              `share ${target.name}/${code}: ${existing ? "rewritten" : "written"}, ` +
                `${files.size} file(s), ${record.protected ? "protected" : "open"}, ` +
                `expires ${record.expiresAt ?? "never"}`
            );
            return describeShare(record, target.baseUrl);
          })
        );
      },
      writeTimeoutMs
    ),

    route(
      "POST",
      "/publish/share/revoke",
      64_000,
      "json",
      async ({ body, log: say, authorization }) => {
        const target = targetFor(publish, body?.target, authorization);
        if (!isShareCode(body?.code)) {
          throw httpError(400, "invalid_share", "Not a share code.");
        }
        return exclusive(busy, target.name, () =>
          withRemote(pool, target, config.requestTimeoutMs, async (remote) => {
            const shares = await load(remote);
            const share = shares.get(body.code);
            if (!share) throw httpError(404, "unknown_share", `No such share: ${body.code}.`);
            const left = await removeFiles(remote, share.files);
            if (left.length === 0) shares.delete(share.code);
            else
              shares.set(share.code, {
                ...share,
                files: left,
                expiresAt: new Date(0).toISOString()
              });
            await save(remote, target, shares);
            say("info", `share ${target.name}/${share.code}: revoked, ${left.length} file(s) left`);
            return { code: share.code, revoked: left.length === 0 };
          })
        );
      }
    )
  ];

  return { routes, sweep, start };
}

/**
 * Every file of one share, by path under the site's root: the page, the
 * stylesheets it links, the unlock script when it is protected, and the
 * header file on a host that reads one.
 */
export async function shareFiles({ code, request, rendered, target, random }) {
  const directory = shareDirectory(code);
  const files = new Map();
  const shown = {
    title: request.title,
    expiresAt: request.expiresAt,
    usedMath: rendered.usedMath,
    usedSlideshow: rendered.usedSlideshow
  };
  const page =
    request.password === null
      ? sharePage({ ...shown, body: rendered.html })
      : sharePage({
          ...shown,
          encrypted: await encryptShare(
            sharePlaintext({ title: request.title, body: rendered.html }),
            request.password,
            random ? { random } : {}
          )
        });
  files.set(`${directory}/index.html`, Buffer.from(page, "utf8"));

  for (const [path, content] of await generatorAssets({
    math: rendered.usedMath,
    mermaid: false,
    slideshow: rendered.usedSlideshow,
    theme: request.themeCss
  })) {
    files.set(`${directory}/${path.replace(/^assets\//, "")}`, content);
  }
  if (request.password !== null) {
    unlockScript ??= await readFile(new URL("./client/share-unlock.mjs", import.meta.url));
    files.set(`${directory}/unlock.js`, unlockScript);
  }
  for (const path of files.keys()) checkRelativePath(path);
  if (target.htaccess) {
    files.set(
      `${directory}/.htaccess`,
      Buffer.from(shareHtaccess({ expiresAt: request.expiresAt }), "utf8")
    );
  }
  return files;
}

/** A directory's absolute path, by the rule the remote checks file paths with. */
function directoryOf(remote, relative) {
  return remote.absolute(`${relative}/index.html`).replace(/\/index\.html$/, "");
}

function checked(work) {
  try {
    return work();
  } catch (err) {
    if (err instanceof ShareError) throw httpError(400, "invalid_share", err.message);
    throw err;
  }
}
