/**
 * What a send may do: whom it may claim to be from, how many it may reach,
 * and how often.
 *
 * The mail token is a credential for one person's mailbox, and the bridge
 * used to treat it as a credential for any mail at all: a request named any
 * From it liked and any number of recipients, as often as it liked. Whoever
 * held the token — or took it from a phone — had a relay that signed with
 * the account's reputation. These are the bounds that make it a mailbox
 * again. Pure, so each rule is tested without a server.
 */
import { parseSender } from "./mail-address.mjs";

/** More entries than this is a list of everyone, which is no list. */
export const MAX_FROM_ALLOWED = 100;

/** Recipients of one send, to, cc and bcc together. */
export const DEFAULT_MAX_RECIPIENTS = 50;

/** Sends per hour. One person writing mail from notes sends a few. */
export const DEFAULT_SEND_PER_HOUR = 60;

/** A domain as an allow list names one: labels, dots, no wildcard. */
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/**
 * `MAIL_FROM_ALLOWED`, read at startup: addresses and `@domain` entries,
 * separated by commas. The account's own address is always in it, so an
 * unset variable means "only MAIL_FROM". A domain is that domain alone, not
 * its subdomains: `@example.com` is not `@mail.example.com`, which is what
 * a person typing it means and the narrower reading of what they did not.
 */
export function parseFromAllowed(value, accountAddress) {
  const addresses = new Set([accountAddress.toLowerCase()]);
  const domains = new Set();
  const entries = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length > MAX_FROM_ALLOWED) {
    throw new Error(`MAIL_FROM_ALLOWED names more than ${MAX_FROM_ALLOWED} entries.`);
  }

  for (const entry of entries) {
    if (entry.startsWith("@")) {
      const domain = entry.slice(1).toLowerCase();
      if (!DOMAIN.test(domain)) {
        throw new Error(`MAIL_FROM_ALLOWED: "${entry}" is not a domain, such as @example.de.`);
      }
      domains.add(domain);
      continue;
    }
    const sender = parseSender(entry);
    if (!sender || sender.name) {
      throw new Error(
        `MAIL_FROM_ALLOWED: "${entry}" is neither a bare address nor an @domain entry.`
      );
    }
    addresses.add(sender.address.toLowerCase());
  }
  return { addresses, domains };
}

/** Whether a checked sender's address may be a send's From. */
export function senderAllowed(address, allowed) {
  const lower = String(address).toLowerCase();
  if (allowed.addresses.has(lower)) return true;
  return allowed.domains.has(lower.slice(lower.lastIndexOf("@") + 1));
}

/**
 * A budget of `limit` events per `windowMs`, sliding: the oldest event that
 * still counts says when the next one may happen. Holds at most `limit`
 * times, whatever is asked of it.
 */
export function createRateLimit({ limit, windowMs, now = () => Date.now() }) {
  let times = [];
  return {
    /** Spend one event if the budget allows it. */
    take() {
      const cutoff = now() - windowMs;
      times = times.filter((time) => time > cutoff);
      if (times.length >= limit) {
        const retryAfterMs = times[0] + windowMs - now();
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      times.push(now());
      return { allowed: true };
    }
  };
}

/**
 * What a log line may say about an upstream failure: its codes, never its
 * words. nodemailer's message quotes the server's reply, and the reply to a
 * refused recipient names the recipient; the log is read by whoever runs the
 * host, who is not owed the user's correspondents.
 */
export function failureCodes(err) {
  const codes = [err?.code, err?.responseCode, err?.serverResponseCode, err?.name]
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map(String)
    .filter((value) => /^[A-Za-z0-9_.-]{1,40}$/.test(value));
  return [...new Set(codes)].join(" ") || "no code";
}
