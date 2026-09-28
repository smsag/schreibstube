/**
 * Fetches the day's exchange rates.
 *
 * What to ask for and what the answer means are decided in `exchange-rates`;
 * this is the wire between that and the platform, bounded in time like every
 * other request the plugin makes.
 */
import { requestUrl } from "obsidian";
import { t } from "../i18n";
import { withTimeout } from "../utils/with-timeout";
import { parseEcbRates, RATES_TIMEOUT_MS, RATES_URL, type ExchangeRates } from "./exchange-rates";

export async function fetchEcbRates(now: number): Promise<ExchangeRates> {
  const response = await withTimeout(
    requestUrl({ url: RATES_URL, method: "GET", throw: false }),
    RATES_TIMEOUT_MS,
    (seconds) => t().sums.ratesTimeout(seconds)
  );
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const rates = parseEcbRates(response.text, now);
  if (!rates) throw new Error(t().sums.ratesUnreadable);
  return rates;
}
