import { t } from "../i18n";

/** The subset of Obsidian's `app.secretStorage` this plugin depends on. */
export interface SecretStore {
  getSecret(name: string): string | null | undefined;
}

export type ApiKeyResult = { ok: true; apiKey: string } | { ok: false; message: string };

/**
 * Resolve a configured secret from Obsidian's secret storage, returning a
 * user-facing message instead of throwing when it is missing. Shared by the
 * LLM-backed commands and the mail bridge so the "not selected / not found"
 * handling stays in one place.
 *
 * `label` names the secret in those messages — with several secrets in play,
 * "no secret selected" would not tell the user which one to go and set.
 */
export function resolveApiKey(
  store: SecretStore,
  secretName: string,
  label: string = t().secrets.apiKey
): ApiKeyResult {
  if (!secretName) {
    return { ok: false, message: t().common.notice(t().secrets.notSelected(label)) };
  }

  const apiKey = store.getSecret(secretName);
  if (!apiKey) {
    return { ok: false, message: t().common.notice(t().secrets.notFound(label)) };
  }

  return { ok: true, apiKey };
}

/**
 * Whether the AI can be asked at all: a key is chosen and Obsidian's secret
 * storage holds something under it. Not whether the key works — that is the
 * provider's to say when it is asked — but without one nothing the AI does
 * can happen, so every surface offering it asks this first and offers
 * nothing rather than a refusal. One place, so the commands, the menus, the
 * picture bar and the review panel cannot disagree about it.
 */
export function hasApiKey(store: SecretStore | null | undefined, secretName: string): boolean {
  if (!store || !secretName) return false;
  const key = store.getSecret(secretName);
  return typeof key === "string" && key.trim() !== "";
}
