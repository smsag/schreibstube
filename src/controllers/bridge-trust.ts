import type { App } from "obsidian";
import { t } from "../i18n";
import { BRIDGE_ORIGIN_KEYS, decideOrigin, type BridgeCapability } from "../services/bridge-origin";
import { askToSendToken } from "../ui/bridge-origin-modal";

/** The device's own storage: Obsidian keeps it per vault and per device, unsynced. */
type DeviceStorage = Partial<Pick<App, "loadLocalStorage" | "saveLocalStorage">>;

/**
 * Whether the token of `capability` may go to the bridge at `url` from this
 * device: at once to the origin it went to before, after a confirmation to
 * any other, which is then remembered. Without device storage every send is
 * confirmed, since nothing can be remembered that a synced vault cannot change.
 */
export async function confirmBridge(
  app: App,
  capability: BridgeCapability,
  url: string,
  ask: typeof askToSendToken = askToSendToken
): Promise<boolean> {
  const storage = app as DeviceStorage;
  const key = BRIDGE_ORIGIN_KEYS[capability];
  let remembered: unknown = null;
  try {
    remembered = storage.loadLocalStorage?.(key) ?? null;
  } catch {
    // Unreadable is the same as never sent.
  }

  const decision = decideOrigin(remembered, url);
  if (decision.kind === "send") return true;
  if (decision.kind === "refuse") return false;

  const name = t().bridgeTrust[capability];
  const confirmed = await ask(app, {
    title: decision.previous ? t().bridgeTrust.titleChanged : t().bridgeTrust.titleNew,
    message: decision.previous
      ? t().bridgeTrust.messageChanged(name, decision.origin, decision.previous)
      : t().bridgeTrust.messageNew(name, decision.origin)
  });
  if (!confirmed) return false;
  try {
    storage.saveLocalStorage?.(key, decision.origin);
  } catch {
    // Not remembered: the next send asks again, which is the safe way round.
  }
  return true;
}
