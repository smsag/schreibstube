/**
 * Request/response handling for the publish capability.
 *
 * The plugin decides what is published and what it is called; the bridge
 * renders and writes it. This module is the contract between the two, and the
 * slug rules in `publish-index.ts` have to satisfy what the bridge accepts.
 */
import {
  asRecord,
  describeBridgeError as describeError,
  extractError,
  str
} from "./bridge-protocol";

/**
 * The protocol this plugin speaks.
 *
 * Plugin and bridge are deployed separately and will drift. The bridge reports
 * its own number on /health, so a mismatch can be named — "redeploy the bridge"
 * — instead of surfacing later as a 404 on a route that does not exist yet.
 */
export const PROTOCOL_VERSION = 8;

/** Plan, targets, diagnostics: a manifest read and a listing. */
export const PUBLISH_REQUEST_TIMEOUT_MS = 120_000;

/**
 * A commit renders the whole site and writes what changed, and the bridge
 * allows it 300 s. The plugin has to wait longer than that: giving up first
 * reported a publish as failed while it went on to succeed, and the retry
 * that followed met "already running".
 */
export const COMMIT_REQUEST_TIMEOUT_MS = 330_000;

/** An upload is one file, but a video is a large one over a slow line. */
export const UPLOAD_REQUEST_TIMEOUT_MS = 180_000;

export interface PublishBridgeConfig {
  baseUrl: string;
  token: string;
}

export interface PublishNote {
  sourcePath: string;
  sha256: string;
  slug: string;
  title: string;
  date: string;
  description?: string;
  /** Which of the index's header tags the note carries. Protocol 3. */
  tags?: string[];
}

export interface PublishAsset {
  sourcePath: string;
  sha256: string;
  name: string;
  bytes: number;
  /** Shown small in a filmstrip, so the site wants a thumbnail of it. Protocol 2. */
  thumbnail?: boolean;
}

export interface PublishIndex {
  siteTitle: string;
  notes: PublishNote[];
  assets: PublishAsset[];
  /** A `theme.css` from the publish folder, replacing the built-in stylesheet. */
  themeCss?: string;
  /** Up to three tags linked from the site's header. Protocol 3. */
  headerTags?: string[];
}

export interface PublishTarget {
  name: string;
  baseUrl: string;
  siteTitle: string;
}

export interface UploadRequest {
  sourcePath: string;
  sha256: string;
  name?: string;
  path?: string;
}

export interface PublishPlan {
  target: string;
  baseUrl: string;
  uploadSources: UploadRequest[];
  uploadAssets: UploadRequest[];
  /** The thumbnails the site does not have yet. A protocol-1 bridge sends none. */
  uploadThumbnails: UploadRequest[];
  willDelete: string[];
  /**
   * Files on the host the bridge never wrote that this publish would
   * overwrite, which the bridge refuses to do. Protocol 8; an older bridge
   * sends none, and overwrites them.
   */
  conflicts: string[];
  unchangedSources: number;
  notes: number;
}

export interface PublishSummary {
  target: string;
  baseUrl: string;
  written: number;
  unchanged: number;
  deleted: number;
  /** Files the host refused to delete; the manifest keeps them for the next publish. */
  deleteFailed: number;
  pruned: number;
  collected: number;
  durationMs: number;
}

/**
 * What `/health` says. A bridge from 3.0 on names its version and capabilities
 * only to a caller holding a token, and the plugin asks without one, so those
 * two read as empty there; `protocol` is the handshake and is always given.
 */
export interface BridgeHealth {
  version: string;
  protocol: number;
  capabilities: string[];
}

/**
 * The most entries one list in a plan is read with. A default bridge allows
 * two thousand files per site; five times that is a plan no site has, and a
 * bound on what a wrong bridge can make the plugin loop over.
 */
export const MAX_PLAN_ENTRIES = 10_000;

export function parseHealth(json: unknown): BridgeHealth {
  const record = asRecord(json);
  return {
    version: str(record.version),
    protocol: typeof record.protocol === "number" ? record.protocol : 0,
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.map(str).filter(Boolean)
      : []
  };
}

export function parseTargets(json: unknown): PublishTarget[] {
  const raw = asRecord(json).targets;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_PLAN_ENTRIES).map((entry) => {
    const record = asRecord(entry);
    return {
      name: str(record.name),
      baseUrl: httpUrl(record.baseUrl),
      siteTitle: str(record.siteTitle)
    };
  });
}

/**
 * A site address the plugin may open or write into a note, or "" when the
 * bridge sent something else. The address is opened in a browser and written
 * as the note's published URL, so a `javascript:` or `file:` one from a bridge
 * that is not ours must never get that far.
 */
function httpUrl(value: unknown): string {
  const raw = str(value);
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "https:" || protocol === "http:" ? raw : "";
  } catch {
    return "";
  }
}

export function parsePlan(json: unknown): PublishPlan {
  const record = asRecord(json);
  return {
    target: str(record.target),
    baseUrl: httpUrl(record.baseUrl),
    uploadSources: parseUploads(record.uploadSources),
    uploadAssets: parseUploads(record.uploadAssets),
    uploadThumbnails: parseUploads(record.uploadThumbnails),
    willDelete: paths(record.willDelete),
    conflicts: paths(record.conflicts),
    unchangedSources: number(record.unchangedSources),
    notes: number(record.notes)
  };
}

export function parseSummary(json: unknown): PublishSummary {
  const record = asRecord(json);
  return {
    target: str(record.target),
    baseUrl: httpUrl(record.baseUrl),
    written: number(record.written),
    unchanged: number(record.unchanged),
    deleted: number(record.deleted),
    deleteFailed: number(record.deleteFailed),
    pruned: number(record.pruned),
    collected: number(record.collected),
    durationMs: number(record.durationMs)
  };
}

function paths(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, MAX_PLAN_ENTRIES).map(str).filter(Boolean) : [];
}

function parseUploads(value: unknown): UploadRequest[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_PLAN_ENTRIES).map((entry) => {
    const record = asRecord(entry);
    const name = str(record.name);
    const path = str(record.path);
    return {
      sourcePath: str(record.sourcePath),
      sha256: str(record.sha256),
      ...(name ? { name } : {}),
      ...(path ? { path } : {})
    };
  });
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Publishing's wording for a bridge failure; the shape of the answer is shared. */
export function describePublishError(status: number, body: string): string {
  if (status === 404) {
    return (
      extractError(body) ||
      "bridge endpoint not found — check the Bridge URL, or redeploy a bridge that can publish."
    );
  }
  return describeError(status, body, "the web host");
}

/**
 * Whether a plan asks for nothing at all.
 *
 * A folder with no marked note still goes to the bridge, because the notes it
 * published before have to come down: stopping at "nothing is marked" left the
 * last unpublished page online for good. Only when there is also nothing to
 * delete is there nothing to confirm.
 */
export function isEmptyPlan(plan: PublishPlan): boolean {
  return (
    plan.notes === 0 &&
    plan.willDelete.length === 0 &&
    plan.uploadSources.length === 0 &&
    plan.uploadAssets.length === 0 &&
    plan.uploadThumbnails.length === 0
  );
}
