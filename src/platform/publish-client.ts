import { requestUrl } from "obsidian";
import { withTimeout } from "../utils/with-timeout";
import { withRetry } from "../utils/retry";
import {
  BridgeError,
  asRecord,
  authHeaders,
  buildEndpoint,
  extractCode,
  parseJsonBody
} from "../services/bridge-protocol";
import {
  COMMIT_REQUEST_TIMEOUT_MS,
  PUBLISH_REQUEST_TIMEOUT_MS,
  UPLOAD_REQUEST_TIMEOUT_MS,
  describePublishError,
  parseHealth,
  parsePlan,
  parseSummary,
  parseTargets,
  type BridgeHealth,
  type PublishBridgeConfig,
  type PublishIndex,
  type PublishPlan,
  type PublishSummary,
  type PublishTarget
} from "../services/publish-protocol";

/**
 * Transport for the publish capability.
 *
 * `requestUrl` runs outside the renderer's CORS sandbox, which is what lets
 * the plugin reach the bridge from a phone at all.
 *
 * Uploads send raw bytes rather than base64 in JSON. A video would otherwise
 * grow by a third on the way through both processes.
 */

/**
 * What the bridge says it is.
 *
 * Unauthenticated, so it also works before a token is configured, and cheap
 * enough to call once per session before the first real request.
 */
export async function bridgeHealth(config: PublishBridgeConfig): Promise<BridgeHealth> {
  const response = await withTimeout(
    requestUrl({
      url: buildEndpoint(config.baseUrl, "/health"),
      method: "GET",
      throw: false
    }),
    PUBLISH_REQUEST_TIMEOUT_MS,
    (seconds) => `bridge did not respond within ${seconds}s.`
  );

  if (response.status < 200 || response.status >= 300) {
    throw failure(response.status, response.text);
  }
  return parseHealth(parseJsonBody(response));
}

export async function listTargets(config: PublishBridgeConfig): Promise<PublishTarget[]> {
  return parseTargets(await send(config, "GET", "/publish/targets"));
}

export async function planPublish(
  config: PublishBridgeConfig,
  target: string,
  index: PublishIndex
): Promise<PublishPlan> {
  return parsePlan(await send(config, "POST", "/publish/plan", { target, index }));
}

export async function commitPublish(
  config: PublishBridgeConfig,
  target: string,
  index: PublishIndex
): Promise<PublishSummary> {
  return parseSummary(
    await send(config, "POST", "/publish/commit", { target, index }, COMMIT_REQUEST_TIMEOUT_MS)
  );
}

export async function checkTarget(
  config: PublishBridgeConfig,
  target: string
): Promise<{ ok: boolean; error?: string; entries?: number }> {
  const record = asRecord(await send(config, "POST", "/publish/diagnostics", { target }));
  return {
    ok: record.ok === true,
    ...(typeof record.error === "string" ? { error: record.error } : {}),
    ...(typeof record.entries === "number" ? { entries: record.entries } : {})
  };
}

export async function uploadSource(
  config: PublishBridgeConfig,
  target: string,
  sha256: string,
  content: ArrayBuffer
): Promise<void> {
  await upload(
    config,
    `/publish/source?target=${encodeURIComponent(target)}&sha256=${sha256}`,
    content
  );
}

export async function uploadAsset(
  config: PublishBridgeConfig,
  target: string,
  sha256: string,
  name: string,
  content: ArrayBuffer
): Promise<void> {
  await upload(
    config,
    `/publish/asset?target=${encodeURIComponent(target)}&sha256=${sha256}` +
      `&name=${encodeURIComponent(name)}`,
    content
  );
}

/**
 * A thumbnail, addressed by the picture it shows (`source`) and checked by its
 * own bytes (`sha256`). Protocol 2.
 */
export async function uploadThumbnail(
  config: PublishBridgeConfig,
  target: string,
  source: string,
  name: string,
  sha256: string,
  content: ArrayBuffer
): Promise<void> {
  await upload(
    config,
    `/publish/thumbnail?target=${encodeURIComponent(target)}&source=${source}` +
      `&sha256=${sha256}&name=${encodeURIComponent(name)}`,
    content
  );
}

async function send(
  config: PublishBridgeConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = PUBLISH_REQUEST_TIMEOUT_MS
): Promise<unknown> {
  const response = await withTimeout(
    requestUrl({
      url: buildEndpoint(config.baseUrl, path),
      method,
      headers: authHeaders(config.token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      throw: false
    }),
    timeoutMs,
    (seconds) => `bridge did not respond within ${seconds}s.`
  );

  if (response.status < 200 || response.status >= 300) {
    throw failure(response.status, response.text);
  }
  return parseJsonBody(response);
}

/** Uploads are the one request worth repeating; `withRetry` says why. */
async function upload(
  config: PublishBridgeConfig,
  path: string,
  content: ArrayBuffer
): Promise<void> {
  await withRetry(() => sendUpload(config, path, content));
}

async function sendUpload(
  config: PublishBridgeConfig,
  path: string,
  content: ArrayBuffer
): Promise<void> {
  const response = await withTimeout(
    requestUrl({
      url: buildEndpoint(config.baseUrl, path),
      method: "PUT",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/octet-stream"
      },
      body: content,
      throw: false
    }),
    UPLOAD_REQUEST_TIMEOUT_MS,
    (seconds) => `bridge did not accept the upload within ${seconds}s.`
  );

  if (response.status < 200 || response.status >= 300) {
    throw failure(response.status, response.text);
  }
}

function failure(status: number, body: string): BridgeError {
  return new BridgeError(describePublishError(status, body), status, extractCode(body));
}
