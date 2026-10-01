/**
 * Property sets: the keys a feature needs, added to a note in one step.
 *
 * Obsidian adds one property at a time. Schreibstube's features each read a
 * handful of keys — Mail needs a recipient and a subject, a glossary note
 * needs its marker and language — and a key typed by hand is a key that can be
 * misspelt. A set adds them all, and the sets for Schreibstube's own features
 * are built from the same constants the features read, so a key renamed in
 * code cannot leave a stale set behind. Publishing's keys are settings rather
 * than constants, so its set is built from the configured map, for the same
 * reason.
 *
 * Beyond those, a person points a setting at a folder and every note in it is
 * a set: its frontmatter keys and values, nothing from its body. Those may be
 * Templater templates, whose values are code (`<% tp.date.now() %>`); what is
 * done with that code is the caller's business, the decisions here only say
 * where it is.
 *
 * A set never overwrites. A key the note already has, empty or not, and in any
 * letter case, is left as it is: the failure this rules out is a set replacing
 * an address someone typed.
 */

import { FM_CC, FM_SUBJECT, FM_TO } from "./mail-frontmatter";
import { CONTROL_CHARS } from "./file-name";
import { NOTE_TEMPLATE_KEY } from "./print-data";
import { SYNC_EVERY_KEY } from "./sync-interval";
import { SYNC_FRONTMATTER_KEY } from "./sync-source";
import {
  GLOSSARY_LANGUAGE_KEY,
  GLOSSARY_MARKER,
  GLOSSARY_SEVERITY_KEY,
  DEFAULT_GLOSSARY_LANGUAGE,
  DEFAULT_GLOSSARY_SEVERITY
} from "./glossary-parser";
import { GLOSSARY_FRONTMATTER_KEY } from "./glossary-resolver";
import { PUBLISH_KEY_ROLES, type PublishKeyMap } from "./publish-index";

/** What a set may put in a note: YAML scalars, and lists of them. */
export type PropertyValue = string | number | boolean | null | (string | number | boolean)[];

export interface PropertyEntry {
  key: string;
  value: PropertyValue;
}

export interface PropertySet {
  /** Stable across loads: the built-in's id, or the set note's path. */
  id: string;
  name: string;
  source: "schreibstube" | "folder";
  entries: PropertyEntry[];
  /** The note's frontmatter holds Templater code, rendered when applied. */
  templater: boolean;
  /** The keys whose adding by hand offers the rest of the set; any of its
   *  keys when absent. */
  offeredBy?: readonly string[];
}

/** A set note is a template, not a data store; these bound a hand-edited one. */
export const MAX_SET_KEYS = 50;
export const MAX_SET_NOTES = 200;
const MAX_KEY_LENGTH = 100;
const MAX_STRING_VALUE = 2000;
const MAX_LIST_ITEMS = 50;

/** Templater's tag, in any of its forms: `<% %>`, `<%* %>`, `<%+ %>`, trimmed. */
const TEMPLATER_TAG = /<%[\s\S]*?%>/;

/** Schreibstube's own features, as sets. Built from the keys each reads. */
export const BUILTIN_SETS: readonly PropertySet[] = [
  builtin("mail", "mail", [
    { key: FM_TO, value: [] },
    { key: FM_CC, value: [] },
    { key: FM_SUBJECT, value: "" }
  ]),
  builtin("sync", "sync", [
    { key: SYNC_FRONTMATTER_KEY, value: "" },
    { key: SYNC_EVERY_KEY, value: "" }
  ]),
  builtin("print", "print", [{ key: NOTE_TEMPLATE_KEY, value: "" }]),
  builtin("glossary-note", "glossaryNote", [
    { key: GLOSSARY_MARKER, value: true },
    { key: GLOSSARY_LANGUAGE_KEY, value: DEFAULT_GLOSSARY_LANGUAGE },
    { key: GLOSSARY_SEVERITY_KEY, value: DEFAULT_GLOSSARY_SEVERITY }
  ]),
  builtin("glossaries", "glossaries", [{ key: GLOSSARY_FRONTMATTER_KEY, value: [] }])
];

/**
 * Publishing, as a set: every key the publish settings map, under the names
 * the person chose, so a role added there cannot be missing here. The flag
 * starts false, because the set prepares a note and ticking the flag is the
 * decision to publish it. The keys a run writes back come empty, which reads
 * as never published until a run fills them in.
 *
 * Title, date, description and slug are names most vaults use for their own
 * ends, so a person adding one of them is no sign of publishing; only the flag
 * offers the rest, or a diary entry given a date would be offered a website.
 */
export function publishSet(keys: PublishKeyMap): PropertySet {
  return {
    ...builtin(
      "publish",
      "publish",
      PUBLISH_KEY_ROLES.map((role) => ({
        key: keys[role],
        value: role === "published" ? false : ""
      }))
    ),
    offeredBy: [keys.published]
  };
}

/** Every set of Schreibstube's own, publishing's under the configured keys. */
export function builtinSets(publishKeys: PublishKeyMap): PropertySet[] {
  return [...BUILTIN_SETS, publishSet(publishKeys)];
}

/** The name key a built-in set is shown under; the caller translates it. */
export type BuiltinSetName = "mail" | "sync" | "print" | "glossaryNote" | "glossaries" | "publish";

function builtin(id: string, name: BuiltinSetName, entries: PropertyEntry[]): PropertySet {
  return { id: `schreibstube:${id}`, name, source: "schreibstube", entries, templater: false };
}

export function isFolderSetPath(path: string, folder: string): boolean {
  return folder.length > 0 && path.endsWith(".md") && path.startsWith(`${folder}/`);
}

/** The frontmatter block of a note's text, without its fences, or null. */
export function frontmatterBlock(text: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match) return match[1] ?? "";
  // An empty block: the two fences with nothing between them.
  return /^---\r?\n---(?:\r?\n|$)/.test(text) ? "" : null;
}

export function hasTemplaterCode(text: string): boolean {
  return TEMPLATER_TAG.test(text);
}

/** A stand-in Templater tag that is still a tag and is valid YAML wherever the
 *  real one stood. */
const MASKED_TAG = "<%%>";

/**
 * The block with every Templater tag replaced by an empty one, so it can be
 * read as YAML to list the set's keys without running anything. A value that
 * held code still holds a tag, which `withoutTemplaterCode` finds. Code whose
 * removal leaves the YAML invalid — a `<%* %>` block on a line of its own —
 * fails to parse, and the set is then rendered or refused, never guessed.
 */
export function maskTemplaterCode(block: string): string {
  return block.replace(new RegExp(TEMPLATER_TAG.source, "g"), MASKED_TAG);
}

/** A key a set may carry: what Obsidian would accept as a property name. */
export function validKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_KEY_LENGTH && !CONTROL_CHARS.test(trimmed);
}

/** A value from a set note, as untrusted YAML: scalars and flat lists of them,
 *  bounded; anything else is refused rather than guessed at. */
export function readValue(value: unknown): { ok: true; value: PropertyValue } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number")
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value === "string") {
    return value.length <= MAX_STRING_VALUE ? { ok: true, value } : { ok: false };
  }
  if (value instanceof Date) return { ok: true, value: value.toISOString().slice(0, 10) };
  if (Array.isArray(value)) {
    if (value.length > MAX_LIST_ITEMS) return { ok: false };
    const items: (string | number | boolean)[] = [];
    for (const item of value) {
      const read = readValue(item);
      if (!read.ok || read.value === null || Array.isArray(read.value)) return { ok: false };
      items.push(read.value);
    }
    return { ok: true, value: items };
  }
  return { ok: false };
}

export interface SetParseResult {
  set: PropertySet | null;
  /** Keys that were left out, and why, for one line per set in a notice or log. */
  skipped: string[];
}

/**
 * A set note's frontmatter, already parsed as YAML, as a set.
 *
 * `templater` says whether the block held Templater code; such a set is
 * listed from its unrendered text and rendered when it is applied, because a
 * value like `tp.file.title` depends on the note it goes into.
 */
export function setFromFrontmatter(
  path: string,
  name: string,
  parsed: unknown,
  templater: boolean
): SetParseResult {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { set: null, skipped: [] };
  }
  const entries: PropertyEntry[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!validKey(key) || seen.has(key.toLowerCase())) {
      skipped.push(rawKey);
      continue;
    }
    if (entries.length >= MAX_SET_KEYS) {
      skipped.push(key);
      continue;
    }
    const value = readValue(rawValue);
    if (!value.ok) {
      skipped.push(key);
      continue;
    }
    seen.add(key.toLowerCase());
    entries.push({ key, value: value.value });
  }
  if (entries.length === 0) return { set: null, skipped };
  return { set: { id: path, name, source: "folder", entries, templater }, skipped };
}

/** The empty form of a value whose Templater code could not be run: a list
 *  stays a list, anything else becomes empty, never the raw code. */
export function withoutTemplaterCode(entries: PropertyEntry[]): {
  entries: PropertyEntry[];
  blanked: string[];
} {
  const blanked: string[] = [];
  const clean = entries.map((entry) => {
    const holds = Array.isArray(entry.value)
      ? entry.value.some((item) => typeof item === "string" && hasTemplaterCode(item))
      : typeof entry.value === "string" && hasTemplaterCode(entry.value);
    if (!holds) return entry;
    blanked.push(entry.key);
    return { key: entry.key, value: Array.isArray(entry.value) ? [] : null };
  });
  return { entries: clean, blanked };
}

export interface SetPlan {
  add: PropertyEntry[];
  /** Keys the note already had, left exactly as they were. */
  kept: string[];
}

/** What applying a set to a note would do. Keys compare ignoring case, as
 *  Obsidian treats `Status` and `status` as one property. */
export function planPropertySet(
  frontmatter: Record<string, unknown> | null | undefined,
  set: Pick<PropertySet, "entries">
): SetPlan {
  const present = new Set(Object.keys(frontmatter ?? {}).map((key) => key.toLowerCase()));
  const add: PropertyEntry[] = [];
  const kept: string[] = [];
  for (const entry of set.entries) {
    if (present.has(entry.key.toLowerCase())) kept.push(entry.key);
    else add.push(entry);
  }
  return { add, kept };
}

/** Apply a plan to the frontmatter object Obsidian hands `processFrontMatter`.
 *  Re-checks each key there: the note may have changed since the plan. */
export function applyPlan(frontmatter: Record<string, unknown>, plan: SetPlan): string[] {
  const present = new Set(Object.keys(frontmatter).map((key) => key.toLowerCase()));
  const added: string[] = [];
  for (const entry of plan.add) {
    if (present.has(entry.key.toLowerCase())) continue;
    frontmatter[entry.key] = Array.isArray(entry.value) ? [...entry.value] : entry.value;
    present.add(entry.key.toLowerCase());
    added.push(entry.key);
  }
  return added;
}

/** Keys in `after` that were not in `before`, ignoring case. */
export function newKeys(before: readonly string[], after: readonly string[]): string[] {
  const had = new Set(before.map((key) => key.toLowerCase()));
  return after.filter((key) => !had.has(key.toLowerCase()));
}

/**
 * The sets a newly added key belongs to that the note has not finished: each
 * with the keys it still lacks. A set is only offered when the key that was
 * just added is one that offers it and something of it is still missing.
 */
export function setsToComplete(
  sets: readonly PropertySet[],
  added: readonly string[],
  frontmatter: Record<string, unknown> | null | undefined
): { set: PropertySet; missing: string[] }[] {
  const addedKeys = new Set(added.map((key) => key.toLowerCase()));
  const out: { set: PropertySet; missing: string[] }[] = [];
  for (const set of sets) {
    if (set.entries.length < 2) continue;
    const offeredBy = set.offeredBy ?? set.entries.map((entry) => entry.key);
    if (!offeredBy.some((key) => addedKeys.has(key.toLowerCase()))) continue;
    const missing = planPropertySet(frontmatter, set).add.map((entry) => entry.key);
    if (missing.length > 0) out.push({ set, missing });
  }
  return out;
}
