import { requestUrl } from "obsidian";
import { withTimeout } from "../utils/with-timeout";
import { BridgeError, authHeaders, buildEndpoint, extractCode } from "./bridge-protocol";
import {
  MAIL_REQUEST_TIMEOUT_MS,
  describeBridgeError,
  parseSearchResult,
  parseSendResult,
  type MailBridgeConfig,
  type SearchRequest,
  type SearchResult,
  type SendRequest,
  type SendResult
} from "./mail-protocol";

/**
 * Transport for the mail bridge.
 *
 * Uses Obsidian's `requestUrl`, which runs outside the renderer's CORS sandbox
 * and behaves identically on desktop and mobile. That is the whole reason the
 * bridge exists: mobile has no Node runtime and no raw sockets, so IMAP and
 * SMTP have to be reached over HTTPS.
 */

export async function sendMail(
  config: MailBridgeConfig,
  request: SendRequest
): Promise<SendResult> {
  return parseSendResult(await postJson(config, "/send", request));
}

export async function searchMail(
  config: MailBridgeConfig,
  request: SearchRequest
): Promise<SearchResult> {
  return parseSearchResult(await postJson(config, "/search", request));
}

async function postJson(config: MailBridgeConfig, path: string, body: unknown): Promise<unknown> {
  const response = await withTimeout(
    requestUrl({
      url: buildEndpoint(config.baseUrl, path),
      method: "POST",
      headers: authHeaders(config.token),
      body: JSON.stringify(body),
      throw: false
    }),
    MAIL_REQUEST_TIMEOUT_MS,
    (seconds) => `bridge did not respond within ${seconds}s.`
  );

  if (response.status < 200 || response.status >= 300) {
    throw new BridgeError(
      describeBridgeError(response.status, response.text),
      response.status,
      extractCode(response.text)
    );
  }

  return response.json;
}
