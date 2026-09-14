import { describe, expect, it } from "vitest";
import { fencedLines, fenceMarker } from "./markdown-fence";

describe("fenceMarker", () => {
  it("recognises backtick and tilde fences of three or more", () => {
    expect(fenceMarker("```")).toBe("```");
    expect(fenceMarker("````ts")).toBe("````");
    expect(fenceMarker("  ~~~")).toBe("~~~");
  });

  it("ignores shorter runs and prose", () => {
    expect(fenceMarker("``")).toBeNull();
    expect(fenceMarker("a ``` b")).toBeNull();
  });
});

describe("fencedLines", () => {
  it("counts the fence lines as inside the block", () => {
    expect(fencedLines(["a", "```", "# not a heading", "```", "b"])).toEqual([
      false,
      true,
      true,
      true,
      false
    ]);
  });

  it("lets a longer fence quote a shorter one", () => {
    expect(fencedLines(["````", "```", "x", "```", "````", "y"])).toEqual([
      true,
      true,
      true,
      true,
      true,
      false
    ]);
  });

  it("does not close a backtick fence with tildes", () => {
    expect(fencedLines(["```", "~~~", "x"])).toEqual([true, true, true]);
  });

  it("keeps an unclosed fence open to the end", () => {
    expect(fencedLines(["```", "x", "y"])).toEqual([true, true, true]);
  });
});
