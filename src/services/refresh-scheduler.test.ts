import { describe, expect, it } from "vitest";
import { RefreshScheduler } from "./refresh-scheduler";

describe("RefreshScheduler", () => {
  it("coalesces multiple enqueue calls into one frame", () => {
    const callbacks: Array<() => void> = [];
    const flushed: Array<{ viewportTopLine?: number; readingScrollTop?: number }> = [];

    const scheduler = new RefreshScheduler(
      (cb) => callbacks.push(cb),
      ({ viewportTopLine, options }) => {
        flushed.push({
          viewportTopLine,
          readingScrollTop: options?.readingScrollTop
        });
      }
    );

    scheduler.enqueue(10);
    scheduler.enqueue(20, { readingScrollTop: 120 });
    scheduler.enqueue(30, { readingScrollTop: 240 });

    expect(callbacks).toHaveLength(1);
    expect(flushed).toHaveLength(0);

    callbacks[0]();

    expect(flushed).toEqual([
      { viewportTopLine: 30, readingScrollTop: 240 }
    ]);
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

    scheduler.enqueue(5);
    callbacks[0]();

    scheduler.enqueue(15);
    expect(callbacks).toHaveLength(2);

    callbacks[1]();

    expect(flushCount).toBe(2);
  });
});
