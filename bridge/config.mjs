/**
 * Environment-driven configuration for the mail bridge.
 *
 * Everything the bridge needs is read once at startup and validated eagerly, so
 * a misconfigured deployment fails on boot with a precise message rather than
 * on the first request with an opaque IMAP error.
 */

const REQUIRED = [
  "BRIDGE_TOKEN",
  "IMAP_HOST",
  "SMTP_HOST",
  "MAIL_USER",
  "MAIL_PASSWORD",
  "MAIL_FROM"
];

/** Minimum token length. Short tokens are brute-forceable over a public URL. */
export const MIN_TOKEN_LENGTH = 24;

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const token = env.BRIDGE_TOKEN.trim();
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `BRIDGE_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters ` +
        `(got ${token.length}). Generate one with: openssl rand -base64 32`
    );
  }

  const imapSecure = boolean(env.IMAP_SECURE, true);
  const smtpSecure = boolean(env.SMTP_SECURE, true);

  return {
    port: integer(env.PORT, 8080),
    token,
    // Requests are capped well below any realistic note size so a malformed or
    // hostile client cannot exhaust memory on a small container.
    maxBodyBytes: integer(env.MAX_BODY_BYTES, 1_000_000),
    maxTextChars: integer(env.MAX_TEXT_CHARS, 40_000),
    maxResults: integer(env.MAX_RESULTS, 50),
    imap: {
      host: env.IMAP_HOST.trim(),
      port: integer(env.IMAP_PORT, imapSecure ? 993 : 143),
      secure: imapSecure,
      auth: { user: env.MAIL_USER.trim(), pass: env.MAIL_PASSWORD }
    },
    smtp: {
      host: env.SMTP_HOST.trim(),
      port: integer(env.SMTP_PORT, smtpSecure ? 465 : 587),
      secure: smtpSecure,
      auth: { user: env.MAIL_USER.trim(), pass: env.MAIL_PASSWORD }
    },
    from: env.MAIL_FROM.trim(),
    defaultMailbox: env.DEFAULT_MAILBOX?.trim() || "INBOX",
    // SMTP does not file a copy in Sent — the bridge APPENDs it over IMAP.
    // Set to an empty string to skip that step (e.g. if the server does it).
    sentMailbox: env.SENT_MAILBOX === "" ? "" : env.SENT_MAILBOX?.trim() || "Sent"
  };
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
