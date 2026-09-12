/**
 * Pure request/response handling for the publish capability.
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

/** Generous: a commit renders the whole site and writes what changed. */
export const PUBLISH_REQUEST_TIMEOUT_MS = 120_000;

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
}

export interface PublishAsset {
  sourcePath: string;
  sha256: string;
  name: string;
  bytes: number;
}

export interface PublishIndex {
  siteTitle: string;
  notes: PublishNote[];
  assets: PublishAsset[];
  /** A `theme.css` from the publish folder, replacing the built-in stylesheet. */
  themeCss?: string;
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
  willDelete: string[];
  unchangedSources: number;
  notes: number;
}

export interface PublishSummary {
  target: string;
  baseUrl: string;
  written: number;
  unchanged: number;
  deleted: number;
  pruned: number;
  collected: number;
  durationMs: number;
}

export function parseTargets(json: unknown): PublishTarget[] {
  const raw = asRecord(json).targets;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const record = asRecord(entry);
    return {
      name: str(record.name),
      baseUrl: str(record.baseUrl),
      siteTitle: str(record.siteTitle)
    };
  });
}

export function parsePlan(json: unknown): PublishPlan {
  const record = asRecord(json);
  return {
    target: str(record.target),
    baseUrl: str(record.baseUrl),
    uploadSources: parseUploads(record.uploadSources),
    uploadAssets: parseUploads(record.uploadAssets),
    willDelete: Array.isArray(record.willDelete) ? record.willDelete.map(str).filter(Boolean) : [],
    unchangedSources: number(record.unchangedSources),
    notes: number(record.notes)
  };
}

export function parseSummary(json: unknown): PublishSummary {
  const record = asRecord(json);
  return {
    target: str(record.target),
    baseUrl: str(record.baseUrl),
    written: number(record.written),
    unchanged: number(record.unchanged),
    deleted: number(record.deleted),
    pruned: number(record.pruned),
    collected: number(record.collected),
    durationMs: number(record.durationMs)
  };
}

function parseUploads(value: unknown): UploadRequest[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = asRecord(entry);
    return {
      sourcePath: str(record.sourcePath),
      sha256: str(record.sha256),
      name: str(record.name) || undefined,
      path: str(record.path) || undefined
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

/** What the plan means, in one line, for the confirmation dialog. */
export function summarisePlan(plan: PublishPlan): string {
  const parts = [`${plan.notes} Notiz(en)`];
  if (plan.uploadSources.length > 0) parts.push(`${plan.uploadSources.length} zu übertragen`);
  if (plan.uploadAssets.length > 0) parts.push(`${plan.uploadAssets.length} Medien`);
  if (plan.willDelete.length > 0) parts.push(`${plan.willDelete.length} zu löschen`);
  if (plan.uploadSources.length === 0 && plan.uploadAssets.length === 0) {
    parts.push("nichts zu übertragen");
  }
  return parts.join(", ");
}
