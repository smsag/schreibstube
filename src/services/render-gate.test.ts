import { describe, expect, it } from "vitest";
import { RenderGate } from "./render-gate";

describe("RenderGate", () => {
  it("draws straight away when no tap is in progress", () => {
    const g = new RenderGate<string>();
    expect(g.request("a")).toBe("a");
    expect(g.holding).toBe(false);
  });

  it("holds a redraw for the length of a tap, and draws it after", () => {
    const g = new RenderGate<string>();
    g.hold();
    expect(g.request("a")).toBeNull();
    expect(g.holding).toBe(true);
    expect(g.release()).toBe("a");
    expect(g.holding).toBe(false);
  });

  it("keeps only the last state — a redraw paints the current one", () => {
    const g = new RenderGate<string>();
    g.hold();
    g.request("a");
    g.request("b");
    expect(g.release()).toBe("b");
  });

  it("has nothing to draw when the tap changed nothing", () => {
    const g = new RenderGate<string>();
    g.hold();
    expect(g.release()).toBeNull();
  });

  it("survives a release it never held — the gate can never stick shut", () => {
    // Both the click and the fallback timer release it, and a pointer can go
    // down outside the panel and come up inside it.
    const g = new RenderGate<string>();
    expect(g.release()).toBeNull();
    g.hold();
    g.request("a");
    expect(g.release()).toBe("a");
    expect(g.release()).toBeNull();
    expect(g.request("b")).toBe("b");
  });

  it("re-holding does not lose the state already held", () => {
    const g = new RenderGate<string>();
    g.hold();
    g.request("a");
    g.hold();
    expect(g.release()).toBe("a");
  });
});
