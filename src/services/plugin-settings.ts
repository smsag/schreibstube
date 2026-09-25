import type {
  ExplorerForeignMenu,
  LlmProvider,
  PublishAccount,
  PublishRunRecord,
  SchreibstubeSettings
} from "../types";
import type { LanguagePreference } from "../i18n";
import type { SyncRecord } from "./sync-document";
import {
  DEFAULT_SETTINGS as DEFAULT_FOCUS_SETTINGS,
  normalizeFocusSettings
} from "./focus-settings";
import { BOOKMARK_FILE_DEFAULT } from "./bookmark-file";
import { LLM_PROVIDER_IDS, PROVIDER_MODELS } from "./llm-providers";
import { DEFAULT_PUBLISH_KEYS, normalizeHeaderTags, normalizePublishKeys } from "./publish-index";
import { DEFAULT_TEMPLATE_BUILTIN, TEMPLATE_ROOT_DEFAULT } from "./print-template";
import { DEFAULT_REPORT_FILE } from "./reminder-status";
import { normalizePropertyIcons } from "./property-icons";
import { DEFAULT_DATE_FORMAT, normalizeDateFormat } from "./today-value";

export { PROVIDER_MODELS } from "./llm-providers";

/** What the rename command may be told about a note's length and its name. */
export const MIN_RENAME_CONTENT_CHARS = 1;
export const MAX_RENAME_CONTENT_CHARS = 100_000;
export const MIN_FILENAME_LENGTH = 10;
export const MAX_FILENAME_LENGTH = 255;

export const MIN_IMAGE_PX = 256;
export const MAX_IMAGE_PX = 2048;

export const MIN_SUMMARY_TOKENS = 64;
export const MAX_SUMMARY_TOKENS = 4096;

export const MIN_PROOFREAD_TOKENS = 256;
export const MAX_PROOFREAD_TOKENS = 8192;

/** Characters of prose per request. Small chunks give earlier cards but cost
 *  more requests; large ones risk the model's attention drifting late in a
 *  long stretch of text. */
export const MIN_CHUNK_CHARS = 500;
export const MAX_CHUNK_CHARS = 6000;

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 4;

/** Floor between automatic source checks for one note, so opening a mirror
 *  repeatedly does not hammer the source. */
export const MIN_SYNC_INTERVAL_MINUTES = 0;
export const MAX_SYNC_INTERVAL_MINUTES = 120;
export const MIN_MAIL_RESULTS = 1;
export const MAX_MAIL_RESULTS = 50;

/** Heading the "Fetch replies" command appends merged messages under. */
export const DEFAULT_MAIL_MERGE_HEADING = "Correspondence";

/** Default summarize prompt, tuned for turning raw text pasted from analytics
 *  and reporting tools into a compact insight-log entry. */
export const DEFAULT_SUMMARIZE_PROMPT =
  "You distill raw text into a concise insight log entry. The user pastes text " +
  "copied from an analytics or reporting tool. Rewrite it as Markdown bullet points — " +
  "one per distinct insight, using as many or as few as the content genuinely warrants: " +
  "a single line for a small or simple selection, more for a rich one. Never pad to reach " +
  "a count. Capture the key findings and takeaways, keeping concrete numbers, metrics, and " +
  "named entities. Drop UI labels, navigation, and boilerplate. Respond with the insight " +
  "only — no preamble, no closing remarks.";

/** Default proof-read prompt. Correction only: the instruction is deliberately
 *  narrow, because a prompt that also invites improvement produces rewrites the
 *  author has to argue with rather than corrections they can accept. */
export const DEFAULT_PROOFREAD_PROMPT =
  "Du bist Korrektor für deutschsprachige Fachtexte. Korrigiere Rechtschreibung, " +
  "Grammatik, Zeichensetzung und offensichtliche Stilfehler. Ändere niemals die " +
  "Aussage, den Ton oder die Fachbegriffe des Textes. Kürze nicht und ergänze nichts.";

/** The name the README tells a person to give the Shortcut, so the default works as is. */
export const DEFAULT_REMINDERS_SHORTCUT = "Schreibstube Reminder";
export const DEFAULT_REMINDERS_STATUS_SHORTCUT = "Schreibstube Reminder Status";

const ALLOWED_PROVIDERS = new Set<LlmProvider>(LLM_PROVIDER_IDS);

export const DEFAULT_SETTINGS: SchreibstubeSettings = {
  language: "auto",
  ...DEFAULT_FOCUS_SETTINGS,
  overlayEnabled: true,
  llmProvider: "anthropic",
  llmModel: "claude-haiku-4-5-20251001",
  llmModelCustom: "",
  llmSecretName: "",
  renameMinContentChars: 50,
  renameMaxContentChars: 4000,
  renameMaxFilenameLength: 60,
  renameMaxImagePx: 768,
  summarizePrompt: DEFAULT_SUMMARIZE_PROMPT,
  summarizeMaxTokens: 512,
  proofreadPrompt: DEFAULT_PROOFREAD_PROMPT,
  proofreadMaxTokens: 2048,
  proofreadChunkChars: 2000,
  proofreadConcurrency: 2,
  glossaryDefault: [],
  glossaryFolderRules: "",
  glossaryLiveUnderline: false,
  syncEnabled: false,
  syncCheckOnOpen: true,
  syncMinIntervalMinutes: 10,
  syncPollEnabled: false,
  syncPollCron: "0 * * * *",
  syncLastPollAt: 0,
  githubSecretName: "",
  syncState: {},
  explorerForeignMenu: "submenu",
  explorerBookmarksEnabled: true,
  explorerBookmarksFile: BOOKMARK_FILE_DEFAULT,
  explorerTaskCounts: false,
  iconShortcodes: true,
  mailBridgeUrl: "",
  mailTokenSecretName: "",
  mailFrom: "",
  mailMailbox: "INBOX",
  mailMaxResults: 25,
  mailMergeHeading: DEFAULT_MAIL_MERGE_HEADING,
  publishBridgeUrl: "",
  publishTokenSecretName: "",
  publishAccounts: [],
  publishFrontmatterKeys: DEFAULT_PUBLISH_KEYS,
  publishLastRun: {},
  printEnabled: false,
  printTemplateRoot: TEMPLATE_ROOT_DEFAULT,
  printOutputFolder: "",
  printDefaultTemplate: DEFAULT_TEMPLATE_BUILTIN,
  remindersEnabled: false,
  remindersList: "",
  remindersShortcut: DEFAULT_REMINDERS_SHORTCUT,
  remindersStatusShortcut: DEFAULT_REMINDERS_STATUS_SHORTCUT,
  remindersReportFile: DEFAULT_REPORT_FILE,
  propertyIcons: {},
  dateFormat: DEFAULT_DATE_FORMAT,
  debugLogging: false
};

/**
 * Keys an earlier version wrote into `data.json` and nothing reads any more:
 * the settings of the pane's former "Latest" section, whose count and
 * exclusions went with the lists they shaped.
 */
export const RETIRED_SETTING_KEYS: readonly string[] = [
  "explorerLatestEnabled",
  "explorerLatestCount",
  "explorerLatestExcluded"
];

/**
 * Whether the data file still holds a retired key, so the plugin writes it
 * once on load. `normalizeSettings` leaves such keys out, but only a save
 * takes them off the disk, and a person who never changes a setting might
 * never cause one.
 */
export function holdsRetiredSettings(loaded: unknown): boolean {
  if (!loaded || typeof loaded !== "object") return false;
  return RETIRED_SETTING_KEYS.some((key) => Object.prototype.hasOwnProperty.call(loaded, key));
}

/** Settings as persisted: a data file a user can also edit by hand, so every
 *  field is validated rather than trusted. */
type LoadedSettings = Partial<SchreibstubeSettings> | null | undefined;

export function normalizeSettings(loaded: LoadedSettings): SchreibstubeSettings {
  const focus = normalizeFocusSettings(loaded);

  const loadedProvider = loaded?.llmProvider ?? "";
  const provider: LlmProvider = ALLOWED_PROVIDERS.has(loadedProvider as LlmProvider)
    ? (loadedProvider as LlmProvider)
    : DEFAULT_SETTINGS.llmProvider;

  const providerModels = PROVIDER_MODELS[provider];
  const modelValues = providerModels.map((m) => m.value);
  const loadedModel = loaded?.llmModel ?? "";
  const model = modelValues.includes(loadedModel as string)
    ? (loadedModel as string)
    : providerModels[0].value;

  const loadedModelCustom = loaded?.llmModelCustom;
  const llmModelCustom =
    typeof loadedModelCustom === "string" ? loadedModelCustom : DEFAULT_SETTINGS.llmModelCustom;

  const loadedSecretName = loaded?.llmSecretName;
  const llmSecretName =
    typeof loadedSecretName === "string" ? loadedSecretName : DEFAULT_SETTINGS.llmSecretName;

  return {
    ...focus,
    language: languageOrDefault(loaded?.language),
    overlayEnabled:
      typeof loaded?.overlayEnabled === "boolean"
        ? loaded.overlayEnabled
        : DEFAULT_SETTINGS.overlayEnabled,
    llmProvider: provider,
    llmModel: model,
    llmModelCustom,
    llmSecretName,
    propertyIcons: normalizePropertyIcons(loaded?.propertyIcons),
    dateFormat: normalizeDateFormat(loaded?.dateFormat),
    debugLogging:
      typeof loaded?.debugLogging === "boolean"
        ? loaded.debugLogging
        : DEFAULT_SETTINGS.debugLogging,
    ...renameLimits(loaded),
    renameMaxFilenameLength: clampIntOrDefault(
      loaded?.renameMaxFilenameLength,
      MIN_FILENAME_LENGTH,
      MAX_FILENAME_LENGTH,
      DEFAULT_SETTINGS.renameMaxFilenameLength
    ),
    renameMaxImagePx: clampIntOrDefault(
      loaded?.renameMaxImagePx,
      MIN_IMAGE_PX,
      MAX_IMAGE_PX,
      DEFAULT_SETTINGS.renameMaxImagePx
    ),
    summarizePrompt: nonEmptyStringOrDefault(
      loaded?.summarizePrompt,
      DEFAULT_SETTINGS.summarizePrompt
    ),
    summarizeMaxTokens: clampIntOrDefault(
      loaded?.summarizeMaxTokens,
      MIN_SUMMARY_TOKENS,
      MAX_SUMMARY_TOKENS,
      DEFAULT_SETTINGS.summarizeMaxTokens
    ),
    proofreadPrompt: nonEmptyStringOrDefault(
      loaded?.proofreadPrompt,
      DEFAULT_SETTINGS.proofreadPrompt
    ),
    proofreadMaxTokens: clampIntOrDefault(
      loaded?.proofreadMaxTokens,
      MIN_PROOFREAD_TOKENS,
      MAX_PROOFREAD_TOKENS,
      DEFAULT_SETTINGS.proofreadMaxTokens
    ),
    proofreadChunkChars: clampIntOrDefault(
      loaded?.proofreadChunkChars,
      MIN_CHUNK_CHARS,
      MAX_CHUNK_CHARS,
      DEFAULT_SETTINGS.proofreadChunkChars
    ),
    proofreadConcurrency: clampIntOrDefault(
      loaded?.proofreadConcurrency,
      MIN_CONCURRENCY,
      MAX_CONCURRENCY,
      DEFAULT_SETTINGS.proofreadConcurrency
    ),
    glossaryDefault: stringListOrDefault(loaded?.glossaryDefault),
    glossaryFolderRules:
      typeof loaded?.glossaryFolderRules === "string"
        ? loaded.glossaryFolderRules
        : DEFAULT_SETTINGS.glossaryFolderRules,
    glossaryLiveUnderline:
      typeof loaded?.glossaryLiveUnderline === "boolean"
        ? loaded.glossaryLiveUnderline
        : DEFAULT_SETTINGS.glossaryLiveUnderline,
    syncEnabled:
      typeof loaded?.syncEnabled === "boolean" ? loaded.syncEnabled : DEFAULT_SETTINGS.syncEnabled,
    syncCheckOnOpen:
      typeof loaded?.syncCheckOnOpen === "boolean"
        ? loaded.syncCheckOnOpen
        : DEFAULT_SETTINGS.syncCheckOnOpen,
    syncMinIntervalMinutes: clampIntOrDefault(
      loaded?.syncMinIntervalMinutes,
      MIN_SYNC_INTERVAL_MINUTES,
      MAX_SYNC_INTERVAL_MINUTES,
      DEFAULT_SETTINGS.syncMinIntervalMinutes
    ),
    syncPollEnabled:
      typeof loaded?.syncPollEnabled === "boolean"
        ? loaded.syncPollEnabled
        : DEFAULT_SETTINGS.syncPollEnabled,
    syncPollCron: nonEmptyStringOrDefault(loaded?.syncPollCron, DEFAULT_SETTINGS.syncPollCron),
    syncLastPollAt: Number.isFinite(loaded?.syncLastPollAt) ? Number(loaded?.syncLastPollAt) : 0,
    githubSecretName:
      typeof loaded?.githubSecretName === "string"
        ? loaded.githubSecretName
        : DEFAULT_SETTINGS.githubSecretName,
    syncState: syncStateOrDefault(loaded?.syncState),
    explorerForeignMenu: foreignMenuOrDefault(loaded?.explorerForeignMenu),
    explorerBookmarksEnabled:
      typeof loaded?.explorerBookmarksEnabled === "boolean"
        ? loaded.explorerBookmarksEnabled
        : DEFAULT_SETTINGS.explorerBookmarksEnabled,
    explorerBookmarksFile: nonEmptyStringOrDefault(
      loaded?.explorerBookmarksFile,
      DEFAULT_SETTINGS.explorerBookmarksFile
    ),
    explorerTaskCounts: loaded?.explorerTaskCounts === true,
    // On unless switched off: the shortcode is the whole point of the icons
    // being in a note at all, and a setting nobody finds is a feature nobody has.
    iconShortcodes: loaded?.iconShortcodes !== false,
    mailBridgeUrl: trimmedStringOrDefault(loaded?.mailBridgeUrl, DEFAULT_SETTINGS.mailBridgeUrl),
    mailTokenSecretName:
      typeof loaded?.mailTokenSecretName === "string"
        ? loaded.mailTokenSecretName
        : DEFAULT_SETTINGS.mailTokenSecretName,
    mailFrom: trimmedStringOrDefault(loaded?.mailFrom, DEFAULT_SETTINGS.mailFrom),
    mailMailbox: nonEmptyStringOrDefault(loaded?.mailMailbox, DEFAULT_SETTINGS.mailMailbox),
    mailMaxResults: clampIntOrDefault(
      loaded?.mailMaxResults,
      MIN_MAIL_RESULTS,
      MAX_MAIL_RESULTS,
      DEFAULT_SETTINGS.mailMaxResults
    ),
    mailMergeHeading: nonEmptyStringOrDefault(
      loaded?.mailMergeHeading,
      DEFAULT_SETTINGS.mailMergeHeading
    ),
    publishBridgeUrl: trimmedStringOrDefault(
      loaded?.publishBridgeUrl,
      DEFAULT_SETTINGS.publishBridgeUrl
    ),
    publishTokenSecretName:
      typeof loaded?.publishTokenSecretName === "string"
        ? loaded.publishTokenSecretName
        : DEFAULT_SETTINGS.publishTokenSecretName,
    publishAccounts: publishAccountsOrDefault(loaded?.publishAccounts),
    publishFrontmatterKeys: normalizePublishKeys(loaded?.publishFrontmatterKeys),
    publishLastRun: publishRunsOrDefault(loaded?.publishLastRun),
    printEnabled: loaded?.printEnabled === true,
    printTemplateRoot: nonEmptyStringOrDefault(
      loaded?.printTemplateRoot,
      DEFAULT_SETTINGS.printTemplateRoot
    ),
    printOutputFolder: trimmedStringOrDefault(
      loaded?.printOutputFolder,
      DEFAULT_SETTINGS.printOutputFolder
    ),
    printDefaultTemplate: trimmedStringOrDefault(
      loaded?.printDefaultTemplate,
      DEFAULT_SETTINGS.printDefaultTemplate
    ),
    remindersEnabled: loaded?.remindersEnabled === true,
    remindersList: trimmedStringOrDefault(loaded?.remindersList, DEFAULT_SETTINGS.remindersList),
    remindersShortcut: trimmedStringOrDefault(
      loaded?.remindersShortcut,
      DEFAULT_SETTINGS.remindersShortcut
    ),
    remindersStatusShortcut: trimmedStringOrDefault(
      loaded?.remindersStatusShortcut,
      DEFAULT_SETTINGS.remindersStatusShortcut
    ),
    remindersReportFile: trimmedStringOrDefault(
      loaded?.remindersReportFile,
      DEFAULT_SETTINGS.remindersReportFile
    ).replace(/^\/+/, "")
  };
}

/**
 * Accounts are user-edited through the settings tab but live in the same data
 * file a user can open, so each entry is validated rather than trusted. An
 * entry without a folder or a target cannot publish anything and is dropped.
 */
function publishAccountsOrDefault(value: unknown): PublishAccount[] {
  if (!Array.isArray(value)) return [];

  const accounts: PublishAccount[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Partial<PublishAccount>;

    const folder = typeof record.folder === "string" ? record.folder.replace(/^\/+|\/+$/g, "") : "";
    const target = typeof record.target === "string" ? record.target.trim() : "";
    if (!folder || !target) continue;

    const id = typeof record.id === "string" && record.id ? record.id : `${target}:${folder}`;
    if (seen.has(id)) continue;
    seen.add(id);

    accounts.push({
      id,
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : folder,
      folder,
      target,
      writeBack: record.writeBack !== false,
      headerTags: normalizeHeaderTags(record.headerTags)
    });
  }

  return accounts;
}

/** Plugin-written, but it shares a file a user can edit, so it is validated. */
function publishRunsOrDefault(value: unknown): Record<string, PublishRunRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const runs: Record<string, PublishRunRecord> = {};
  for (const [id, record] of Object.entries(value as Record<string, unknown>)) {
    if (!record || typeof record !== "object") continue;
    const { at, written, deleted } = record as Partial<PublishRunRecord>;
    if (typeof at !== "string") continue;
    runs[id] = {
      at,
      written: typeof written === "number" ? written : 0,
      deleted: typeof deleted === "number" ? deleted : 0
    };
  }
  return runs;
}

/** Where the explorer pane puts other plugins' menu items. */
function foreignMenuOrDefault(value: unknown): ExplorerForeignMenu {
  return value === "submenu" || value === "inline" || value === "off"
    ? value
    : DEFAULT_SETTINGS.explorerForeignMenu;
}

function languageOrDefault(value: unknown): LanguagePreference {
  return value === "de" || value === "en" || value === "auto" ? value : DEFAULT_SETTINGS.language;
}

/** Sync state is plugin-written, but it lives in the same data file a user can
 *  edit, so every record is validated rather than trusted. */
function syncStateOrDefault(value: unknown): Record<string, SyncRecord> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, SyncRecord> = {};
  for (const [path, record] of Object.entries(value as Record<string, unknown>)) {
    if (!record || typeof record !== "object") continue;
    const { hash, etag, checkedAt, pendingChanges, remoteHash, changedAt, source } =
      record as Partial<SyncRecord>;
    if (typeof hash !== "string" || hash.length === 0) continue;
    result[path] = {
      hash,
      etag: typeof etag === "string" ? etag : "",
      checkedAt: Number.isFinite(checkedAt) ? Number(checkedAt) : 0,
      pendingChanges: Number.isFinite(pendingChanges) ? Number(pendingChanges) : 0,
      ...(typeof remoteHash === "string" && remoteHash.length > 0 ? { remoteHash } : {}),
      ...(Number.isFinite(changedAt) ? { changedAt: Number(changedAt) } : {}),
      ...(typeof source === "string" && source.length > 0 ? { source } : {})
    };
  }
  return result;
}

/** Glossary paths are persisted as an array; anything else in the data file is
 *  treated as unset rather than crashing the whole settings load. */
function stringListOrDefault(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

/** Optional free-text setting: an empty value is meaningful ("not configured"),
 *  so it is preserved rather than replaced by the default. */
function trimmedStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function nonEmptyStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/**
 * The two content limits, bounded and in order.
 *
 * Each was accepted on its own as any positive integer, so a minimum above
 * the maximum refused every note shorter than the minimum and truncated the
 * rest to the maximum — a setting that could not be satisfied, saved without
 * a word. A maximum below the minimum is now raised to meet it.
 */
function renameLimits(
  loaded: LoadedSettings
): Pick<SchreibstubeSettings, "renameMinContentChars" | "renameMaxContentChars"> {
  const min = clampIntOrDefault(
    loaded?.renameMinContentChars,
    MIN_RENAME_CONTENT_CHARS,
    MAX_RENAME_CONTENT_CHARS,
    DEFAULT_SETTINGS.renameMinContentChars
  );
  const max = clampIntOrDefault(
    loaded?.renameMaxContentChars,
    MIN_RENAME_CONTENT_CHARS,
    MAX_RENAME_CONTENT_CHARS,
    DEFAULT_SETTINGS.renameMaxContentChars
  );
  return { renameMinContentChars: min, renameMaxContentChars: Math.max(min, max) };
}

function clampIntOrDefault(value: unknown, min: number, max: number, fallback: number): number {
  const n = integerOf(value);
  return n === null ? fallback : Math.max(min, Math.min(max, n));
}

/**
 * The integer a stored value holds, or none.
 *
 * `Number(null)` is zero and `Number("")` is zero, so a key someone nulled by
 * hand in the data file used to pass as an integer and be clamped to the
 * floor — a proof-read at one request in flight and a summary of sixty-four
 * tokens, from a file that never said either. A number is a number; a numeric
 * string is read for a settings tab that stores what was typed; nothing else
 * is.
 */
function integerOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}
