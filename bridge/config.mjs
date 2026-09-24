/**
 * Environment-driven configuration for the bridge.
 *
 * The bridge hosts capabilities — mail and publishing — and each one
 * brings its own credentials, its own token and its own limits. Configuration
 * is therefore read per capability: a capability whose variables are absent is
 * simply not offered, and a deployment that offers nothing fails at startup.
 *
 * Everything is read once and validated eagerly, so a misconfigured deployment
 * fails on boot with a precise message rather than on the first request with an
 * opaque protocol error.
 */

/** Bumped when the request or response shape changes in a way the plugin can
 *  see. Reported by /health so plugin and bridge can detect drift. */
export const PROTOCOL_VERSION = 1;

/** Minimum token length. Short tokens are brute-forceable over a public URL. */
export const MIN_TOKEN_LENGTH = 24;

/** Variables that, if any is present, mean the operator intended mail. */
const MAIL_KEYS = [
  "MAIL_TOKEN",
  "IMAP_HOST",
  "SMTP_HOST",
  "MAIL_USER",
  "MAIL_PASSWORD",
  "MAIL_FROM"
];

/** The same, for publishing. */
const PUBLISH_KEYS = ["PUBLISH_TOKEN", "PUBLISH_TARGETS"];

/** What a target is allowed to serve from an upload. Images and video only:
 *  anything else on a published site is written by the bridge itself. */
const DEFAULT_ASSET_EXTENSIONS = "png,jpg,jpeg,gif,webp,avif,svg,mp4,webm,ogv,mov,m4v";

export function loadConfig(env = process.env) {
  const mail = MAIL_KEYS.some((key) => present(env[key])) ? loadMail(env) : null;
  const publish = PUBLISH_KEYS.some((key) => present(env[key])) ? loadPublish(env) : null;

  if (!mail && !publish) {
    throw new Error(
      "No capability is configured. Set the mail variables " +
        `(${MAIL_KEYS.join(", ")}), the publish variables ` +
        `(${PUBLISH_KEYS.join(", ")}), or see bridge/README.md.`
    );
  }

  return {
    port: integer(env.PORT, 8080, "PORT"),
    // A request that has not finished by now is not going to. The budget covers
    // the whole request, including whatever it is waiting for upstream.
    requestTimeoutMs: integer(env.REQUEST_TIMEOUT_MS, 30_000, "REQUEST_TIMEOUT_MS"),
    // Every outbound protocol operation carries its own deadline, so a hung
    // connection cannot hold a request open until the client gives up.
    upstreamTimeoutMs: integer(env.UPSTREAM_TIMEOUT_MS, 20_000, "UPSTREAM_TIMEOUT_MS"),
    // Repeated authentication failures from one address earn a delay. A long
    // token makes brute force impractical, not impossible.
    authFailureLimit: integer(env.AUTH_FAILURE_LIMIT, 5, "AUTH_FAILURE_LIMIT"),
    authFailureWindowMs: integer(env.AUTH_FAILURE_WINDOW_MS, 60_000, "AUTH_FAILURE_WINDOW_MS"),
    // How long a shutdown waits for in-flight work before exiting anyway.
    drainTimeoutMs: integer(env.DRAIN_TIMEOUT_MS, 10_000, "DRAIN_TIMEOUT_MS"),
    // "json" for a hosting dashboard that can search fields; the default stays
    // human, because most of the time a person is reading these.
    logFormat: env.LOG_FORMAT?.trim() === "json" ? "json" : "text",
    // Whether the throttle may believe X-Forwarded-For. True behind the
    // platform's TLS-terminating proxy, where the socket address is the proxy's
    // and would otherwise be shared by every caller; false anywhere a client
    // can reach the bridge directly, because then the header is the client's.
    trustProxy: boolean(env.TRUST_PROXY, false, "TRUST_PROXY"),
    mail,
    publish
  };
}

/**
 * Publishing targets.
 *
 * Each target is one hosting account and one site, configured with its own
 * block of variables. The credentials live here rather than in the vault, which
 * is the whole reason publishing goes through the bridge at all, and it is why
 * adding a target is a redeploy rather than a setting.
 */
function loadPublish(env) {
  const missing = PUBLISH_KEYS.filter((key) => !present(env[key]));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const names = env.PUBLISH_TARGETS.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Error("PUBLISH_TARGETS names no target.");
  }

  const targets = {};
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error(
        `Unusable target name ${JSON.stringify(name)}: lowercase letters, digits and dashes.`
      );
    }
    targets[name] = loadTarget(env, name);
  }

  return {
    token: token(env.PUBLISH_TOKEN, "PUBLISH_TOKEN"),
    // Markdown is text; an image is an image; a video is the reason the upload
    // route streams instead of buffering a base64 payload.
    maxSourceBytes: integer(env.PUBLISH_MAX_SOURCE_BYTES, 2_000_000, "PUBLISH_MAX_SOURCE_BYTES"),
    maxImageBytes: integer(env.PUBLISH_MAX_IMAGE_BYTES, 10_000_000, "PUBLISH_MAX_IMAGE_BYTES"),
    maxVideoBytes: integer(env.PUBLISH_MAX_VIDEO_BYTES, 25_000_000, "PUBLISH_MAX_VIDEO_BYTES"),
    maxIndexBytes: integer(env.PUBLISH_MAX_INDEX_BYTES, 4_000_000, "PUBLISH_MAX_INDEX_BYTES"),
    maxFiles: integer(env.PUBLISH_MAX_FILES, 2000, "PUBLISH_MAX_FILES"),
    targets
  };
}

function loadTarget(env, name) {
  const prefix = `PUBLISH_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const read = (suffix) => env[`${prefix}_${suffix}`]?.trim();
  const required = (suffix) => {
    const value = read(suffix);
    if (!value) throw new Error(`Missing required environment variable: ${prefix}_${suffix}`);
    return value;
  };

  const root = required("ROOT");
  if (!root.startsWith("/")) {
    throw new Error(`${prefix}_ROOT must be an absolute path.`);
  }

  const baseUrl = required("BASE_URL").replace(/\/+$/, "");
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) {
    throw new Error(`${prefix}_BASE_URL must be https:// (or localhost).`);
  }

  const stateRoot = (read("STATE_ROOT") || `${root.replace(/\/+$/, "")}/.schreibstube`).replace(
    /\/+$/,
    ""
  );
  if (!stateRoot.startsWith("/")) {
    throw new Error(`${prefix}_STATE_ROOT must be an absolute path.`);
  }

  const key = read("KEY");
  const password = read("PASSWORD");
  if (!key && !password) {
    throw new Error(`${prefix} needs either a KEY or a PASSWORD.`);
  }
  if (key && password) {
    throw new Error(`${prefix} has both a KEY and a PASSWORD; pick one.`);
  }

  return {
    name,
    host: required("HOST"),
    port: integer(read("PORT"), 22),
    user: required("USER"),
    // The key travels as base64 so a PEM survives an environment variable.
    key: key ? Buffer.from(key, "base64").toString("utf8") : undefined,
    keyPassphrase: read("KEY_PASSPHRASE") || undefined,
    password: password || undefined,
    // Trust on first use cannot work here: the container is stateless and would
    // re-trust a new key after every restart.
    fingerprint: required("HOST_FINGERPRINT"),
    root: root.replace(/\/+$/, ""),
    // Sources and the manifest belong outside the served tree where the host
    // allows it; under it is the fallback, and then a deny rule is needed.
    stateRoot,
    stateInsideRoot: isWithin(stateRoot, root.replace(/\/+$/, "")),
    baseUrl,
    siteTitle: read("SITE_TITLE") || name,
    // A personal site is the author's own HTML; a shared vault is not. The
    // switch exists so that judgement belongs to whoever deploys the bridge.
    allowHtml: boolean(read("ALLOW_HTML"), true),
    // A page with a diagram loads a five megabyte bundle. A site that never
    // draws one should not have to carry the possibility.
    allowDiagrams: boolean(read("ALLOW_DIAGRAMS"), true),
    assetExtensions: new Set(
      (read("ALLOWED_EXT") || DEFAULT_ASSET_EXTENSIONS)
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  };
}

function loadMail(env) {
  const missing = MAIL_KEYS.filter((key) => !present(env[key]));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const imapSecure = boolean(env.IMAP_SECURE, true, "IMAP_SECURE");
  const smtpSecure = boolean(env.SMTP_SECURE, true, "SMTP_SECURE");
  const auth = { user: env.MAIL_USER.trim(), pass: env.MAIL_PASSWORD };

  return {
    token: token(env.MAIL_TOKEN, "MAIL_TOKEN"),
    // Requests are capped well below any realistic note size so a malformed or
    // hostile client cannot exhaust memory on a small container.
    maxBodyBytes: integer(env.MAX_BODY_BYTES, 1_000_000, "MAX_BODY_BYTES"),
    maxTextChars: integer(env.MAX_TEXT_CHARS, 40_000, "MAX_TEXT_CHARS"),
    maxMessageBytes: integer(env.MAX_MESSAGE_BYTES, 10_000_000, "MAX_MESSAGE_BYTES"),
    maxResults: integer(env.MAX_RESULTS, 50, "MAX_RESULTS"),
    imap: {
      host: env.IMAP_HOST.trim(),
      port: integer(env.IMAP_PORT, imapSecure ? 993 : 143, "IMAP_PORT"),
      secure: imapSecure,
      auth
    },
    smtp: {
      host: env.SMTP_HOST.trim(),
      port: integer(env.SMTP_PORT, smtpSecure ? 465 : 587, "SMTP_PORT"),
      secure: smtpSecure,
      auth
    },
    from: env.MAIL_FROM.trim(),
    defaultMailbox: env.DEFAULT_MAILBOX?.trim() || "INBOX",
    // SMTP does not file a copy in Sent — the bridge APPENDs it over IMAP.
    // A name is used as written; an empty string skips the step (e.g. if the
    // server does it); unset, null, asks the server which folder it tags Sent.
    sentMailbox: env.SENT_MAILBOX === "" ? "" : env.SENT_MAILBOX?.trim() || null
  };
}

/**
 * Whether a remote path lies at or below a directory.
 *
 * By segments, so `/var/www/blog-state` is not inside `/var/www/blog`. A path
 * with `..` in it is counted as inside, because a web server may resolve it
 * back into the served tree and the safe answer is the one that warns.
 */
export function isWithin(path, directory) {
  if (path.split("/").includes("..")) return true;
  const base = directory.replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`) || base === "";
}

/** The names of the capabilities this configuration actually offers. */
export function capabilityNames(config) {
  return ["mail", "publish"].filter((name) => config[name]);
}

function token(value, name) {
  const trimmed = value.trim();
  if (trimmed.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_TOKEN_LENGTH} characters ` +
        `(got ${trimmed.length}). Generate one with: openssl rand -base64 32`
    );
  }
  return trimmed;
}

function present(value) {
  return Boolean(value?.trim());
}

/**
 * A positive integer from the environment, or the default when unset.
 *
 * Set and unreadable is a mistake, not a default: `PORT=808O` and
 * `PUBLISH_MAX_FILES=-1` were silently replaced by whatever the code happened
 * to prefer, in a module whose whole promise is that a misconfigured
 * deployment does not boot.
 */
function integer(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;

  const text = String(value).trim();
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name ?? "A numeric variable"} must be a positive integer, not "${text}".`);
  }
  return n;
}

/**
 * A flag from the environment, spelled the way flags are spelled.
 *
 * Anything unrecognised used to read as true, so `TRUST_PROXY=flase` turned
 * the proxy trust on — the reading furthest from what was typed.
 */
function boolean(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new Error(`${name ?? "A boolean variable"} must be true or false, not "${text}".`);
}
