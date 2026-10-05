import { describe, expect, it } from "vitest";
import { createThrottle, MAX_THROTTLE_KEYS } from "./throttle.mjs";

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

  it("offers no way to clear a record but time, so one token cannot buy guesses at another", () => {
    const { gate } = throttle();
    expect(gate.recordSuccess).toBeUndefined();
    for (let i = 0; i < 3; i += 1) gate.recordFailure("1.2.3.4");
    expect(gate.check("1.2.3.4").allowed).toBe(false);
  });

  it("keeps blocking for as long as the newest failures say, however many there were", () => {
    const { gate, time } = throttle();
    for (let i = 0; i < 10; i += 1) {
      gate.recordFailure("1.2.3.4");
      time.advance(1000);
    }
    // The last three failures were 3, 2 and 1 seconds ago.
    expect(gate.check("1.2.3.4").retryAfterSeconds).toBe(57);
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

describe("what the throttle keeps", () => {
  it("forgets an address whose failures have all aged out", () => {
    let clock = 0;
    const throttle = createThrottle({ limit: 5, windowMs: 1000, now: () => clock });

    // Past the sweep threshold, so the map is walked.
    for (let i = 0; i < 1200; i += 1) throttle.recordFailure(`10.0.0.${i}`);
    expect(throttle.size).toBeGreaterThan(1000);

    clock += 2000;
    throttle.recordFailure("10.9.9.9");
    expect(throttle.size).toBe(1);
  });

  it("does not forget one that is still inside the window", () => {
    let clock = 0;
    const throttle = createThrottle({ limit: 5, windowMs: 10_000, now: () => clock });

    for (let i = 0; i < 1200; i += 1) throttle.recordFailure(`10.0.0.${i}`);
    clock += 1000;
    throttle.recordFailure("10.9.9.9");
    expect(throttle.size).toBe(1201);
  });
});

describe("how often the throttle sweeps", () => {
  it("walks the map at most once per window, however many failures arrive", () => {
    let clock = 0;
    const throttle = createThrottle({ limit: 5, windowMs: 1000, now: () => clock });
    for (let i = 0; i < 1200; i += 1) throttle.recordFailure(`10.0.0.${i}`);
    clock = 500;
    throttle.recordFailure("10.0.5.5");

    // A window since the last sweep: the first batch has aged out and goes.
    clock = 1100;
    for (let i = 0; i < 1200; i += 1) throttle.recordFailure(`10.1.0.${i}`);
    expect(throttle.size).toBe(1201);

    // The straggler has aged out too, but the last sweep is inside the window,
    // so this failure does not walk the map to find it.
    clock = 1600;
    throttle.recordFailure("10.9.9.9");
    expect(throttle.size).toBe(1202);

    clock = 2100;
    throttle.recordFailure("10.9.9.10");
    expect(throttle.size).toBe(2);
  });
});

describe("how much the throttle keeps", () => {
  it("never remembers more addresses than its bound, forgetting the one that failed longest ago", () => {
    const gate = createThrottle({ limit: 2, windowMs: 60_000, now: () => 0, maxKeys: 3 });
    gate.recordFailure("a");
    gate.recordFailure("a");
    gate.recordFailure("b");
    gate.recordFailure("c");
    // "a" fails again, so "b" is now the one that failed longest ago.
    gate.recordFailure("a");
    gate.recordFailure("d");
    expect(gate.size).toBe(3);
    expect(gate.check("a").allowed).toBe(false);
    gate.recordFailure("b");
    expect(gate.check("b").allowed).toBe(true);
  });

  it("holds its default bound against a stranger who picks a new address for every guess", () => {
    const gate = createThrottle({ limit: 5, windowMs: 60_000, now: () => 0 });
    for (let i = 0; i < MAX_THROTTLE_KEYS + 500; i += 1) gate.recordFailure(`key-${i}`);
    expect(gate.size).toBe(MAX_THROTTLE_KEYS);
  });
});
