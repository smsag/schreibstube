import { describe, expect, it } from "vitest";
import { isOpenTask, taskState } from "./task-state";

describe("taskState", () => {
  it("takes Markdown's own done box, either case, for done", () => {
    for (const marker of ["x", "X"]) expect(taskState(marker)).toBe("done");
  });

  it("reads the dash as cancelled, not done", () => {
    expect(taskState("-")).toBe("cancelled");
  });

  it("reads the slash as work in progress", () => {
    expect(taskState("/")).toBe("progress");
  });

  it("takes a space and every other extension's flag for open", () => {
    for (const marker of [" ", ">", "?", "!", "~", "*", "o"]) {
      expect(taskState(marker)).toBe("open");
    }
  });

  it("counts anything neither done nor cancelled as open work", () => {
    expect(isOpenTask(" ")).toBe(true);
    expect(isOpenTask("/")).toBe(true);
    expect(isOpenTask(">")).toBe(true);
    expect(isOpenTask("x")).toBe(false);
    expect(isOpenTask("-")).toBe(false);
  });
});
