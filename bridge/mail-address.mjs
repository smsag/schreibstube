/**
 * The sender of a message, read once and checked before anything is sent.
 *
 * A sender reached nodemailer as whatever string it was given. One without an
 * address — `MAIL_FROM=Steffen Seitz`, or a quote in the wrong place — compiled
 * to a message with no From header at all, and a Message-ID `@localhost`; the
 * mail server accepted it anyway, so the send reported success and the Sent
 * copy was the only trace that something was wrong. A sender is now one
 * address, optionally with a display name, or it is refused: at startup for
 * `MAIL_FROM`, as a 400 for a request's `from`.
 */
import addressparser from "nodemailer/lib/addressparser";

/** RFC 5321 caps a path at 256 octets; a name on top is generous at 64 more. */
export const MAX_SENDER_CHARS = 320;

/** Deliberately loose, as the plugin's own check is: one `@`, a dot in the
 *  domain, and none of the characters that would end or split an address. */
const ADDRESS = /^[^\s@<>",;:]+@[^\s@<>",;:.]+(\.[^\s@<>",;:.]+)+$/;

/** No line breaks and no controls: a header value must stay one header. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * `Name <address>` or a bare `address`, as `{ name, address }`, or null.
 *
 * The name is handed to nodemailer as a field of its own rather than inside a
 * string, so a comma or an umlaut in it is quoted and encoded there instead of
 * being read as a second address.
 */
export function parseSender(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_SENDER_CHARS || CONTROL.test(text)) return null;

  const bracketed = /^(.*?)\s*<([^<>]*)>$/.exec(text);
  const name = bracketed ? unquote(bracketed[1].trim()) : "";
  const address = (bracketed ? bracketed[2] : text).trim();

  if (!ADDRESS.test(address)) return null;
  if (/[<>]/.test(name)) return null;
  return { name, address };
}

/** The domain of a checked sender, for the Message-ID. */
export function senderDomain(sender) {
  return sender.address.slice(sender.address.lastIndexOf("@") + 1);
}

/**
 * The bare addresses in a recipient field — a string or a list of them, each
 * holding one or more addresses as a header writes them.
 *
 * Read by the same parser that writes the header, so the two cannot disagree:
 * a split at every comma turned `"Seitz, Steffen" <s@x.de>` into an envelope
 * recipient `"Seitz` that no header named, and a group's members were lost.
 * The route checks a request with it too, so what it refuses is what the
 * envelope would have carried.
 */
export function recipientAddresses(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => flatten(addressparser(String(item))));
}

function flatten(entries) {
  return entries.flatMap((entry) =>
    entry.group ? flatten(entry.group) : entry.address ? [entry.address.trim()] : []
  );
}

function unquote(name) {
  return name.length >= 2 && name.startsWith('"') && name.endsWith('"')
    ? name.slice(1, -1).trim()
    : name;
}
