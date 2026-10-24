// The notes that belong to a Nimbus project without carrying its tag, as the
// file Nimbus reads (contracts/RELATED.md). Nimbus cannot ask the index: it
// runs outside Obsidian, and on a phone the two never run side by side. So
// the desktop that keeps the index writes what it found into one file, and
// everything that decides what goes into that file lives here, pure.

import { cosine, rankYieldEvery } from "./vector-math";
import { passageHash } from "./embedding-index";
import { optedOut, vaultNoteChunks } from "./vault-retrieval";
import type { IndexKeeper } from "./embedding-index";
import { escapeRegExp } from "../escape-regexp";

/** The file's name, in Schreibstube's plugin folder. */
export const RELATED_FILE_NAME = "nimbus-related.json";
export const RELATED_FORMAT = "schreibstube-related";
export const RELATED_VERSION = 1;
/** The most the file may weigh, in UTF-8 bytes; a reader refuses more. */
export const MAX_RELATED_BYTES = 2 * 1024 * 1024;
/** Related notes per project, best first. */
export const MAX_RELATED_PER_PROJECT = 20;
/** Passages a project is searched from. */
export const MAX_ANCHORS = 32;
/** A passage's text in the file, in UTF-16 code units. */
export const MAX_PASSAGE_UNITS = 600;
/** Letters or digits a passage needs, besides heading lines and tags. */
export const MIN_SUBSTANCE = 40;
/** The frontmatter key that makes a note a Nimbus project (Nimbus' key, not ours). */
export const PROJECT_KEY = "nimbusProject";

/**
 * Candidates read per project before giving up on filling its list. Each is a
 * file read; the ones that fail the checks after scoring (they carry the tag,
 * their text moved since it was embedded, their best passage is a heading)
 * are few, so twenty related notes are found long before this.
 */
export const MAX_CANDIDATE_READS = 120;
/**
 * Notes Obsidian says may carry a project's tag that are read to tell which
 * do. Read past the anchors as well: a carrier never told apart was scored as
 * a candidate, ranked first, as the project's own notes read most like it,
 * and spent the candidate reads being set aside. Past this, a note Obsidian
 * says may carry the tag is left out as if it did.
 */
export const MAX_CARRIER_READS = 400;
/**
 * Notes whose passages one run keeps once read. The reading is the same for
 * every project, so it is shared across them, the least recently asked
 * going first past this.
 */
export const MAX_CACHED_NOTES = 1000;
/**
 * Projects one run looks at. Each costs a pass over every indexed passage; a
 * vault holding more project notes than this is not one the contract was
 * written for, and the rest are left out rather than the run taking minutes.
 */
export const MAX_PROJECTS = 250;

/** How long the triggers wait for more of the same before a run. */
export const RELATED_DEBOUNCE_MS = 30_000;
/** At most one run in this long. */
export const RELATED_INTERVAL_MS = 5 * 60_000;
/** How long a run waits when the index is busy or not read yet. */
export const RELATED_RETRY_MS = 60_000;

export interface RelatedEntry {
  path: string;
  heading: string | null;
  text: string;
  score: number;
  modified: string;
}

export interface RelatedProject {
  tag: string;
  note: string;
  related: RelatedEntry[];
}

export interface RelatedFile {
  format: typeof RELATED_FORMAT;
  version: typeof RELATED_VERSION;
  writtenAt: string;
  model: string;
  floor: number;
  projects: RelatedProject[];
}

/** One vault note as the export sees it, from Obsidian's metadata cache. */
export interface ExportNote {
  path: string;
  /** Last modification, epoch milliseconds. */
  mtime: number;
  frontmatter: unknown;
  /**
   * The tags Obsidian found in the note, without `#`, lowercased; null when
   * it has no reading of the note. Only a hint of which notes to read for the
   * tag: the decision is made on the passages' text, by `carriesTag`.
   */
  tags: readonly string[] | null;
}

/** One row of the vault index. */
export interface ExportRow {
  id: string;
  chunks: readonly Int8Array[];
  passages?: Uint32Array | undefined;
}

/**
 * The project tag a `nimbusProject` value gives, or null: trimmed of spaces
 * and tabs, lowercased, every leading `#` and the `/` at both ends taken off —
 * Nimbus' own reading of a tag, so both apps name a project alike.
 */
export function projectTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value
    .replace(/^[ \t]+|[ \t]+$/g, "")
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/^\/+|\/+$/g, "");
  return tag.length > 0 ? tag : null;
}

/** What may not stand right before a `#` for it to start a tag. */
const NOT_BEFORE_TAG = /[\p{L}\p{N}_#&/\][=]/u;
/** What continues a tag, so a match followed by it names another tag. */
const TAG_CHAR = /[\p{L}\p{N}_-]/u;

function startsTag(text: string, at: number): boolean {
  return at === 0 || !NOT_BEFORE_TAG.test(text[at - 1] ?? "");
}

/**
 * Whether `text` carries `tag` as a tag (RELATED.md §3): `#tag`, or `#tag/…`
 * for a tag below it, in any case, where the `#` starts a tag rather than
 * standing inside a word, a link, an entity or a URL.
 */
export function carriesTag(text: string, tag: string): boolean {
  if (!tag) return false;
  const pattern = new RegExp(`#${escapeRegExp(tag)}`, "giu");
  for (const match of text.matchAll(pattern)) {
    const after = text[match.index + match[0].length];
    if (after !== undefined && TAG_CHAR.test(after)) continue;
    if (startsTag(text, match.index)) return true;
  }
  return false;
}

const HEADING_LINE = /^#{1,6}\s/;
const ANY_TAG = /#[\p{L}\p{N}_\-/]+/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

/**
 * Whether a passage says something: at least forty letters or digits once
 * its heading lines and tags are gone. A passage of headings alone, or a line
 * of tags, matches everything a little and nothing in particular.
 */
export function hasSubstance(text: string): boolean {
  const body = text
    .split("\n")
    .filter((line) => !HEADING_LINE.test(line))
    .join("\n")
    .replace(ANY_TAG, (match, at: number, whole: string) => (startsTag(whole, at) ? " " : match));
  return (body.match(LETTER_OR_DIGIT)?.length ?? 0) >= MIN_SUBSTANCE;
}

/** The words of the heading line a passage starts with, or null. */
export function passageHeading(text: string): string | null {
  const first = text.split("\n", 1)[0] ?? "";
  if (!HEADING_LINE.test(first)) return null;
  const words = first.replace(/^#{1,6}\s*/, "").trim();
  return words.length > 0 ? words : null;
}

/**
 * A passage cut to the file's length. Never between the two halves of a
 * surrogate pair: half a character is not valid text to a strict JSON reader,
 * and one code unit fewer is still within the limit.
 */
export function clipPassage(text: string): string {
  if (text.length <= MAX_PASSAGE_UNITS) return text;
  let end = MAX_PASSAGE_UNITS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(0, end);
}

/** A report — Nimbus' own, among others — is no candidate. */
export function isSummaryNote(frontmatter: unknown): boolean {
  if (!frontmatter || typeof frontmatter !== "object") return false;
  const type = (frontmatter as Record<string, unknown>).type;
  return typeof type === "string" && type.trim().toLowerCase() === "summary";
}

/** Code-unit order, the one the contract sorts by. */
function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The projects in the vault, sorted by tag: every note whose `nimbusProject`
 * gives a tag and that stays in the index. Two notes with one tag: the first
 * by path is the project.
 */
export function findProjects(notes: readonly ExportNote[]): { tag: string; note: string }[] {
  const byTag = new Map<string, string>();
  for (const note of [...notes].sort((a, b) => byCodeUnits(a.path, b.path))) {
    if (optedOut(note.frontmatter)) continue;
    const fm = note.frontmatter;
    if (!fm || typeof fm !== "object") continue;
    const tag = projectTag((fm as Record<string, unknown>)[PROJECT_KEY]);
    if (tag !== null && !byTag.has(tag)) byTag.set(tag, note.path);
  }
  return [...byTag].map(([tag, note]) => ({ tag, note })).sort((a, b) => byCodeUnits(a.tag, b.tag));
}

/** Whether a note's frontmatter names it a project at all, whatever the value. */
export function namesProject(frontmatter: unknown): boolean {
  return (
    !!frontmatter &&
    typeof frontmatter === "object" &&
    (frontmatter as Record<string, unknown>)[PROJECT_KEY] !== undefined
  );
}

/** Whether Obsidian's tags for a note suggest it may carry `tag`. */
function mayCarry(tags: readonly string[] | null, tag: string): boolean {
  return tags === null || tags.some((t) => t === tag || t.startsWith(`${tag}/`));
}

/** Rounded the way the file holds a score. */
export function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

/** A note's passages, as the index cut them, and whether they are still the
 *  ones its stored vectors were made from. */
interface NotePassages {
  texts: string[];
  /** Every passage's hash matches the row's, in order: position i is vector i. */
  aligned: boolean;
}

function aligned(texts: readonly string[], row: ExportRow | undefined): boolean {
  const stored = row?.passages;
  if (!row || !stored || stored.length !== texts.length || row.chunks.length !== texts.length)
    return false;
  return texts.every((text, i) => passageHash(text) === stored[i]);
}

function bestAgainst(
  anchors: readonly Int8Array[],
  chunks: readonly Int8Array[]
): { score: number; at: number } {
  let score = -Infinity;
  let at = -1;
  chunks.forEach((chunk, i) => {
    for (const anchor of anchors) {
      if (anchor.length !== chunk.length) continue;
      const s = cosine(anchor, chunk);
      if (s > score) {
        score = s;
        at = i;
      }
    }
  });
  return { score, at };
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export interface RelatedInput {
  notes: readonly ExportNote[];
  rows: readonly ExportRow[];
  /** The model the vectors come from, and its balanced related floor. */
  model: string;
  floor: number;
  /** The passage length the index cuts notes at, so a note is cut alike here. */
  maxChars: number;
  /** When the file is written, epoch milliseconds. */
  now: number;
  /** A note's Markdown, or null when it cannot be read. */
  load(path: string): Promise<string | null>;
}

type PassagesOf = (path: string) => Promise<NotePassages | null>;

/** A note's passages as the index cut them, read once a run and shared by
 *  every project, at most MAX_CACHED_NOTES of them held. */
function passageReader(input: RelatedInput, rows: ReadonlyMap<string, ExportRow>): PassagesOf {
  const read = new Map<string, Promise<NotePassages | null>>();
  return (path) => {
    let found = read.get(path);
    if (found) {
      read.delete(path);
    } else {
      found = input
        .load(path)
        .catch(() => null)
        .then((markdown) => {
          if (markdown === null) return null;
          const texts = vaultNoteChunks(markdown, input.maxChars);
          return { texts, aligned: aligned(texts, rows.get(path)) };
        });
    }
    read.set(path, found);
    if (read.size > MAX_CACHED_NOTES) {
      const oldest = read.keys().next().value;
      if (oldest !== undefined) read.delete(oldest);
    }
    return found;
  };
}

/** The related notes of one project, best first. */
async function relatedFor(
  project: { tag: string; note: string },
  input: RelatedInput,
  notes: ReadonlyMap<string, ExportNote>,
  rows: ReadonlyMap<string, ExportRow>,
  passagesOf: PassagesOf
): Promise<RelatedEntry[]> {
  const { tag } = project;

  // The project's own passages: its note's first, then the passages of other
  // notes that carry its tag, by path. `leftOut`: the notes that carry it,
  // which are the project's own and no candidates.
  const anchors: Int8Array[] = [];
  const leftOut = new Set<string>();
  const take = (path: string, own: NotePassages, wanted: (text: string) => boolean): void => {
    const row = rows.get(path);
    if (!row || !own.aligned) return;
    own.texts.forEach((text, i) => {
      const vector = row.chunks[i];
      if (vector && anchors.length < MAX_ANCHORS && wanted(text) && hasSubstance(text))
        anchors.push(vector);
    });
  };
  const own = await passagesOf(project.note);
  if (own) take(project.note, own, () => true);
  const hinted = [...notes.values()]
    .filter((note) => note.path !== project.note && mayCarry(note.tags, tag))
    .sort((a, b) => byCodeUnits(a.path, b.path));
  let carrierReads = 0;
  for (const note of hinted) {
    if (carrierReads >= MAX_CARRIER_READS) {
      leftOut.add(note.path);
      continue;
    }
    carrierReads++;
    const passages = await passagesOf(note.path);
    if (!passages?.texts.some((text) => carriesTag(text, tag))) continue;
    leftOut.add(note.path);
    if (anchors.length < MAX_ANCHORS) take(note.path, passages, (text) => carriesTag(text, tag));
  }
  if (anchors.length === 0) return [];

  // Every other indexed note, by its best passage against any anchor.
  const scored: { path: string; score: number; at: number }[] = [];
  const yieldEvery = rankYieldEvery(anchors.length);
  let scanned = 0;
  for (const row of input.rows) {
    const note = notes.get(row.id);
    if (
      note &&
      row.chunks.length > 0 &&
      row.id !== project.note &&
      !leftOut.has(row.id) &&
      !isSummaryNote(note.frontmatter)
    ) {
      const best = bestAgainst(anchors, row.chunks);
      if (Number.isFinite(best.score) && best.score >= input.floor)
        // Quantized vectors can land a hair above one.
        scored.push({ path: row.id, at: best.at, score: Math.min(1, best.score) });
    }
    if (++scanned % yieldEvery === 0) await pause();
  }
  scored.sort((a, b) => roundScore(b.score) - roundScore(a.score) || byCodeUnits(a.path, b.path));

  // Read in that order until the list is full: the checks that need the text.
  const related: RelatedEntry[] = [];
  let reads = 0;
  for (const hit of scored) {
    if (related.length >= MAX_RELATED_PER_PROJECT || reads >= MAX_CANDIDATE_READS) break;
    reads++;
    const note = notes.get(hit.path);
    const passages = await passagesOf(hit.path);
    if (!note || !passages?.aligned || !Number.isFinite(note.mtime) || note.mtime < 0) continue;
    if (passages.texts.some((text) => carriesTag(text, tag))) continue;
    const text = passages.texts[hit.at];
    if (text === undefined || !hasSubstance(text)) continue;
    related.push({
      path: hit.path,
      heading: passageHeading(text),
      text: clipPassage(text),
      score: roundScore(hit.score),
      modified: new Date(note.mtime).toISOString()
    });
  }
  return related;
}

/** The whole file: every project and its related notes (RELATED.md §2–4). */
export async function buildRelatedFile(input: RelatedInput): Promise<RelatedFile> {
  const notes = new Map(input.notes.map((note) => [note.path, note]));
  const rows = new Map(input.rows.map((row) => [row.id, row]));
  const passagesOf = passageReader(input, rows);
  const projects: RelatedProject[] = [];
  for (const project of findProjects(input.notes).slice(0, MAX_PROJECTS)) {
    projects.push({
      ...project,
      related: await relatedFor(project, input, notes, rows, passagesOf)
    });
  }
  return fitBudget({
    format: RELATED_FORMAT,
    version: RELATED_VERSION,
    writtenAt: new Date(input.now).toISOString(),
    model: input.model,
    floor: input.floor,
    projects
  });
}

/** The file's text. */
export function serializeRelatedFile(file: RelatedFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The file trimmed to what a reader accepts: while it is over the limit, the
 * last entries of the longest lists go first, so every project keeps its best.
 */
export function fitBudget(file: RelatedFile, limit = MAX_RELATED_BYTES): RelatedFile {
  const out: RelatedFile = {
    ...file,
    projects: file.projects.map((p) => ({ ...p, related: [...p.related] }))
  };
  let size = utf8Bytes(serializeRelatedFile(out));
  while (size > limit) {
    let excess = size - limit;
    let dropped = false;
    while (excess > 0) {
      const longest = out.projects.reduce<RelatedProject | null>(
        (best, p) => (p.related.length > (best?.related.length ?? 0) ? p : best),
        null
      );
      const entry = longest?.related.pop();
      if (!entry) break;
      dropped = true;
      excess -= utf8Bytes(JSON.stringify(entry));
    }
    if (!dropped) break;
    size = utf8Bytes(serializeRelatedFile(out));
  }
  return out;
}

/** Why a reader refuses a file, or nothing when it accepts it. */
export type RelatedRefusal =
  "size" | "json" | "format" | "version" | "writtenAt" | "model" | "floor" | "projects";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function isIsoUtc(value: unknown): value is string {
  return typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function readEntry(value: unknown): RelatedEntry | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (typeof e.path !== "string" || e.path.length === 0) return null;
  if (e.heading !== null && typeof e.heading !== "string") return null;
  if (typeof e.text !== "string" || e.text.length > MAX_PASSAGE_UNITS) return null;
  if (typeof e.score !== "number" || !Number.isFinite(e.score)) return null;
  if (!isIsoUtc(e.modified)) return null;
  return { path: e.path, heading: e.heading, text: e.text, score: e.score, modified: e.modified };
}

function readProject(value: unknown): RelatedProject | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (typeof p.tag !== "string" || p.tag.length === 0) return null;
  if (typeof p.note !== "string" || p.note.length === 0) return null;
  if (!Array.isArray(p.related) || p.related.length > MAX_RELATED_PER_PROJECT) return null;
  const related: RelatedEntry[] = [];
  for (const entry of p.related) {
    const read = readEntry(entry);
    if (!read) return null;
    related.push(read);
  }
  return { tag: p.tag, note: p.note, related };
}

/**
 * The file as a reader takes it (RELATED.md §1, §6): accepted, in the
 * writer's own shape, or refused with the reason. Used to compare with what
 * is on disk, and by the tests to prove the writer's output is accepted.
 */
export function readRelatedFile(
  text: string
): { ok: true; file: RelatedFile } | { ok: false; refused: RelatedRefusal } {
  if (utf8Bytes(text) > MAX_RELATED_BYTES) return { ok: false, refused: "size" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, refused: "json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { ok: false, refused: "json" };
  const f = parsed as Record<string, unknown>;
  if (f.format !== RELATED_FORMAT) return { ok: false, refused: "format" };
  if (f.version !== RELATED_VERSION) return { ok: false, refused: "version" };
  if (!isIsoUtc(f.writtenAt)) return { ok: false, refused: "writtenAt" };
  if (typeof f.model !== "string" || f.model.length === 0) return { ok: false, refused: "model" };
  if (typeof f.floor !== "number" || !Number.isFinite(f.floor))
    return { ok: false, refused: "floor" };
  if (!Array.isArray(f.projects)) return { ok: false, refused: "projects" };
  const projects: RelatedProject[] = [];
  for (const project of f.projects) {
    const read = readProject(project);
    if (!read) return { ok: false, refused: "projects" };
    projects.push(read);
  }
  return {
    ok: true,
    file: {
      format: RELATED_FORMAT,
      version: RELATED_VERSION,
      writtenAt: f.writtenAt,
      model: f.model,
      floor: f.floor,
      projects
    }
  };
}

/**
 * Whether the file on disk already says what `file` says, `writtenAt` aside:
 * then nothing is written, so an unchanged vault is not a sync event every
 * five minutes. Anything unreadable on disk differs.
 */
export function sameRelatedContent(onDisk: string | null, file: RelatedFile): boolean {
  if (onDisk === null) return false;
  const read = readRelatedFile(onDisk);
  if (!read.ok) return false;
  return (
    JSON.stringify({ ...read.file, writtenAt: "" }) === JSON.stringify({ ...file, writtenAt: "" })
  );
}

/**
 * The file beside the list that names the one desktop writing it. A vault
 * open on two desktops has an index on each, and both wrote the list: while
 * their indexes differed each replaced the other's every five minutes, and
 * a sync could keep the two writes as copies Nimbus never reads. Nimbus does
 * not read this file.
 */
export const RELATED_WRITER_FILE_NAME = "nimbus-related.writer.json";
/** How long a desktop's claim stands without being renewed: past it another
 *  desktop takes the list over, the first being gone or switched off. */
export const RELATED_CLAIM_MS = 3 * 24 * 60 * 60_000;
/** How old its own claim is before a desktop writes it again on a run. */
export const RELATED_RENEW_MS = 24 * 60 * 60_000;

const DEVICE_ID = /^[a-z0-9-]{8,64}$/;

/** A device id as this device keeps it, or null when it is none. */
export function readDeviceId(value: unknown): string | null {
  return typeof value === "string" && DEVICE_ID.test(value) ? value : null;
}

export interface WriterClaim {
  device: string;
  /** Epoch milliseconds. */
  at: number;
}

/** The claim file as written, or null when it holds none: another device's
 *  hand-edit or a write cut short is no claim, and the next writer replaces it. */
export function readWriterClaim(text: string | null): WriterClaim | null {
  if (text === null || text.length > 1024) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    const device = readDeviceId(raw?.device);
    const at = typeof raw?.at === "string" ? Date.parse(raw.at) : NaN;
    return device !== null && Number.isFinite(at) ? { device, at } : null;
  } catch {
    return null;
  }
}

export function serializeWriterClaim(claim: WriterClaim): string {
  return `${JSON.stringify({ device: claim.device, at: new Date(claim.at).toISOString() })}\n`;
}

/**
 * Whether this desktop handles the list — writes it, or deletes it when
 * switched off — and whether it writes its claim first. A claim dated far
 * from now either way is as good as none, so a clock set wrong once cannot
 * hold the list for ever.
 */
export function writerDecision(
  claim: WriterClaim | null,
  me: string,
  now: number
): { handles: boolean; claims: boolean } {
  const age = claim === null ? Infinity : Math.abs(now - claim.at);
  if (claim === null || age >= RELATED_CLAIM_MS) return { handles: true, claims: true };
  if (claim.device === me) return { handles: true, claims: age >= RELATED_RENEW_MS };
  return { handles: false, claims: false };
}

/**
 * What this device does with the file: only a device that keeps the index
 * (a desktop) writes it, and it is deleted there when search by meaning is
 * switched off. A phone leaves it. Of two desktops, `writerDecision` says
 * which one.
 */
export function relatedFileAction(state: {
  device: IndexKeeper;
  switchedOn: boolean;
}): "write" | "delete" | "none" {
  if (state.device !== "desktop") return "none";
  return state.switchedOn ? "write" : "delete";
}

/** When the next run may start: after the quiet the triggers wait for, and
 *  not sooner than the interval after the last run. */
export function nextRelatedRun(
  now: number,
  lastRunAt: number,
  debounceMs = RELATED_DEBOUNCE_MS,
  intervalMs = RELATED_INTERVAL_MS
): number {
  return Math.max(now + debounceMs, lastRunAt + intervalMs);
}
