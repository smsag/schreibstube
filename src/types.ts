import type { SyncRecord } from "./services/sync-document";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface HeadingEntry {
  level: HeadingLevel;
  text: string;
  lineNumber: number;
}

export type HeadingIndex = HeadingEntry[];

export type FocusMode = "off" | "sentence" | "paragraph";

export type LlmProvider = "anthropic" | "openai";

export interface SchreibstubeSettings {
  overlayEnabled: boolean;
  focusMode: FocusMode;
  focusDimOpacity: number;
  // Shared LLM configuration, used by every AI-backed command (rename, summarize).
  llmProvider: LlmProvider;
  llmModel: string;
  llmModelCustom: string;
  llmSecretName: string;
  // Rename-specific tuning.
  renameMinContentChars: number;
  renameMaxContentChars: number;
  renameMaxFilenameLength: number;
  renameMaxImagePx: number;
  // Summarize-specific tuning.
  summarizePrompt: string;
  summarizeMaxTokens: number;
  // Proofreading and the review sidebar.
  proofreadPrompt: string;
  proofreadMaxTokens: number;
  proofreadChunkChars: number;
  proofreadConcurrency: number;
  // Glossary selection. `glossaryDefault` is the vault-wide fallback and
  // `glossaryFolderRules` overrides it per folder; a note's own frontmatter
  // beats both. See services/glossary-resolver.
  glossaryDefault: string[];
  glossaryFolderRules: string;
  glossaryLiveUnderline: boolean;
  // Document sync. A note bound to a remote Markdown source mirrors it: the
  // source is the truth and nothing is ever pushed back.
  syncEnabled: boolean;
  syncCheckOnOpen: boolean;
  syncMinIntervalMinutes: number;
  /** Per-note sync state, keyed by vault path. Persisted, not user-editable. */
  syncState: Record<string, SyncRecord>;
  // Diagnostics.
  debugLogging: boolean;
}
