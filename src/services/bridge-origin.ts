/**
 * Which bridge a device has sent its token to.
 *
 * The bridge URL lives in `data.json`, which syncs with the vault; the token
 * lives in the device's secret storage, which does not. Anyone who can edit a
 * shared vault could therefore point the URL at a server of their own, and
 * every device would hand that server its token on the next publish or mail.
 * So each device remembers, in storage that is not synced, the origin it last
 * sent each token to, and a different one is confirmed by the person at the
 * device before the token goes there.
 */

export type BridgeCapability = "mail" | "publish";

/** Where the remembered origin is kept, per capability, in the device's own storage. */
export const BRIDGE_ORIGIN_KEYS: Readonly<Record<BridgeCapability, string>> = {
  mail: "schreibstube-mail-bridge-origin",
  publish: "schreibstube-publish-bridge-origin"
};

/** Longer than any origin a person types; a stored value past it is not one. */
export const MAX_ORIGIN_LENGTH = 512;

/** The origin of a bridge URL — scheme, host and port — or null for anything else. */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin.length <= MAX_ORIGIN_LENGTH ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** A remembered origin as read back from storage, or null when it is not one. */
export function rememberedOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_ORIGIN_LENGTH) return null;
  return originOf(raw) === raw ? raw : null;
}

export type OriginDecision =
  | { kind: "send" }
  | { kind: "confirm"; origin: string; previous: string | null }
  | { kind: "refuse" };

/**
 * Whether a token may go to `url` as it is: only to the origin this device
 * sent it to before. Any other — the first, or a changed one — is asked
 * about, with the previous origin to compare.
 */
export function decideOrigin(remembered: unknown, url: string): OriginDecision {
  const origin = originOf(url);
  if (!origin) return { kind: "refuse" };
  const previous = rememberedOrigin(remembered);
  if (previous === origin) return { kind: "send" };
  return { kind: "confirm", origin, previous };
}
