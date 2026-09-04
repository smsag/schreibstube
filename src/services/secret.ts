/** The subset of Obsidian's `app.secretStorage` this plugin depends on. */
export interface SecretStore {
  getSecret(name: string): string | null | undefined;
}

export type ApiKeyResult =
  | { ok: true; apiKey: string }
  | { ok: false; message: string };

/**
 * Resolve the configured LLM API key from Obsidian's secret storage, returning
 * a user-facing message instead of throwing when it is missing. Shared by every
 * LLM-backed command so the "no secret / secret not found" handling stays in
 * one place.
 */
export function resolveApiKey(store: SecretStore, secretName: string): ApiKeyResult {
  if (!secretName) {
    return {
      ok: false,
      message: "Schreibstube: no secret selected — open Settings to choose one."
    };
  }

  const apiKey = store.getSecret(secretName);
  if (!apiKey) {
    return { ok: false, message: "Schreibstube: secret not found — check Settings." };
  }

  return { ok: true, apiKey };
}
