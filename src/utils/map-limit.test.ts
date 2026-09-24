import { describe, expect, it } from "vitest";
import { mapLimit } from "./map-limit";

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapLimit", () => {
  it("keeps the order of the items, not of completion", async () => {
    const result = await mapLimit([20, 1, 8], 3, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(result).toEqual([20, 1, 8]);
  });

  it("never has more than the limit in flight", async () => {
    let running = 0;
    let most = 0;
    await mapLimit(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async () => {
        running += 1;
        most = Math.max(most, running);
        await tick(2);
        running -= 1;
      }
    );
    expect(most).toBe(3);
  });

  it("does nothing for no items", async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  });

  it("reports the first failure after the rest in flight have settled", async () => {
    const settled: number[] = [];
    const work = mapLimit([1, 2, 3], 3, async (n) => {
      await tick(n === 1 ? 1 : 8);
      if (n === 1) throw new Error("eins");
      settled.push(n);
    });
    await expect(work).rejects.toThrow("eins");
    expect(settled.sort()).toEqual([2, 3]);
  });

  it("starts nothing new once one has failed", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("zwei");
      })
    ).rejects.toThrow("zwei");
    expect(started).toEqual([1, 2]);
  });
});
