import { describe, expect, it } from "vitest";
import { closesFence, fencedLines, fenceMarker } from "./markdown-fence";

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

describe("an inline code span is no fence", () => {
  it("refuses a backtick run whose info string holds a backtick", () => {
    expect(fenceMarker("```inline``` code")).toBeNull();
    expect(fencedLines(["```a``` b", "# heading"])).toEqual([false, false]);
  });

  it("still opens a tilde fence whose info string holds one", () => {
    expect(fenceMarker("~~~ `x`")).toBe("~~~");
  });
});

describe("closesFence", () => {
  it("closes on a bare run of the same character, at least as long", () => {
    expect(closesFence("```", "```")).toBe(true);
    expect(closesFence("  ````  ", "```")).toBe(true);
    expect(closesFence("```\r", "```")).toBe(true);
    expect(closesFence("``", "```")).toBe(false);
    expect(closesFence("~~~", "```")).toBe(false);
  });

  it("does not close on a line that names a language", () => {
    expect(closesFence("```js", "```")).toBe(false);
    expect(fencedLines(["```md", "```js", "# inside", "```", "after"])).toEqual([
      true,
      true,
      true,
      true,
      false
    ]);
  });
});
