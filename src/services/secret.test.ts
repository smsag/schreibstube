import { describe, expect, it } from "vitest";
import { resolveApiKey, type SecretStore } from "./secret";

function store(map: Record<string, string>): SecretStore {
  return { getSecret: (name) => map[name] ?? null };
}

describe("resolveApiKey", () => {
  it("returns the key when the secret exists", () => {
    const result = resolveApiKey(store({ "my-key": "sk-123" }), "my-key");
    expect(result).toEqual({ ok: true, apiKey: "sk-123" });
  });

  it("fails with a 'no secret selected' message when the name is empty", () => {
    const result = resolveApiKey(store({}), "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/no secret selected/i);
    }
  });

  it("fails with a 'not found' message when the secret is missing", () => {
    const result = resolveApiKey(store({}), "absent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not found/i);
    }
  });

  it("treats an empty stored value as missing", () => {
    const result = resolveApiKey(store({ "my-key": "" }), "my-key");
    expect(result.ok).toBe(false);
  });
});
