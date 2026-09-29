/**
 * Where the copy of a sent message is filed. Pure: the server's answers come
 * in as data, which is what lets every branch here be tested without a mailbox.
 */

/** What a server that tags nothing gets, as before there was any detection. */
export const FALLBACK_SENT_MAILBOX = "Sent";

/** Gmail's capability. Gmail files what its SMTP sends by itself. */
const GMAIL_CAPABILITY = "X-GM-EXT-1";

/**
 * Decide where the copy goes.
 *
 * `configured` is `SENT_MAILBOX` as read: a name, `""` for "never file", or
 * null when unset. A name the operator wrote beats anything the server says,
 * because it may be deliberate — sent copies kept somewhere other than the
 * server's Sent folder. Unset, the server's tag decides, then the fallback.
 *
 * Returns the mailbox, or null for none; `filedByServer` says whether the copy
 * exists anyway, so the caller can report it truthfully.
 */
export function chooseSentMailbox({ configured = null, mailboxes = [], capabilities = [] } = {}) {
  if (configured === "") return { mailbox: null, filedByServer: false };
  if (typeof configured === "string") return { mailbox: configured, filedByServer: false };

  // Gmail files its own copy; a second one would be a duplicate in every thread.
  if (hasCapability(capabilities, GMAIL_CAPABILITY)) {
    return { mailbox: null, filedByServer: true };
  }

  const tagged = mailboxes.find(isTaggedSent);
  return { mailbox: tagged ? tagged.path : FALLBACK_SENT_MAILBOX, filedByServer: false };
}

/**
 * A folder the server itself marks as Sent, and one that can take a message.
 *
 * The shape is imapflow's list entry: `specialUseSource` is "extension" for a
 * flag the server sent and "name" for imapflow's own reading of the name,
 * which is the guess this module refuses.
 */
function isTaggedSent(entry) {
  if (!entry || typeof entry.path !== "string" || !entry.path) return false;
  if (entry.specialUse !== "\\Sent" || entry.specialUseSource !== "extension") return false;
  const flags = new Set(entry.flags ?? []);
  return !flags.has("\\Noselect") && !flags.has("\\NonExistent");
}

function hasCapability(capabilities, name) {
  for (const capability of capabilities ?? []) {
    if (String(capability).toUpperCase() === name) return true;
  }
  return false;
}
