import { describe, expect, it } from "vitest";
import { createConnectionPool } from "./connection-pool.mjs";

/**
 * One shared connection per target, closed when idle and never reused once
 * it may be broken. Timers are in the test's hand; nothing touches a network.
 */

function harness({ idleMs = 1000, failLogin = false } = {}) {
  const logins = [];
  const timers = new Map();
  let nextTimer = 1;

  const pool = createConnectionPool({
    idleMs,
    connect: async (key) => {
      if (failLogin) throw new Error("login refused");
      const remote = {
        key,
        ended: false,
        closeHandlers: [],
        onClose(callback) {
          remote.closeHandlers.push(callback);
        },
        async end() {
          remote.ended = true;
        }
      };
      logins.push(remote);
      return remote;
    },
    setTimer: (callback) => {
      const handle = nextTimer++;
      timers.set(handle, callback);
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle)
  });

  return {
    pool,
    logins,
    /** Let the idle time pass. */
    idle() {
      for (const [handle, callback] of [...timers]) {
        timers.delete(handle);
        callback();
      }
    },
    get pendingTimers() {
      return timers.size;
    }
  };
}

const httpRefusal = () => Object.assign(new Error("refused"), { status: 400 });

describe("createConnectionPool", () => {
  it("logs in once for requests that follow each other", async () => {
    const h = harness();
    await h.pool.use("blog", async () => {});
    await h.pool.use("blog", async () => {});
    expect(h.logins).toHaveLength(1);
  });

  it("shares one login among requests that arrive together", async () => {
    const h = harness();
    await Promise.all([1, 2, 3].map(() => h.pool.use("blog", async () => {})));
    expect(h.logins).toHaveLength(1);
  });

  it("keeps a connection per target", async () => {
    const h = harness();
    await h.pool.use("blog", async () => {});
    await h.pool.use("notizen", async () => {});
    expect(h.logins.map((remote) => remote.key)).toEqual(["blog", "notizen"]);
  });

  it("closes the connection once it has been idle, and logs in anew after", async () => {
    const h = harness();
    await h.pool.use("blog", async () => {});
    expect(h.logins[0].ended).toBe(false);
    h.idle();
    expect(h.logins[0].ended).toBe(true);
    await h.pool.use("blog", async () => {});
    expect(h.logins).toHaveLength(2);
  });

  it("does not close a connection that is still in use", async () => {
    const h = harness();
    let finish;
    const running = h.pool.use("blog", () => new Promise((resolve) => (finish = resolve)));
    await h.pool.use("blog", async () => {}); // a short request ends beside the long one
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.pendingTimers).toBe(0);
    h.idle();
    expect(h.logins[0].ended).toBe(false);
    finish();
    await running;
    expect(h.pendingTimers).toBe(1);
  });

  it("keeps the connection through a refusal the route made itself", async () => {
    const h = harness();
    await expect(h.pool.use("blog", async () => Promise.reject(httpRefusal()))).rejects.toThrow();
    await h.pool.use("blog", async () => {});
    expect(h.logins).toHaveLength(1);
  });

  it("retires a connection after a failure that may have broken it", async () => {
    const h = harness();
    await expect(
      h.pool.use("blog", async () => {
        throw new Error("channel closed");
      })
    ).rejects.toThrow("channel closed");
    expect(h.logins[0].ended).toBe(true);
    await h.pool.use("blog", async () => {});
    expect(h.logins).toHaveLength(2);
  });

  it("lets the requests still running on a retired connection finish first", async () => {
    const h = harness();
    let finish;
    const long = h.pool.use("blog", () => new Promise((resolve) => (finish = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(
      h.pool.use("blog", async () => {
        throw new Error("broken pipe");
      })
    ).rejects.toThrow();
    expect(h.logins[0].ended).toBe(false);
    finish();
    await long;
    expect(h.logins[0].ended).toBe(true);
  });

  it("does not hand out a connection the server closed", async () => {
    const h = harness();
    await h.pool.use("blog", async () => {});
    for (const handler of h.logins[0].closeHandlers) handler();
    await h.pool.use("blog", async () => {});
    expect(h.logins).toHaveLength(2);
  });

  it("rejects with the login's own error and leaves nothing behind", async () => {
    const h = harness({ failLogin: true });
    await expect(h.pool.use("blog", async () => {})).rejects.toThrow("login refused");
    expect(h.pool.size).toBe(0);
  });
});
