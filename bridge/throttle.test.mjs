import { describe, expect, it } from "vitest";
import { createThrottle } from "./throttle.mjs";

/** A clock the test moves by hand, so nothing waits. */
function clock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    }
  };
}

function throttle(overrides = {}) {
  const time = clock();
  return {
    time,
    gate: createThrottle({ limit: 3, windowMs: 60_000, now: time.now, ...overrides })
  };
}

describe("createThrottle", () => {
  it("allows an address that has never failed", () => {
    expect(throttle().gate.check("1.2.3.4")).toEqual({ allowed: true });
  });

  it("allows failures up to the limit", () => {
    const { gate } = throttle();
    gate.recordFailure("1.2.3.4");
    gate.recordFailure("1.2.3.4");
    expect(gate.check("1.2.3.4").allowed).toBe(true);
  });

  it("blocks once the limit is reached", () => {
    const { gate } = throttle();
    for (let i = 0; i < 3; i += 1) gate.recordFailure("1.2.3.4");
    expect(gate.check("1.2.3.4").allowed).toBe(false);
  });

  it("says how long the caller must wait", () => {
    const { gate, time } = throttle();
    for (let i = 0; i < 3; i += 1) gate.recordFailure("1.2.3.4");
    time.advance(20_000);
    expect(gate.check("1.2.3.4").retryAfterSeconds).toBe(40);
  });

  it("never reports less than a second to wait", () => {
    const { gate, time } = throttle();
    for (let i = 0; i < 3; i += 1) gate.recordFailure("1.2.3.4");
    time.advance(59_999);
    expect(gate.check("1.2.3.4").retryAfterSeconds).toBe(1);
  });

  it("forgets failures once the window has passed", () => {
    const { gate, time } = throttle();
    for (let i = 0; i < 3; i += 1) gate.recordFailure("1.2.3.4");
    time.advance(60_001);
    expect(gate.check("1.2.3.4").allowed).toBe(true);
  });

  it("counts only the failures inside the window", () => {
    const { gate, time } = throttle();
    gate.recordFailure("1.2.3.4");
    time.advance(60_001);
    gate.recordFailure("1.2.3.4");
    gate.recordFailure("1.2.3.4");
    expect(gate.check("1.2.3.4").allowed).toBe(true);
  });

  it("keeps addresses apart", () => {
    const { gate } = throttle();
    for (let i = 0; i < 3; i += 1) gate.recordFailure("1.2.3.4");
    expect(gate.check("5.6.7.8").allowed).toBe(true);
  });

  it("clears the record when the caller proves it holds a token", () => {
    const { gate } = throttle();
    for (let i = 0; i < 3; i += 1) gate.recordFailure("1.2.3.4");
    gate.recordSuccess("1.2.3.4");
    expect(gate.check("1.2.3.4").allowed).toBe(true);
  });

  it("does not grow without bound as entries expire", () => {
    const { gate, time } = throttle();
    gate.recordFailure("1.2.3.4");
    expect(gate.size).toBe(1);
    time.advance(60_001);
    gate.check("1.2.3.4");
    expect(gate.size).toBe(0);
  });
});
