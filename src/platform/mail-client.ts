import { requestUrl } from "obsidian";
import { withTimeout } from "../utils/with-timeout";
import {
  BridgeError,
  authHeaders,
  buildEndpoint,
  extractCode,
  parseJsonBody
} from "../services/bridge-protocol";
import {
  MAIL_REQUEST_TIMEOUT_MS,
  describeBridgeError,
  parseAttachmentsResult,
  parseSearchResult,
  parseSendResult,
  type AttachmentsRequest,
  type AttachmentsResult,
  type MailBridgeConfig,
  type SearchRequest,
  type SearchResult,
  type SendRequest,
  type SendResult
} from "../services/mail-protocol";

/**
 * Transport for the mail bridge.
 *
 * The bridge exists because mobile has no Node runtime and no raw sockets, so
 * IMAP and SMTP have to be reached over HTTPS.
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

export async function fetchAttachments(
  config: MailBridgeConfig,
  request: AttachmentsRequest
): Promise<AttachmentsResult> {
  return parseAttachmentsResult(await postJson(config, "/attachments", request));
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

  return parseJsonBody(response);
}
