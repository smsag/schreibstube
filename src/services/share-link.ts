/**
 * Shared links: one note at a short address, for someone outside the vault.
 *
 * The bridge writes the page and keeps the record; this module decides what
 * the plugin sends and reads what comes back. The limits repeat the bridge's
 * (`bridge/publish/share.mjs`), so a note the bridge would refuse is refused
 * here first, with a message that names the vault's own files.
 */
import type { PublishAccount } from "../types";
import { asRecord, str } from "./bridge-protocol";
import { isInsideFolder, isPublishableAttachment, referencedAttachments } from "./publish-index";
import { sourceForUpload } from "./publish-source";

/** The bridge allows a share 180 s to write; the plugin waits a little longer. */
export const SHARE_REQUEST_TIMEOUT_MS = 200_000;

export const MIN_SHARE_PASSWORD_LENGTH = 8;
export const MAX_SHARE_PASSWORD_LENGTH = 256;
export const MAX_SHARE_ASSETS = 50;
export const MAX_SHARE_ASSET_BYTES = 20_000_000;
/** How many links one answer may list; the bridge keeps 200 per target. */
const MAX_LISTED_SHARES = 500;

/** The pictures a share carries inside its page. */
export const SHARE_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);

/** How long a link stays open. A week is what a document sent for review needs. */
export const SHARE_EXPIRY_CHOICES = ["1d", "7d", "30d", "90d", "never"] as const;
export type ShareExpiry = (typeof SHARE_EXPIRY_CHOICES)[number];
export const DEFAULT_SHARE_EXPIRY: ShareExpiry = "7d";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_DAYS: Record<ShareExpiry, number | null> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  never: null
};

/**
 * When a link closes once it is written: the time chosen, counted from now —
 * or, for a link being updated whose time nobody touched, the time it already
 * had, so updating the text neither shortens nor lengthens what was promised.
 */
export function expiryForChoice({
  expiry,
  edited,
  link,
  now
}: {
  expiry: ShareExpiry;
  edited: boolean;
  link?: SharedLink;
  now: number;
}): string | null {
  if (link && !edited) {
    if (link.expiresAt === null) return null;
    if (Date.parse(link.expiresAt) > now) return link.expiresAt;
  }
  return expiresAtFor(expiry, now);
}

/**
 * The password a link is written with, or null when the person has to enter
 * one first. An update keeps what the link had unless the person changed it:
 * the password drawn when the dialog opened would lock out a reader holding
 * the old one, so a protected link waits for one to be entered, the old or a
 * new; an open link stays open.
 */
export function passwordForChoice({
  password,
  chosen,
  link
}: {
  password: string;
  chosen: boolean;
  link?: SharedLink;
}): string | null {
  if (!link || chosen) return password;
  return link.protected ? null : "";
}

/** When a link chosen now closes, as the bridge reads it. */
export function expiresAtFor(choice: ShareExpiry, now: number): string | null {
  const days = EXPIRY_DAYS[choice];
  return days === null ? null : new Date(now + days * DAY_MS).toISOString();
}

/**
 * A password to read aloud or type from a phone: four groups of four from an
 * alphabet without the letters that look alike, about 79 bits.
 */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateSharePassword(
  random: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length))
): string {
  const size = PASSWORD_ALPHABET.length;
  const ceiling = Math.floor(256 / size) * size;
  let out = "";
  while (out.length < 16) {
    for (const byte of random(32)) {
      if (byte >= ceiling) continue;
      out += PASSWORD_ALPHABET[byte % size];
      if (out.length === 16) break;
    }
  }
  return out.match(/.{4}/g)?.join("-") ?? out;
}

export type PasswordCheck = "none" | "ok" | "short" | "long";

/** Whether a password, as typed, is one the bridge takes; empty means an open link. */
export function checkSharePassword(value: string): PasswordCheck {
  const length = [...value].length;
  if (length === 0) return "none";
  if (length < MIN_SHARE_PASSWORD_LENGTH) return "short";
  if (length > MAX_SHARE_PASSWORD_LENGTH) return "long";
  return "ok";
}

/**
 * The files a shared note embeds, read from what is sent rather than from the
 * note: a picture named only in a `%%comment%%` or the frontmatter is not on
 * the page, so it is neither sent nor counted against the budget.
 */
export function shareReferences(content: string): string[] {
  return referencedAttachments(sourceForUpload(content));
}

/**
 * Which account a note is shared through, or null when the person has to say:
 * the one whose folder holds the note, if exactly one does; the only account,
 * if there is one. With no note — managing the links — only the second holds,
 * since an open note says nothing about which site's links are wanted.
 */
export function shareAccountFor(
  accounts: readonly PublishAccount[],
  path: string | null
): PublishAccount | null {
  if (path) {
    const holding = accounts.filter(
      (account) => account.folder !== "" && isInsideFolder(path, account.folder)
    );
    if (holding.length === 1) return holding[0] ?? null;
  }
  return accounts.length === 1 ? (accounts[0] ?? null) : null;
}

/** A picture a note embeds, as far as a share is concerned. */
export interface ShareCandidate {
  path: string;
  bytes: number;
}

/**
 * Which of a note's pictures the share carries, and which it leaves out —
 * a video, an attachment of another kind, a picture past the budget — so the
 * plugin can say so. Taken in the note's order until the budget is spent.
 */
export function pickShareAssets(candidates: readonly ShareCandidate[]): {
  carried: ShareCandidate[];
  left: string[];
} {
  const carried: ShareCandidate[] = [];
  const left: string[] = [];
  let total = 0;
  for (const candidate of candidates) {
    if (carried.some((entry) => entry.path === candidate.path)) continue;
    const fits =
      isPublishableAttachment(candidate.path, SHARE_IMAGE_EXTENSIONS) &&
      carried.length < MAX_SHARE_ASSETS &&
      total + candidate.bytes <= MAX_SHARE_ASSET_BYTES;
    if (fits) {
      carried.push(candidate);
      total += candidate.bytes;
    } else if (!left.includes(candidate.path)) {
      left.push(candidate.path);
    }
  }
  return { carried, left };
}

/** Bytes as base64, in chunks: a phone's WebView has no Buffer, and spreading a
 *  large picture into one call overflows its stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

export interface ShareRequest {
  target: string;
  code?: string;
  title: string;
  sourcePath: string;
  source: string;
  assets: { sourcePath: string; data: string }[];
  password?: string;
  expiresAt: string | null;
  themeCss?: string;
}

export interface SharedLink {
  code: string;
  url: string;
  title: string;
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  protected: boolean;
}

const CODE = /^[A-HJ-NP-Za-km-z2-9]{10}$/;

/**
 * A link as the bridge describes it, or null when it is not one: the address
 * is copied and opened, so only a web address under the code it names is kept.
 */
export function parseSharedLink(json: unknown): SharedLink | null {
  const record = asRecord(json);
  const code = str(record.code);
  const url = str(record.url);
  if (!CODE.test(code) || !isLinkFor(url, code)) return null;
  const expiresAt = str(record.expiresAt);
  return {
    code,
    url,
    title: str(record.title),
    sourcePath: str(record.sourcePath),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
    expiresAt: expiresAt && Number.isFinite(Date.parse(expiresAt)) ? expiresAt : null,
    protected: record.protected === true
  };
}

export function parseSharedLinks(json: unknown): SharedLink[] {
  const raw = asRecord(json).shares;
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_LISTED_SHARES)
    .map(parseSharedLink)
    .filter((link): link is SharedLink => link !== null);
}

function isLinkFor(url: string, code: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.pathname.endsWith(`/s/${code}/`)
    );
  } catch {
    return false;
  }
}

/** The links made of one note, newest first. */
export function linksOfNote(links: readonly SharedLink[], path: string): SharedLink[] {
  return links
    .filter((link) => link.sourcePath === path)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
