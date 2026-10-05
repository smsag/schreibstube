import { describe, expect, it } from "vitest";
import {
  BRIDGE_ORIGIN_KEYS,
  decideOrigin,
  MAX_ORIGIN_LENGTH,
  originOf,
  rememberedOrigin
} from "./bridge-origin";

describe("originOf", () => {
  it("reduces a bridge URL to scheme, host and port", () => {
    expect(originOf("https://bridge.example.app/base/")).toBe("https://bridge.example.app");
    expect(originOf("https://Bridge.Example.App:8443")).toBe("https://bridge.example.app:8443");
    expect(originOf("http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("has none for what is not a web address", () => {
    for (const url of ["", "bridge.example.app", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(originOf(url)).toBeNull();
    }
  });
});

describe("rememberedOrigin", () => {
  it("takes back only an origin, exactly as it was stored", () => {
    expect(rememberedOrigin("https://bridge.example.app")).toBe("https://bridge.example.app");
    for (const raw of [
      null,
      42,
      { origin: "https://x" },
      "https://bridge.example.app/",
      "https://BRIDGE.example.app",
      `https://${"a".repeat(MAX_ORIGIN_LENGTH)}.app`
    ]) {
      expect(rememberedOrigin(raw)).toBeNull();
    }
  });
});

describe("decideOrigin", () => {
  it("sends to the origin the token went to before, whatever the path", () => {
    expect(decideOrigin("https://bridge.example.app", "https://bridge.example.app/v2")).toEqual({
      kind: "send"
    });
  });

  it("asks before the first send from this device", () => {
    expect(decideOrigin(null, "https://bridge.example.app")).toEqual({
      kind: "confirm",
      origin: "https://bridge.example.app",
      previous: null
    });
  });

  it("asks when the synced settings name another origin, naming both", () => {
    expect(decideOrigin("https://bridge.example.app", "https://evil.example.com")).toEqual({
      kind: "confirm",
      origin: "https://evil.example.com",
      previous: "https://bridge.example.app"
    });
    // A port or a scheme is another origin too.
    expect(decideOrigin("https://bridge.example.app", "https://bridge.example.app:444").kind).toBe(
      "confirm"
    );
  });

  it("refuses an address that has no origin to send to", () => {
    expect(decideOrigin("https://bridge.example.app", "not a url")).toEqual({ kind: "refuse" });
  });

  it("keeps mail and publishing apart", () => {
    expect(BRIDGE_ORIGIN_KEYS.mail).not.toBe(BRIDGE_ORIGIN_KEYS.publish);
  });
});
