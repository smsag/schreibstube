/**
 * One SFTP connection per target, shared by the requests of one publish and
 * closed once idle. No I/O of its own: `connect` and the timers come in,
 * which is what lets the tests drive it without a server.
 */

/** Long enough to span the requests of one publish, short enough to hold nothing between. */
export const IDLE_CLOSE_MS = 15_000;

export function createConnectionPool({
  connect,
  idleMs = IDLE_CLOSE_MS,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (handle) => clearTimeout(handle)
}) {
  /** key → { ready, remote, users, timer, broken } */
  const slots = new Map();

  function retire(key, slot) {
    slot.broken = true;
    if (slots.get(key) === slot) slots.delete(key);
    if (slot.users === 0) close(slot);
  }

  function close(slot) {
    if (slot.timer !== undefined) clearTimer(slot.timer);
    slot.timer = undefined;
    if (slot.closed) return;
    slot.closed = true;
    slot.remote?.end?.().catch?.(() => {});
  }

  async function checkout(key) {
    let slot = slots.get(key);
    if (!slot) {
      slot = { users: 0, broken: false, closed: false };
      const current = slot;
      slot.ready = Promise.resolve()
        .then(() => connect(key))
        .then((remote) => {
          current.remote = remote;
          // A line the server hung up on is not handed out again.
          remote.onClose?.(() => retire(key, current));
          return remote;
        });
      slots.set(key, slot);
      // A failed login leaves no slot behind for the next request to trip on.
      slot.ready.catch(() => {
        if (slots.get(key) === current) slots.delete(key);
      });
    }

    slot.users += 1;
    if (slot.timer !== undefined) {
      clearTimer(slot.timer);
      slot.timer = undefined;
    }
    try {
      return { slot, remote: await slot.ready };
    } catch (error) {
      slot.users -= 1;
      throw error;
    }
  }

  function release(key, slot) {
    slot.users -= 1;
    if (slot.users > 0) return;
    if (slot.broken) {
      close(slot);
      return;
    }
    slot.timer = setTimer(() => {
      slot.timer = undefined;
      if (slot.users === 0) retire(key, slot);
    }, idleMs);
    slot.timer?.unref?.();
  }

  return {
    /**
     * Run `work` with the key's connection, opening one if there is none.
     * A login that fails rejects with its own error, before `work` runs.
     */
    async use(key, work) {
      const { slot, remote } = await checkout(key);
      try {
        return await work(remote);
      } catch (error) {
        // A refusal the route made itself says nothing about the line; any
        // other failure might, and a fresh login is cheaper than a second one.
        if (!error?.status) retire(key, slot);
        throw error;
      } finally {
        release(key, slot);
      }
    },

    /** How many connections are open or opening, for the tests. */
    get size() {
      return slots.size;
    }
  };
}
