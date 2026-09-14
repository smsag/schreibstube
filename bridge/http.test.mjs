import { describe, expect, it } from "vitest";
import { clientAddress, parseJson } from "./http.mjs";

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
