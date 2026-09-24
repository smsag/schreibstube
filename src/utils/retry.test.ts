import { describe, expect, it, vi } from "vitest";
import { backoffMs, isWorthRetrying, withRetry } from "./retry";

/** Nothing waits: the delay is injected, and so is the jitter. */
const instant = { wait: async () => {}, random: () => 0.5, baseMs: 100 };

describe("withRetry", () => {
  it("returns the first success without waiting", async () => {
    const work = vi.fn(async () => "fertig");
    expect(await withRetry(work, instant)).toBe("fertig");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("repeats a dropped connection and returns the eventual success", async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(new Error("bridge did not respond within 45s."))
      .mockResolvedValue("fertig");

    expect(await withRetry(work, instant)).toBe("fertig");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last attempt and rethrows what failed", async () => {
    const work = vi.fn().mockRejectedValue(new Error("socket hang up"));
    await expect(withRetry(work, { ...instant, attempts: 3 })).rejects.toThrow("socket hang up");
    expect(work).toHaveBeenCalledTimes(3);
  });

  it("does not repeat a rejection that will be rejected again", async () => {
    const work = vi.fn().mockRejectedValue(new Error("bridge rejected the token"));
    await expect(withRetry(work, instant)).rejects.toThrow(/token/);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("reports each retry, so a slow publish explains itself in the log", async () => {
    const onRetry = vi.fn();
    const work = vi.fn().mockRejectedValueOnce(new Error("ETIMEDOUT")).mockResolvedValue(1);

    await withRetry(work, { ...instant, onRetry });
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });
});

describe("isWorthRetrying", () => {
  for (const message of ["socket hang up", "ECONNRESET", "bridge is restarting", "504 gateway"]) {
    it(`repeats: ${message}`, () => {
      expect(isWorthRetrying(new Error(message))).toBe(true);
    });
  }

  for (const message of [
    "bridge rejected the token — check the token setting.",
    "413 too large",
    "404 not found",
    "the uploaded bytes do not match the declared hash"
  ]) {
    it(`does not repeat: ${message}`, () => {
      expect(isWorthRetrying(new Error(message))).toBe(false);
    });
  }
});

describe("isWorthRetrying, an answer from the bridge", () => {
  const answer = (status: number, code = "", message = "the web host error — SFTP failed.") =>
    Object.assign(new Error(message), { status, code });

  for (const status of [502, 503, 504]) {
    it(`repeats ${status}, however it is worded`, () => {
      expect(isWorthRetrying(answer(status, "sftp_error"))).toBe(true);
    });
  }

  it("repeats a hash mismatch, which is a truncated upload", () => {
    expect(isWorthRetrying(answer(400, "hash_mismatch", "bytes do not match"))).toBe(true);
  });

  for (const status of [400, 401, 404, 409, 413, 429, 500]) {
    it(`does not repeat ${status}, even when the wording sounds passing`, () => {
      expect(isWorthRetrying(answer(status, "", "bridge is busy, network trouble"))).toBe(false);
    });
  }
});

describe("backoffMs", () => {
  it("grows with each attempt", () => {
    const first = backoffMs(1, 100, () => 0.5);
    const second = backoffMs(2, 100, () => 0.5);
    expect(second).toBeGreaterThan(first);
  });

  it("spreads retries rather than sending them together", () => {
    expect(backoffMs(1, 100, () => 0)).not.toBe(backoffMs(1, 100, () => 1));
  });
});
