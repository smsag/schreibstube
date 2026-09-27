import { describe, expect, it } from "vitest";
import { TaskQueue } from "./task-queue";

describe("TaskQueue", () => {
  it("runs one task at a time, in order", async () => {
    const queue = new TaskQueue();
    const log: string[] = [];
    let running = 0;
    const task = (name: string) => async () => {
      running++;
      expect(running).toBe(1);
      await Promise.resolve();
      log.push(name);
      running--;
      return name;
    };
    const results = await Promise.all([
      queue.run(task("a")),
      queue.run(task("b")),
      queue.run(task("c"))
    ]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["a", "b", "c"]);
  });

  it("lets a search go ahead of the batches waiting, not the one running", async () => {
    const queue = new TaskQueue();
    const log: string[] = [];
    let release: () => void = () => undefined;
    const first = queue.run(async () => {
      await new Promise<void>((r) => (release = r));
      log.push("batch 1");
    });
    const second = queue.run(async () => void log.push("batch 2"));
    const third = queue.run(async () => void log.push("batch 3"));
    const search = queue.run(async () => void log.push("search"), true);
    expect(queue.waiting).toBe(3);
    release();
    await Promise.all([first, second, third, search]);
    expect(log).toEqual(["batch 1", "search", "batch 2", "batch 3"]);
  });

  it("passes a failure to its own caller and carries on", async () => {
    const queue = new TaskQueue();
    const bad = queue.run(async () => {
      throw new Error("boom");
    });
    const good = queue.run(async () => "ok");
    await expect(bad).rejects.toThrow("boom");
    await expect(good).resolves.toBe("ok");
  });
});
