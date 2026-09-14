/**
 * Authentication failure throttle.
 *
 * The bridge is a public URL guarded by a bearer token. A token of the required
 * length is not realistically brute-forceable, but "not realistic" is a weaker
 * guarantee than "not allowed to try", and the cost of saying so is a map.
 *
 * State is per address and in memory: the bridge runs as a single instance, and
 * a throttle that forgets on restart is still a throttle.
 */

export function createThrottle({ limit = 5, windowMs = 60_000, now = () => Date.now() } = {}) {
  const failures = new Map();

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
      const at = recent(key);
      at.push(now());
      failures.set(key, at);
    },

    /** A success clears the record: the caller has proved it holds a token. */
    recordSuccess(key) {
      failures.delete(key);
    },

    get size() {
      return failures.size;
    }
  };
}
