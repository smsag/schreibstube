import type { SyncRecord } from "./services/sync-document";
import type { PublishKeyMap } from "./services/publish-index";
import type { LanguagePreference } from "./i18n";
import type { NumberStyle } from "./services/amounts";
import type { ExchangeRates } from "./services/exchange-rates";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface HeadingEntry {
  level: HeadingLevel;
  text: string;
  lineNumber: number;
}

export type HeadingIndex = HeadingEntry[];

export type FocusMode = "off" | "sentence" | "paragraph";

export type LlmProvider = "anthropic" | "openai";

/** One hosting account: a vault folder published to a target on the bridge. */
export interface PublishAccount {
  /** Stable id, so renaming the folder does not orphan the entry. */
  id: string;
  name: string;
  folder: string;
  target: string;
  /** Write the published time and URL back into each note's frontmatter. */
  writeBack: boolean;
  /** Up to three tags linked from the site's header, each to a page of its notes. */
  headerTags: string[];
}

/** The summary of one publish, kept so the settings can show it afterwards. */
export interface PublishRunRecord {
  at: string;
  written: number;
  deleted: number;
}

export type ExplorerForeignMenu = "submenu" | "inline" | "off";

export interface SchreibstubeSettings {
  /** Interface language; "auto" follows Obsidian's own. */
  language: LanguagePreference;
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
  // Picture descriptions: a vision model's words for a picture, kept as a note.
  imageDescriptionsEnabled: boolean;
  imageDescriptionFolder: string;
  imageDescriptionLanguage: "auto" | "de" | "en";
  imageDescriptionKeywordsAsTags: boolean;
  /** Whether the Explorer shows description notes, or folds them into their pictures. */
  explorerDescriptionNotes: "hide" | "show";
  /** Where the Recommended panel follows the open note: the right sidebar, or under the note. */
  recommendedPlacement: "sidebar" | "footer";
  /** How many recommendations the panel shows, of every kind together. */
  recommendedCount: number;
  /** Search by meaning: the on-device semantic index of the vault's notes. */
  semanticSearchEnabled: boolean;
  /** How many notes the semantic index holds at most, newest first. */
  semanticMaxNotes: number;
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
  // A folder of one note per term (the glossary Pythia writes), read as one
  // more glossary that joins the default. See services/glossary-term-folder.
  glossaryTermFolder: string;
  // Document sync. A note bound to a remote Markdown source mirrors it: the
  // source is the truth and nothing is ever pushed back.
  syncEnabled: boolean;
  syncCheckOnOpen: boolean;
  syncMinIntervalMinutes: number;
  /** Background poll across every bound note, scheduled with a cron expression. */
  syncPollEnabled: boolean;
  syncPollCron: string;
  /** Epoch ms of the last completed poll, so a schedule missed while Obsidian
   *  was closed can be caught up once on load. */
  syncLastPollAt: number;
  /**
   * Where the explorer pane puts menu items contributed by other plugins:
   * behind one "more actions" entry, inline at the end, or nowhere.
   */
  explorerForeignMenu: ExplorerForeignMenu;
  /** Show the bookmarks section above the file tree. */
  explorerBookmarksEnabled: boolean;
  /** Vault path of the Markdown file the bookmarks are read from. The plugin
   *  never writes it: a person edits it like any other note. */
  explorerBookmarksFile: string;
  /** Show "open / total" tasks after a note's name in the file pane. */
  explorerTaskCounts: boolean;
  /** Draw `:folder:` in a note as the icon, and offer the icons while one is typed. */
  iconShortcodes: boolean;
  /** Secret-storage name of a GitHub token, for private repositories. */
  githubSecretName: string;
  /** Per-note sync state, keyed by vault path. Persisted, not user-editable. */
  syncState: Record<string, SyncRecord>;
  // Email bridge configuration, shared by every mail command.
  mailBridgeUrl: string;
  mailTokenSecretName: string;
  mailFrom: string;
  mailMailbox: string;
  mailMaxResults: number;
  mailMergeHeading: string;
  // Publishing. The bridge holds the SFTP credentials; the plugin stores a
  // target name and a token, so no key material enters the vault.
  publishBridgeUrl: string;
  publishTokenSecretName: string;
  publishAccounts: PublishAccount[];
  /** Which frontmatter key carries which meaning, so a vault can keep its own
   *  conventions instead of adopting the plugin's. */
  publishFrontmatterKeys: PublishKeyMap;
  /** What each account last published, keyed by account id. Plugin-written. */
  publishLastRun: Record<string, PublishRunRecord>;
  /**
   * Whether printing is switched on.
   *
   * Off until a person says otherwise, because switching it on is what fetches
   * the typesetter: 28 MB onto a device, possibly over mobile data. Nobody
   * should pay that for a feature they have not asked for.
   */
  printEnabled: boolean;
  /** Vault folder holding the print templates. */
  printTemplateRoot: string;
  /** Where a printed PDF is written; empty means beside the note. */
  printOutputFolder: string;
  /**
   * The template a note that names none is printed with: empty for the
   * built-in `Standard`, `:ask` for the picker, or a vault template's folder.
   */
  printDefaultTemplate: string;
  /** Icon name per frontmatter key, lower-cased; drawn in place of the type icon. */
  propertyIcons: Record<string, string>;
  /** Moment format for today's date entered into text. Date properties always get ISO. */
  dateFormat: string;
  /** Every note in this folder is a property set (services/property-sets). */
  propertySetFolder: string;
  /** Show "Suggest tags" beside "Add property"; the command works either way. */
  tagSuggestControl: boolean;
  /** How an ambiguous number like 1.234 is read, and results written; "auto" follows Obsidian. */
  sumsNumberStyle: NumberStyle;
  /** ISO code bare numbers count in and mixed currencies convert into; "" for none. */
  sumsDefaultCurrency: string;
  /** Convert mixed currencies at the ECB's rates. Off until chosen: it is a network call. */
  sumsConvert: boolean;
  /** The last rates fetched, kept between sessions. Plugin-written. */
  sumsRates: ExchangeRates | null;
  // Diagnostics.
  debugLogging: boolean;
}
