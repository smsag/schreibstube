/**
 * Authentication failure throttle.
 *
 * The bridge is a public URL guarded by a bearer token. A token of the required
 * length is not realistically brute-forceable, but "not realistic" is a weaker
 * guarantee than "not allowed to try", and the cost of saying so is a map.
 *
 * State is per address and in memory: the bridge runs as a single instance, and
 * a throttle that forgets on restart is still a throttle.
 *
 * What it must not do is remember forever. An address was only forgotten when
 * it was asked about again, so every address that ever failed stayed in the
 * map — nothing for a handful of callers, unbounded for a scanner walking a
 * range, on a process meant to run for months.
 */

/** Above this many remembered addresses, a failure also sweeps the map. */
const SWEEP_ABOVE = 1000;

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

  /**
   * Drop the addresses whose failures have all aged out.
   *
   * Only when the map has grown past a size a real deployment reaches, so the
   * ordinary case stays two map operations and the pathological one stays
   * bounded.
   */
  function sweep() {
    if (failures.size <= SWEEP_ABOVE) return;
    const cutoff = now() - windowMs;
    for (const [key, at] of failures) {
      if (at.every((time) => time <= cutoff)) failures.delete(key);
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
      const at = recent(key);
      at.push(now());
      failures.set(key, at);
      sweep();
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
