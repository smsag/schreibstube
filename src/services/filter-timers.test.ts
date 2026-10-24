import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterTimers, timersEndedBy } from "./filter-timers";

const clock = {
  setTimeout: (run: () => void, ms: number) => setTimeout(run, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id)
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("which waits an event ends", () => {
  it("takes the query now for the words alone, leaving meaning and the items waiting", () => {
    expect(timersEndedBy("apply")).toEqual(["filter"]);
  });

  it("ends them all for a keystroke, which starts them again, and for a closed pane", () => {
    expect(timersEndedBy("type")).toEqual(["filter", "meaning", "items"]);
    expect(timersEndedBy("close")).toEqual(["filter", "meaning", "items"]);
  });
});

describe("the filter's waits", () => {
  it("still asks by meaning and for items after the words' shorter pause took the query", () => {
    const timers = new FilterTimers(clock);
    const asked: string[] = [];
    timers.start("meaning", 300, () => asked.push("meaning"));
    timers.start("items", 300, () => asked.push("items"));
    timers.start("filter", 150, () => {
      asked.push("filter");
      timers.end("apply");
    });

    vi.advanceTimersByTime(300);
    expect(asked).toEqual(["filter", "meaning", "items"]);
  });

  it("asks nothing that a keystroke or a closed pane ended", () => {
    const timers = new FilterTimers(clock);
    const asked: string[] = [];
    timers.start("meaning", 300, () => asked.push("meaning"));
    timers.end("type");
    timers.start("items", 300, () => asked.push("items"));
    timers.end("close");

    vi.advanceTimersByTime(1000);
    expect(asked).toEqual([]);
    expect(timers.isPending("meaning")).toBe(false);
  });

  it("keeps one call per wait, the latest", () => {
    const timers = new FilterTimers(clock);
    const asked: string[] = [];
    timers.start("meaning", 300, () => asked.push("first"));
    timers.start("meaning", 300, () => asked.push("second"));

    vi.advanceTimersByTime(300);
    expect(asked).toEqual(["second"]);
    expect(timers.isPending("meaning")).toBe(false);
  });
});
