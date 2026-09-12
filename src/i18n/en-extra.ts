/**
 * The rest of the reference catalogue: everything outside publishing and mail.
 *
 * Split from `en.ts` only for length. The two objects are merged into one
 * catalogue, and German has to satisfy the merged shape.
 */
export const enExtra = {
  settings: {
    overlayHeading: "Heading stack",
    overlayEnabled: "Enable heading stack overlay",
    overlayEnabledDesc:
      "Show the sticky ancestor-heading breadcrumb at the top of the active note.",

    focusHeading: "Focus mode",
    focusOpacity: "Dim opacity",
    focusOpacityDesc:
      "Opacity of out-of-focus lines in focus mode (0.2 = very faint, 0.8 = nearly full).",

    aiHeading: "AI models",
    aiIntro: "Provider, model, and API key shared by every AI command (rename and summarize).",
    provider: "LLM provider",
    model: "Model",
    customModel: "Custom model ID",
    customModelDesc: "Optional. Overrides the model above — use for a newer or unlisted model.",
    customModelPlaceholder: "e.g. claude-3-7-sonnet-latest",
    apiKey: "API key",
    apiKeyDesc: "Select a secret from Obsidian's secret storage, or create a new one.",

    renameHeading: "Rename file from content",
    renameImageSize: "Max image size",
    renameImageSizeDesc:
      "Images are resized to this maximum dimension (px) before being sent. Smaller is cheaper " +
      "and faster.",
    renameMinChars: "Minimum content length",
    renameMinCharsDesc:
      "The rename command does nothing if the note has fewer characters than this.",
    renameMaxChars: "Maximum content sent to LLM",
    renameMaxCharsDesc: "Number of characters from the beginning of the note sent to the LLM.",
    renameMaxFilename: "Maximum filename length",
    renameMaxFilenameDesc: "Generated filename will be truncated to this many characters.",

    summarizeHeading: "Summarize selection",
    summarizeIntro:
      "The Summarize selection command sends the selected text to the LLM and replaces it with " +
      "the result. It uses the shared AI model configured above.",
    summarizePrompt: "Summarize prompt",
    summarizePromptDesc:
      "System instruction that tells the LLM how to summarize the selection. Leave blank to " +
      "restore the default.",
    summarizeTokens: "Maximum response tokens",
    summarizeTokensDesc: (min: number, max: number) =>
      `Upper bound on the length of the generated summary (${min}–${max}).`,

    proofreadHeading: "Proofreading",
    proofreadIntro:
      "Used by the proof-read sidebar. Corrections are proposed one by one and applied only when " +
      "you accept them.",
    proofreadPrompt: "Proofread prompt",
    proofreadPromptDesc:
      "System instruction for the correction pass. Leave empty to restore the default.",
    proofreadTokens: "Maximum response tokens",
    proofreadTokensDesc:
      "Upper bound per request. The actual budget follows the size of each chunk.",
    proofreadChunk: "Characters per request",
    proofreadChunkDesc: "Smaller chunks show the first suggestions sooner but cost more requests.",
    proofreadConcurrency: "Parallel requests",
    proofreadConcurrencyDesc: "How many chunks are in flight at once.",

    glossaryHeading: "Glossary",
    glossaryIntro:
      "A glossary is a note with schreibstubeGlossary: true in its frontmatter and a term table. " +
      "Glossary checks run locally and need no API key.",
    glossaryDefault: "Default glossaries",
    glossaryDefaultDesc: "Vault paths, one per line. Used when nothing more specific applies.",
    glossaryRules: "Folder rules",
    glossaryRulesDesc: "One rule per line: folder | glossary path. The first match wins.",
    glossaryUnderline: "Underline glossary hits in the editor",
    glossaryUnderlineDesc:
      "Marks error-severity terms as you write. Off by default to keep long notes quiet.",

    syncHeading: "Document sync",
    syncIntro:
      "Bind a note to a remote Markdown file by adding schreibstubeSyncedFrom: <url> to its " +
      "frontmatter. The source is the single truth: incoming changes are proposed as cards in " +
      "the review sidebar, and nothing is ever pushed back.",
    syncEnabled: "Enable document sync",
    syncEnabledDesc: "Off by default. Bound notes are ignored entirely until this is on.",
    syncOnOpen: "Check when a bound note opens",
    syncOnOpenDesc:
      "Also check automatically on open, subject to the interval below. Otherwise only on command.",
    syncInterval: "Minimum minutes between automatic checks",
    syncIntervalDesc: "Per note. Zero checks on every open. A manual check always runs.",
    syncToken: "GitHub token",
    syncTokenDesc:
      "Optional. Needed for sources in a private repository, and it raises GitHub's rate limit. " +
      "Stored in Obsidian's secret storage.",
    syncPoll: "Poll all bound notes in the background",
    syncPollDesc:
      "Checks every bound note on a schedule, not just the one you have open. Changes are " +
      "counted and surface as cards when you next open the note.",
    syncSchedule: "Schedule",
    syncScheduleDesc: (examples: string) =>
      "Five cron fields: minute, hour, day of month, month, day of week. Evaluated in local " +
      `time. A schedule that came due while Obsidian was closed runs once on the next start. ` +
      `Examples: ${examples}.`,
    syncNextRun: (when: string) => `Next check: ${when}`,
    syncNeverRuns: "Valid, but this moment never comes."
  },

  ai: {
    busy: "an AI command is already running — please wait.",
    noNote: "no note open in the editor.",
    selectText: "select some text to summarize first.",
    summarizing: "summarizing…",
    summarizeFailed: "summarize failed — the LLM returned an empty response.",
    renameFailedName: "rename failed — the LLM returned an unusable filename.",
    renameFailedExists: "rename failed — a file with that name may already exist.",
    imageTooLarge: "image exceeds the 10 MB limit.",
    unsupportedImage: "unsupported format — supported image types: jpg, png, gif, webp.",
    failRename: "Schreibstube: rename failed",
    failImage: "Schreibstube: could not process image",
    failSummarize: "Schreibstube: summarize failed"
  },

  proofread: {
    busy: "a correction is already running.",
    noteClosed: "the checked note is no longer open.",
    spotGone: "spot no longer findable.",
    failed: (reason: string) => `correction failed — ${reason}`,
    panelTitle: "Schreibstube: proofreading",
    panelNoNote: "No note open",
    panelIdle: "No open suggestions.",
    panelRunning: "Running …",
    panelSection: (done: number, total: number) => `Section ${done} of ${total}`,
    panelGlossaryMissing: (path: string) => `Glossary not found: ${path}`,
    panelNoGlossary: "No glossary note in the vault.",
    panelSource: (status: string) => `Source (${status})`,
    panelGlossary: (source: string) => `Glossary (${source})`,
    panelCheckedAt: (when: string) => `Last checked: ${when}`,
    badgeGlossary: "Glossary",
    badgeSource: "Source",
    badgeStale: "stale",
    badgeInflection: "check inflection",
    categories: {
      spelling: "Spelling",
      grammar: "Grammar",
      punctuation: "Punctuation",
      style: "Style",
      terminology: "Terminology",
      capitalization: "Capitalisation",
      update: "Update"
    } as Record<string, string>,
    syncStatus: {
      none: "not bound",
      idle: "bound",
      checking: "checking",
      clean: "up to date",
      diverged: "changed locally",
      unsynced: "never synced",
      missing: "not found",
      error: "error"
    } as Record<string, string>,
    glossarySource: {
      frontmatter: "from this note",
      folder: "from a folder rule",
      session: "chosen manually",
      default: "default",
      none: "none"
    } as Record<string, string>,
    accept: "Accept",
    reject: "Discard",
    show: "Show",
    acceptAll: (count: number) => `Accept all (${count})`
  },

  sync: {
    notBound: "this note is not bound to a source.",
    noneChecked: "no bound notes were checked.",
    checked: (checked: number, changed: number, failed: number) =>
      `${checked} checked, ${changed} with updates, ${failed} failed.`,
    withUpdates: (count: number) => `${count} note(s) have updates from their source.`
  },

  mailNotices: {
    busy: "a mail command is already running — please wait.",
    noBody: "the note has no body to send.",
    noCriteria: "enter at least one search criterion.",
    noMessages: "no messages matched.",
    noReplies: "no new replies.",
    sending: "sending…",
    searching: "searching mailbox…",
    merged: (count: number) => `merged ${count} new message(s).`,
    needsMessageId: (key: string) => `this note has no ${key} — send it as an email first.`,
    needsEditor: "open a note in editing mode to insert the message.",
    needsRecipient: (key: string) => `add a "${key}:" recipient to the note's frontmatter first.`,
    invalidRecipient: (addresses: string) => `not a valid email address: ${addresses}`,
    needsSubject: (key: string) => `add a "${key}:" line to the note's frontmatter first.`,
    sent: "email sent.",
    sentNoCopy: "email sent (no copy filed in Sent).",
    failSend: "Schreibstube: send failed",
    failSearch: "Schreibstube: mailbox search failed",
    failMerge: "Schreibstube: merging replies failed"
  },

  secrets: {
    notSelected: (label: string) => `no ${label} selected — open Settings to choose one.`,
    notFound: (label: string) => `${label} not found — check Settings.`,
    apiKey: "API key",
    mailToken: "mail token",
    publishToken: "publish token",
    githubToken: "GitHub token"
  }
};
