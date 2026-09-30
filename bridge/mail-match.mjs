/**
 * The plugin's search criteria, decided by the bridge instead of the server.
 *
 * Used when the server refuses a SEARCH: the newest messages are read as
 * envelopes and matched here, so a search still returns mail. Everything is
 * compared the way IMAP SEARCH compares it — a case-insensitive substring, a
 * date on or after `since` — so the two paths agree on what matches. The body
 * text is the one criterion an envelope cannot answer.
 */

/** How many of the newest messages are read when the server will not search.
 *  An envelope with the thread headers is well under a kilobyte. */
export const MAX_FALLBACK_SCAN = 2000;

/** Whether the criteria can be decided from an envelope at all. */
export function matchableWithoutServer(criteria) {
  return !present(criteria.text);
}

/**
 * Whether one message, read as `{from, to, subject, date, headers}`, meets
 * every criterion. `from` and `to` are the header's addresses as text, `date`
 * the arrival date, `headers` the raw References and In-Reply-To lines.
 */
export function matchesCriteria(message, criteria) {
  if (present(criteria.from) && !contains(message.from, criteria.from)) return false;
  if (present(criteria.to) && !contains(message.to, criteria.to)) return false;
  if (present(criteria.subject) && !contains(message.subject, criteria.subject)) return false;
  if (
    present(criteria.references) &&
    !String(message.headers ?? "").includes(criteria.references.trim())
  ) {
    return false;
  }
  if (criteria.since) {
    const since = new Date(criteria.since);
    const date = message.date instanceof Date ? message.date : new Date(message.date ?? NaN);
    if (!Number.isNaN(since.getTime()) && !(date.getTime() >= since.getTime())) return false;
  }
  return true;
}

/** An envelope's address list as the text a header search would look through. */
export function addressText(addresses) {
  if (!Array.isArray(addresses)) return "";
  return addresses
    .map((entry) => [entry?.name, entry?.address && `<${entry.address}>`].filter(Boolean).join(" "))
    .join(", ");
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function contains(haystack, needle) {
  return fold(haystack).includes(fold(needle));
}

function fold(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
