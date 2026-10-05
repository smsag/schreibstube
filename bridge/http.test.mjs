import { describe, expect, it } from "vitest";
import {
  clientAddress,
  hasForwardedFor,
  MAX_THROTTLE_KEY_CHARS,
  parseJson,
  readBody,
  throttleKey
} from "./http.mjs";

function request(headers = {}, remoteAddress = "192.0.2.1") {
  return { headers, socket: { remoteAddress } };
}

describe("clientAddress", () => {
  it("is the socket address when the proxy is not trusted, whatever the header says", () => {
    const req = request({ "x-forwarded-for": "203.0.113.9" });
    expect(clientAddress(req)).toBe("192.0.2.1");
    expect(clientAddress(req, { trustProxy: false })).toBe("192.0.2.1");
  });

  it("is the last forwarded hop when the proxy is trusted", () => {
    const req = request({ "x-forwarded-for": "203.0.113.9, 198.51.100.4 " });
    expect(clientAddress(req, { trustProxy: true })).toBe("198.51.100.4");
  });

  it("falls back to the socket when a trusted proxy sent no header", () => {
    expect(clientAddress(request({}), { trustProxy: true })).toBe("192.0.2.1");
    expect(clientAddress(request({ "x-forwarded-for": " , " }), { trustProxy: true })).toBe(
      "192.0.2.1"
    );
  });

  it("copes with a socket that is already gone", () => {
    expect(clientAddress({ headers: {} })).toBe("unknown");
  });

  it("takes the address the outermost of several trusted proxies saw", () => {
    const req = request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 198.51.100.4" });
    expect(clientAddress(req, { hops: 1 })).toBe("198.51.100.4");
    expect(clientAddress(req, { hops: 2 })).toBe("203.0.113.9");
    expect(clientAddress(req, { trustProxy: true, hops: 2 })).toBe("203.0.113.9");
  });

  it("takes the first address of a chain shorter than the proxies, which they appended alone", () => {
    const req = request({ "x-forwarded-for": "203.0.113.9" });
    expect(clientAddress(req, { hops: 3 })).toBe("203.0.113.9");
  });

  it("reads a header sent twice as one chain", () => {
    const req = request({ "x-forwarded-for": ["6.6.6.6", "203.0.113.9"] });
    expect(clientAddress(req, { hops: 1 })).toBe("203.0.113.9");
  });
});

describe("hasForwardedFor", () => {
  it("says whether a forwarded address came along, so an untrusted one can be reported", () => {
    expect(hasForwardedFor(request({ "x-forwarded-for": "203.0.113.9" }))).toBe(true);
    expect(hasForwardedFor(request({ "x-forwarded-for": " , " }))).toBe(false);
    expect(hasForwardedFor(request({}))).toBe(false);
  });
});

describe("throttleKey", () => {
  it("keeps an IPv4 address as it is", () => {
    expect(throttleKey("192.0.2.1")).toBe("192.0.2.1");
  });

  it("reads an IPv4 address a dual-stack socket reports as IPv6 as the IPv4 address", () => {
    expect(throttleKey("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(throttleKey("::FFFF:c000:0201")).toBe("192.0.2.1");
  });

  it("groups an IPv6 address by its /64, which one customer holds whole", () => {
    expect(throttleKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(throttleKey("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(throttleKey("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(throttleKey("[2001:DB8:0:0::1]")).toBe("2001:db8:0:0::/64");
    expect(throttleKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(throttleKey("::1")).toBe("0:0:0:0::/64");
    expect(throttleKey("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
  });

  it("cuts what is not an address to a bound, since a header can say anything", () => {
    expect(throttleKey("x".repeat(10_000))).toHaveLength(MAX_THROTTLE_KEY_CHARS);
    expect(throttleKey("unknown")).toBe("unknown");
    expect(throttleKey("")).toBe("unknown");
    expect(throttleKey(undefined)).toBe("unknown");
  });
});

describe("parseJson", () => {
  it("reads an empty body as an empty object", () => {
    expect(parseJson(Buffer.alloc(0))).toEqual({});
    expect(parseJson(Buffer.from("  \n"))).toEqual({});
  });

  it("refuses anything that is not an object, with a stable code", () => {
    for (const raw of ["[]", "null", '"text"', "42"]) {
      expect(() => parseJson(Buffer.from(raw))).toThrow(
        expect.objectContaining({ status: 400, code: "invalid_request" })
      );
    }
  });

  it("names malformed JSON as such", () => {
    expect(() => parseJson(Buffer.from("{"))).toThrow(
      expect.objectContaining({ status: 400, code: "invalid_json" })
    );
  });
});

describe("readBody", () => {
  it("refuses to read under a limit that is not a number, which is a route without one", () => {
    for (const limit of [undefined, null, "1000", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => readBody({ headers: {}, on() {} }, limit)).toThrow(TypeError);
    }
  });
});
