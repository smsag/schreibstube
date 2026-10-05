import { describe, expect, it } from "vitest";
import {
  createRateLimit,
  failureCodes,
  MAX_FROM_ALLOWED,
  parseFromAllowed,
  senderAllowed
} from "./mail-policy.mjs";

describe("parseFromAllowed", () => {
  it("allows the account's own address and nothing else when unset", () => {
    const allowed = parseFromAllowed(undefined, "Post@Example.com");
    expect(senderAllowed("post@example.com", allowed)).toBe(true);
    expect(senderAllowed("andere@example.com", allowed)).toBe(false);
    expect(senderAllowed("ceo@bank.example", allowed)).toBe(false);
  });

  it("adds addresses and whole domains, compared without regard to case", () => {
    const allowed = parseFromAllowed(" buero@example.org , @Team.Example.de,,", "post@example.com");
    expect(senderAllowed("BUERO@example.org", allowed)).toBe(true);
    expect(senderAllowed("wer@team.example.de", allowed)).toBe(true);
    expect(senderAllowed("post@example.com", allowed)).toBe(true);
    expect(senderAllowed("andere@example.org", allowed)).toBe(false);
  });

  it("reads a domain as that domain alone, not its subdomains or a lookalike", () => {
    const allowed = parseFromAllowed("@example.de", "post@example.com");
    expect(senderAllowed("a@example.de", allowed)).toBe(true);
    expect(senderAllowed("a@mail.example.de", allowed)).toBe(false);
    expect(senderAllowed("a@badexample.de", allowed)).toBe(false);
  });

  it("refuses at startup what is neither a bare address nor a domain, naming it", () => {
    expect(() => parseFromAllowed("Büro <buero@example.org>", "p@example.com")).toThrow(
      /"Büro <buero@example.org>" is neither/
    );
    expect(() => parseFromAllowed("niemand", "p@example.com")).toThrow(/"niemand" is neither/);
    expect(() => parseFromAllowed("@*.example.de", "p@example.com")).toThrow(/is not a domain/);
    expect(() => parseFromAllowed("@", "p@example.com")).toThrow(/is not a domain/);
    expect(() => parseFromAllowed("@localhost", "p@example.com")).toThrow(/is not a domain/);
  });

  it("refuses a list longer than any mailbox has aliases", () => {
    const many = Array.from({ length: MAX_FROM_ALLOWED + 1 }, (_, i) => `a${i}@example.de`);
    expect(() => parseFromAllowed(many.join(","), "p@example.com")).toThrow(/more than 100/);
  });
});

describe("createRateLimit", () => {
  function limiter(limit = 2) {
    let time = 0;
    return {
      gate: createRateLimit({ limit, windowMs: 3_600_000, now: () => time }),
      advance: (ms) => {
        time += ms;
      }
    };
  }

  it("allows the budget and refuses the next, saying how long to wait", () => {
    const { gate, advance } = limiter();
    expect(gate.take()).toEqual({ allowed: true });
    advance(60_000);
    expect(gate.take()).toEqual({ allowed: true });
    expect(gate.take()).toEqual({ allowed: false, retryAfterSeconds: 3540 });
  });

  it("frees one event when the oldest leaves the window", () => {
    const { gate, advance } = limiter();
    gate.take();
    advance(60_000);
    gate.take();
    advance(3_540_001);
    expect(gate.take().allowed).toBe(true);
    expect(gate.take().allowed).toBe(false);
  });

  it("does not count a refusal against the budget", () => {
    const { gate, advance } = limiter(1);
    gate.take();
    for (let i = 0; i < 100; i += 1) gate.take();
    advance(3_600_001);
    expect(gate.take().allowed).toBe(true);
  });
});

describe("failureCodes", () => {
  it("names a failure by its codes and never by its words, which quote the recipients", () => {
    const err = Object.assign(
      new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <kunde@example.com>"),
      { code: "EENVELOPE", responseCode: 550 }
    );
    const said = failureCodes(err);
    expect(said).toBe("EENVELOPE 550 Error");
    expect(said).not.toContain("@");
  });

  it("drops a code that is itself text someone could write", () => {
    expect(failureCodes({ code: "550 <kunde@example.com>", name: "Error" })).toBe("Error");
    expect(failureCodes(null)).toBe("no code");
    expect(failureCodes(undefined)).toBe("no code");
  });
});
