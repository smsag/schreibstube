import { describe, expect, it } from "vitest";
import { mapLimit } from "./pool.mjs";

/** A bounded parallel map: order kept, limit held, failures reported whole. */

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapLimit", () => {
  it("returns results in the order of the items, not of completion", async () => {
    const result = await mapLimit([30, 5, 15], 3, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(result).toEqual([30, 5, 15]);
  });

  it("never has more than the limit in flight", async () => {
    let running = 0;
    let most = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        running += 1;
        most = Math.max(most, running);
        await tick(2);
        running -= 1;
      }
    );
    expect(most).toBe(4);
  });

  it("does nothing for no items", async () => {
    expect(await mapLimit([], 6, async () => 1)).toEqual([]);
  });

  it("rejects with the first failure after the requests in flight have settled", async () => {
    const settled = [];
    const work = mapLimit([1, 2, 3], 3, async (n) => {
      await tick(n === 1 ? 1 : 10);
      if (n === 1) throw new Error("eins");
      settled.push(n);
    });
    await expect(work).rejects.toThrow("eins");
    expect(settled.sort()).toEqual([2, 3]);
  });

  it("starts no new item once one has failed", async () => {
    const started = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("zwei");
      })
    ).rejects.toThrow("zwei");
    expect(started).toEqual([1, 2]);
  });
});
