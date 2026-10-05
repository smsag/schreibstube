/**
 * Authentication failure throttle, per address and in memory.
 *
 * What it must not do is remember forever. An address was only forgotten when
 * it was asked about again, so every address that ever failed stayed in the
 * map — nothing for a handful of callers, unbounded for a scanner walking a
 * range, on a process meant to run for months.
 *
 * Nor may anything but time forget a failure. A success used to clear the
 * address's record, and a caller holding the mail token could then guess at
 * the publish token without end: four wrong guesses, one good mail request,
 * four more. Failures now age out of the window and nothing else.
 */

/** Above this many remembered addresses, a failure also sweeps the map. */
const SWEEP_ABOVE = 1000;

/**
 * The most addresses remembered at once. The keys are chosen by whoever sends
 * the request — an IPv6 network hands out more than any map holds — so past
 * this the address that failed longest ago is forgotten first. A scanner that
 * walks that many networks inside one window gets fresh guesses on its oldest
 * ones; that is the price of a process whose memory a stranger cannot fill.
 */
export const MAX_THROTTLE_KEYS = 10_000;

export function createThrottle({
  limit = 5,
  windowMs = 60_000,
  now = () => Date.now(),
  maxKeys = MAX_THROTTLE_KEYS
} = {}) {
  const failures = new Map();
  let sweptAt = -Infinity;

  function recent(key) {
    const at = failures.get(key) ?? [];
    const cutoff = now() - windowMs;
    const kept = at.filter((time) => time > cutoff);
    if (kept.length > 0) {
      failures.set(key, kept);
    } else {
      failures.delete(key);
    }
    return kept;
  }

  /**
   * Drop the addresses whose failures have all aged out: only past a size a
   * real deployment reaches, and at most once per window, since a scanner
   * that keeps the map large would otherwise have every failure walk it.
   */
  function sweep() {
    if (failures.size <= SWEEP_ABOVE) return;
    if (now() - sweptAt < windowMs) return;
    sweptAt = now();
    const cutoff = now() - windowMs;
    for (const [key, at] of failures) {
      if (at.every((time) => time <= cutoff)) failures.delete(key);
    }
  }

  /** A Map iterates in insertion order, and a failure re-inserts its key, so
   *  the first key is the one that failed longest ago. */
  function evict() {
    while (failures.size > maxKeys) {
      failures.delete(failures.keys().next().value);
    }
  }

  return {
    /** Whether this address may attempt, and how long it must wait if not. */
    check(key) {
      const at = recent(key);
      if (at.length < limit) {
        return { allowed: true };
      }
      const retryAfterMs = at[0] + windowMs - now();
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    },

    recordFailure(key) {
      // Only the newest `limit` count: the caller is free again once the
      // oldest of them ages out, and a longer list is memory for nothing.
      const at = [...recent(key), now()].slice(-limit);
      failures.delete(key);
      failures.set(key, at);
      sweep();
      evict();
    },

    get size() {
      return failures.size;
    }
  };
}
