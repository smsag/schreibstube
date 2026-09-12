import { requestUrl } from "obsidian";
import { withTimeout } from "../utils/with-timeout";
import { buildEndpoint, authHeaders } from "./bridge-protocol";
import {
  PUBLISH_REQUEST_TIMEOUT_MS,
  UPLOAD_REQUEST_TIMEOUT_MS,
  describePublishError,
  parsePlan,
  parseSummary,
  parseTargets,
  type PublishBridgeConfig,
  type PublishIndex,
  type PublishPlan,
  type PublishSummary,
  type PublishTarget
} from "./publish-protocol";

/**
 * Transport for the publish capability.
 *
 * Uses Obsidian's `requestUrl`, which runs outside the renderer's CORS sandbox
 * and behaves identically on desktop and mobile. That is the whole reason the
 * bridge exists: mobile has no Node runtime and no raw sockets, so SFTP has to
 * be reached over HTTPS.
 *
 * Uploads send raw bytes rather than base64 in JSON. A video would otherwise
 * grow by a third on the way through both processes.
 */

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
  return parseSummary(await send(config, "POST", "/publish/commit", { target, index }));
}

export async function checkTarget(
  config: PublishBridgeConfig,
  target: string
): Promise<{ ok: boolean; error?: string; entries?: number }> {
  const json = await send(config, "POST", "/publish/diagnostics", { target });
  const record = (json ?? {}) as Record<string, unknown>;
  return {
    ok: record.ok === true,
    error: typeof record.error === "string" ? record.error : undefined,
    entries: typeof record.entries === "number" ? record.entries : undefined
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

async function send(
  config: PublishBridgeConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<unknown> {
  const response = await withTimeout(
    requestUrl({
      url: buildEndpoint(config.baseUrl, path),
      method,
      headers: authHeaders(config.token),
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false
    }),
    PUBLISH_REQUEST_TIMEOUT_MS,
    (seconds) => `bridge did not respond within ${seconds}s.`
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(describePublishError(response.status, response.text));
  }
  return response.json;
}

async function upload(
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
    throw new Error(describePublishError(response.status, response.text));
  }
}
