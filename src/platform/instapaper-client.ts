/**
 * The wire to Instapaper's API. What to ask and what the answer means are
 * decided in `instapaper-request`; this only sends and bounds the wait.
 */
import { requestUrl } from "obsidian";
import { t } from "../i18n";
import { withTimeout } from "../utils/with-timeout";
import {
  INSTAPAPER_TIMEOUT_MS,
  interpretHighlightsResponse,
  interpretListResponse,
  planHighlightsRequest,
  planListRequest,
  type HighlightsOutcome,
  type InstapaperRequest,
  type InstapaperResponse,
  type ListOutcome,
  type ListRequestInput
} from "../services/instapaper-request";

export async function fetchBookmarks(input: ListRequestInput): Promise<ListOutcome> {
  const response = await send(planListRequest(input));
  return "message" in response ? response : interpretListResponse(response);
}

export async function fetchHighlights(
  bookmarkId: number,
  token: string
): Promise<HighlightsOutcome> {
  const response = await send(planHighlightsRequest(bookmarkId, token));
  return "message" in response ? response : interpretHighlightsResponse(response);
}

async function send(
  request: InstapaperRequest
): Promise<InstapaperResponse | { ok: false; message: string }> {
  try {
    const response = await withTimeout(
      requestUrl({ url: request.url, method: "GET", headers: request.headers, throw: false }),
      INSTAPAPER_TIMEOUT_MS,
      (seconds) => t().reading.timeout(seconds)
    );
    return { status: response.status, headers: response.headers, text: response.text };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : t().reading.networkError };
  }
}
