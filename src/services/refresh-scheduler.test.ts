import { describe, expect, it } from "vitest";
import { RefreshScheduler, type RefreshPayload } from "./refresh-scheduler";

describe("RefreshScheduler", () => {
  it("coalesces multiple enqueue calls into one frame, with the latest measurement", () => {
    const callbacks: Array<() => void> = [];
    const flushed: RefreshPayload[] = [];

    const scheduler = new RefreshScheduler(
      (cb) => callbacks.push(cb),
      (payload) => flushed.push(payload)
    );

    scheduler.enqueue([10, 11]);
    scheduler.enqueue([20, 22]);
    scheduler.enqueue([30, 32]);

    expect(callbacks).toHaveLength(1);
    expect(flushed).toHaveLength(0);

    callbacks[0]?.();

    expect(flushed).toEqual([{ edgeLines: [30, 32] }]);
  });

  it("keeps a measurement when a plain refresh follows it in the same frame", () => {
    const callbacks: Array<() => void> = [];
    const flushed: RefreshPayload[] = [];
    const scheduler = new RefreshScheduler(
      (cb) => callbacks.push(cb),
      (payload) => flushed.push(payload)
    );

    scheduler.enqueue([7, 9]);
    scheduler.enqueue();
    callbacks[0]?.();

    expect(flushed).toEqual([{ edgeLines: [7, 9] }]);
  });

  it("schedules another frame after previous flush", () => {
    const callbacks: Array<() => void> = [];
    let flushCount = 0;

    const scheduler = new RefreshScheduler(
      (cb) => callbacks.push(cb),
      () => {
        flushCount += 1;
      }
    );

    scheduler.enqueue([5, 6]);
    callbacks[0]?.();

    scheduler.enqueue([15, 16]);
    expect(callbacks).toHaveLength(2);

    callbacks[1]?.();

    expect(flushCount).toBe(2);
  });
});
