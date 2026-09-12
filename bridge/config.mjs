/**
 * Environment-driven configuration for the bridge.
 *
 * The bridge hosts capabilities — mail today, publishing next — and each one
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

export function loadConfig(env = process.env) {
  const mail = MAIL_KEYS.some((key) => present(env[key])) ? loadMail(env) : null;

  if (!mail) {
    throw new Error(
      "No capability is configured. Set the mail variables " +
        `(${MAIL_KEYS.join(", ")}) or see bridge/README.md.`
    );
  }

  return {
    port: integer(env.PORT, 8080),
    // A request that has not finished by now is not going to. The budget covers
    // the whole request, including whatever it is waiting for upstream.
    requestTimeoutMs: integer(env.REQUEST_TIMEOUT_MS, 30_000),
    // Every outbound protocol operation carries its own deadline, so a hung
    // connection cannot hold a request open until the client gives up.
    upstreamTimeoutMs: integer(env.UPSTREAM_TIMEOUT_MS, 20_000),
    // Repeated authentication failures from one address earn a delay. A long
    // token makes brute force impractical, not impossible.
    authFailureLimit: integer(env.AUTH_FAILURE_LIMIT, 5),
    authFailureWindowMs: integer(env.AUTH_FAILURE_WINDOW_MS, 60_000),
    // How long a shutdown waits for in-flight work before exiting anyway.
    drainTimeoutMs: integer(env.DRAIN_TIMEOUT_MS, 10_000),
    mail
  };
}

function loadMail(env) {
  const missing = MAIL_KEYS.filter((key) => !present(env[key]));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const imapSecure = boolean(env.IMAP_SECURE, true);
  const smtpSecure = boolean(env.SMTP_SECURE, true);
  const auth = { user: env.MAIL_USER.trim(), pass: env.MAIL_PASSWORD };

  return {
    token: token(env.MAIL_TOKEN, "MAIL_TOKEN"),
    // Requests are capped well below any realistic note size so a malformed or
    // hostile client cannot exhaust memory on a small container.
    maxBodyBytes: integer(env.MAX_BODY_BYTES, 1_000_000),
    maxTextChars: integer(env.MAX_TEXT_CHARS, 40_000),
    maxResults: integer(env.MAX_RESULTS, 50),
    imap: {
      host: env.IMAP_HOST.trim(),
      port: integer(env.IMAP_PORT, imapSecure ? 993 : 143),
      secure: imapSecure,
      auth
    },
    smtp: {
      host: env.SMTP_HOST.trim(),
      port: integer(env.SMTP_PORT, smtpSecure ? 465 : 587),
      secure: smtpSecure,
      auth
    },
    from: env.MAIL_FROM.trim(),
    defaultMailbox: env.DEFAULT_MAILBOX?.trim() || "INBOX",
    // SMTP does not file a copy in Sent — the bridge APPENDs it over IMAP.
    // Set to an empty string to skip that step (e.g. if the server does it).
    sentMailbox: env.SENT_MAILBOX === "" ? "" : env.SENT_MAILBOX?.trim() || "Sent"
  };
}

/** The names of the capabilities this configuration actually offers. */
export function capabilityNames(config) {
  return ["mail"].filter((name) => config[name]);
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

function integer(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function boolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}
