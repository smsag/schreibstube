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

  it("fails with a 'not selected' message when the name is empty", () => {
    const result = resolveApiKey(store({}), "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/no API key selected/i);
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

  it("names the secret in both failure messages, so the user knows which to set", () => {
    const notSelected = resolveApiKey(store({}), "", "bridge token");
    const notFound = resolveApiKey(store({}), "absent", "bridge token");

    expect(notSelected.ok).toBe(false);
    expect(notFound.ok).toBe(false);
    if (!notSelected.ok) {
      expect(notSelected.message).toBe(
        "Schreibstube: no bridge token selected — open Settings to choose one."
      );
    }
    if (!notFound.ok) {
      expect(notFound.message).toBe("Schreibstube: bridge token not found — check Settings.");
    }
  });
});
