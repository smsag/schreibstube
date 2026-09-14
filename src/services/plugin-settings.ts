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
import { LATEST_COUNT_DEFAULT, LATEST_COUNT_MAX } from "./latest-files";
import { LLM_PROVIDER_IDS, PROVIDER_MODELS } from "./llm-providers";
import { DEFAULT_PUBLISH_KEYS, normalizePublishKeys } from "./publish-index";
import { TEMPLATE_ROOT_DEFAULT } from "./print-template";

export { PROVIDER_MODELS } from "./llm-providers";

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
  explorerLatestEnabled: true,
  explorerLatestCount: LATEST_COUNT_DEFAULT,
  explorerLatestExcluded: "",
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
  remindersEnabled: false,
  remindersList: "",
  remindersShortcut: DEFAULT_REMINDERS_SHORTCUT,
  debugLogging: false
};

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
    debugLogging:
      typeof loaded?.debugLogging === "boolean"
        ? loaded.debugLogging
        : DEFAULT_SETTINGS.debugLogging,
    renameMinContentChars: positiveIntOrDefault(
      loaded?.renameMinContentChars,
      DEFAULT_SETTINGS.renameMinContentChars
    ),
    renameMaxContentChars: positiveIntOrDefault(
      loaded?.renameMaxContentChars,
      DEFAULT_SETTINGS.renameMaxContentChars
    ),
    renameMaxFilenameLength: positiveIntOrDefault(
      loaded?.renameMaxFilenameLength,
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
    explorerLatestEnabled:
      typeof loaded?.explorerLatestEnabled === "boolean"
        ? loaded.explorerLatestEnabled
        : DEFAULT_SETTINGS.explorerLatestEnabled,
    explorerLatestCount: clampIntOrDefault(
      loaded?.explorerLatestCount,
      1,
      LATEST_COUNT_MAX,
      DEFAULT_SETTINGS.explorerLatestCount
    ),
    explorerLatestExcluded:
      typeof loaded?.explorerLatestExcluded === "string"
        ? loaded.explorerLatestExcluded
        : DEFAULT_SETTINGS.explorerLatestExcluded,
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
    remindersEnabled: loaded?.remindersEnabled === true,
    remindersList: trimmedStringOrDefault(loaded?.remindersList, DEFAULT_SETTINGS.remindersList),
    remindersShortcut: trimmedStringOrDefault(
      loaded?.remindersShortcut,
      DEFAULT_SETTINGS.remindersShortcut
    )
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
      writeBack: record.writeBack !== false
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
    const { hash, etag, checkedAt, pendingChanges, remoteHash, changedAt } =
      record as Partial<SyncRecord>;
    if (typeof hash !== "string" || hash.length === 0) continue;
    result[path] = {
      hash,
      etag: typeof etag === "string" ? etag : "",
      checkedAt: Number.isFinite(checkedAt) ? Number(checkedAt) : 0,
      pendingChanges: Number.isFinite(pendingChanges) ? Number(pendingChanges) : 0,
      ...(typeof remoteHash === "string" && remoteHash.length > 0 ? { remoteHash } : {}),
      ...(Number.isFinite(changedAt) ? { changedAt: Number(changedAt) } : {})
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

function positiveIntOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function clampIntOrDefault(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
