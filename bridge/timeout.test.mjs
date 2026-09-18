import { describe, expect, it } from "vitest";
import { TimeoutError, withDeadline } from "./timeout.mjs";

const never = () => new Promise(() => {});

describe("withDeadline", () => {
  it("passes a value through when the work finishes in time", async () => {
    await expect(withDeadline(Promise.resolve("fertig"), 1000, "Work")).resolves.toBe("fertig");
  });

  it("passes a rejection through unchanged", async () => {
    await expect(withDeadline(Promise.reject(new Error("kaputt")), 1000, "Work")).rejects.toThrow(
      "kaputt"
    );
  });

  it("rejects with a timeout when the work does not finish", async () => {
    await expect(withDeadline(never(), 10, "Search")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("names the operation and the budget, since the caller cannot see either", () => {
    expect(new TimeoutError("Search", 2000).message).toBe("Search timed out after 2s");
  });

  it("clears its timer, so a finished call cannot hold the process open", async () => {
    const before = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    await withDeadline(Promise.resolve(1), 60_000, "Work");
    const after = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    expect(after).toBeLessThanOrEqual(before);
  });
});
