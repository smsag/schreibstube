/**
 * Fetches a bound note's source.
 *
 * Conditional requests carry the validator from the last fetch, so an unchanged
 * document costs one small round trip and no body at all. That keeps the
 * on-open check cheap enough to run every time a mirror is opened, and keeps
 * unauthenticated rate limits comfortable.
 *
 * What to ask for and what the answer means are decided in `sync-request`;
 * this is the wire between that and the platform.
 */

import { requestUrl } from "obsidian";
import { t } from "../i18n";
import { withTimeout } from "../utils/with-timeout";
import {
  interpretSourceResponse,
  planSourceRequest,
  REQUEST_TIMEOUT_MS,
  type FetchOptions,
  type FetchOutcome
} from "./sync-request";

export { MAX_SOURCE_BYTES, type FetchOptions, type FetchOutcome } from "./sync-request";

export async function fetchSource(options: FetchOptions): Promise<FetchOutcome> {
  const request = planSourceRequest(options);

  let response: Awaited<ReturnType<typeof requestUrl>>;
  try {
    response = await withTimeout(
      requestUrl({ url: request.url, method: "GET", headers: request.headers, throw: false }),
      REQUEST_TIMEOUT_MS,
      (seconds) => t().source.timeout(seconds)
    );
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : t().source.networkError
    };
  }

  return interpretSourceResponse(options, request, {
    status: response.status,
    headers: response.headers,
    text: response.text
  });
}
