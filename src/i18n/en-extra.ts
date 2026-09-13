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

    explorerHeading: "Schreibstube Explorer",
    explorerIntro:
      "Schreibstube's own file list: an icon per file and folder, a sync mark on notes bound " +
      "to a source, and a pinned block at the top of each folder. Open it with the " +
      '"Open Schreibstube Explorer" command.',
    explorerForeign: "Items from other plugins",
    explorerForeignDesc:
      "The pane fires Obsidian's file-menu event, so other plugins can contribute. Keeping " +
      "them behind one entry is what stops the menu turning into a list of unrelated blocks.",
    explorerForeignSubmenu: 'Behind "More actions"',
    explorerForeignInline: "At the end of the menu",
    explorerForeignOff: "Not at all",
    explorerBookmarks: "Bookmarks section",
    explorerBookmarksDesc:
      "A list of links above the file tree: web pages, Obsidian URIs, vault folders and notes. " +
      "The pane only reads the file, so links are added by editing it.",
    explorerBookmarksFile: "Bookmarks file",
    explorerBookmarksFileDesc:
      "Vault path of the Markdown file the bookmarks are read from. A heading is a folder, a " +
      "list item is a link.",
    explorerLatest: "Latest section",
    explorerLatestDesc:
      "Two short lists between the bookmarks and the tree: the notes most recently created, and " +
      "those most recently changed. A note shown as created is not repeated as changed.",
    explorerLatestCount: "Notes per list",
    explorerLatestCountDesc: (max: number) =>
      `How many notes each of the two lists shows (1 to ${max}).`,
    explorerLatestExclude: "Never show these",
    explorerLatestExcludeDesc:
      "Vault paths, separated by commas or line breaks. A folder excludes everything inside it. " +
      "The bookmarks file is always excluded.",
    explorerIcons: "Icon set",
    explorerIconsDesc: (count: number, version: string) =>
      `${count} icons from Tabler Icons ${version} (MIT), bundled with the plugin so they work offline and on mobile.`,

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

    printHeading: "Printing",
    printIntro: (typst: string) =>
      `A note becomes a PDF through a template: a folder holding a template.md that says what the ` +
      `template needs, a template.typ that lays the page out, and its fonts. Typesetting is done on ` +
      `the device by Typst ${typst}, so printing works offline and on a phone. The typesetter is ` +
      "fetched once per device the first time you print. Copy a template from examples/print/ to start.",
    printTemplateRoot: "Templates folder",
    printTemplateRootDesc:
      "Vault folder searched for print templates. Every subfolder with a template.md marked " +
      "schreibstubePrintTemplate is one.",
    printOutputFolder: "Output folder",
    printOutputFolderDesc:
      "Where a printed PDF is written. Leave empty to put it beside the note it came from.",
    printOutputBesideNote: "beside the note",
    commandsHeading: "Commands",
    commandsIntro: 'In the command palette, each one prefixed with "Schreibstube: ".',

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
    syncIntervalDesc:
      "Per note. Zero checks on every open. A manual check always runs. A note that carries " +
      'schreibstubeSyncEvery — "every 2 days", "weekly", or a cron expression — keeps to its ' +
      "own interval instead of this one.",
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
    renameTooShort: "this note is too short to be named from its content.",
    cannotName: "only a note or a picture can be named from what is inside it.",
    renameFailedExists: "rename failed — a file with that name may already exist.",
    imageTooLarge: "image exceeds the 10 MB limit.",
    unsupportedImage: "unsupported format — supported image types: jpg, png, gif, webp.",
    failRename: "Schreibstube: rename failed",
    failImage: "Schreibstube: could not process image",
    failSummarize: "Schreibstube: summarize failed"
  },

  cron: {
    empty: "No expression given.",
    fieldCount: (found: number) =>
      `Five fields expected (minute hour day month weekday), ${found} found.`,
    invalidField: (name: string, value: string) => `Field ${name}: "${value}" is not valid.`,
    fields: {
      minute: "Minute",
      hour: "Hour",
      dayOfMonth: "Day of month",
      month: "Month",
      dayOfWeek: "Weekday"
    },
    presets: {
      hourly: "Hourly",
      everyFourHours: "Every 4 hours",
      dailyEight: "Daily at 8:00",
      weekdaysEight: "Weekdays at 8:00"
    },
    nextRun: (when: string) => `Next check: ${when}`,
    never: "Valid, but this time never comes round."
  },

  source: {
    missing: "No source URL given.",
    notAUrl: "The source URL is not a valid URL.",
    notHttps: "Only HTTPS sources are fetched.",
    notMarkdown: "The source is not a Markdown file (.md)."
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
    panelProofread: "Read correction",
    panelGlossaryCheck: "Check glossary",
    panelStop: "Cancel",
    panelCheckSource: "Check source",
    noTerms: "No glossary chosen, or no terms to check against.",
    running: "Correction running …",
    cancelled: "Correction cancelled.",
    failedShort: "Correction failed.",
    unknownError: "Unknown error.",
    applied: (count: number) => `${count} changes applied.`,
    appliedWithSkipped: (applied: number, skipped: number) =>
      `${applied} applied, ${skipped} no longer placeable.`,
    noSuggestions: "No suggestions.",
    suggestions: (count: number) => `${count} suggestions.`,
    blocksRejected: (count: number) =>
      `${count} section(s) discarded (protected content was altered).`,
    chunksFailed: (count: number) => `${count} request(s) failed.`,
    cardDiverged: "Edited locally — accepting restores what the source says.",
    cardFirstSync: "First comparison with the source.",
    sourceMatches: "The note matches its source.",
    sourceUnchangedLocalEdits: "Source unchanged; the note carries local edits.",
    divergedChanges: (count: number) =>
      `${count} difference(s). The note was edited locally; accepting restores the source.`,
    sourceChanges: (count: number) => `${count} change(s) from the source.`,
    pendingFromPoll: (count: number) =>
      `${count} change(s) from the last background check. "Check source" fetches them.`,
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
    disabled: "document sync is off. Turn it on in Settings → Schreibstube → Document sync.",
    busy: "a check is already running.",
    noneChecked: "no bound notes were checked.",
    checked: (checked: number, changed: number, failed: number) =>
      `${checked} checked, ${changed} with updates, ${failed} failed.`,
    withUpdates: (count: number) =>
      `${count} note(s) have updates from their source — open the review panel to apply them.`,

    every: {
      notWords:
        'this note\'s check interval could not be read. Write it as "every 2 days", ' +
        '"weekly", or a five-field cron expression.',
      tooSmall: "a check interval has to be at least one minute.",
      panel: (words: string, cron: string) => `Checked at most ${words} (${cron})`,
      panelCron: (cron: string) => `Checked on the note's own schedule (${cron})`
    }
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

  explorer: {
    title: "Schreibstube Explorer",
    empty: "This vault has no files yet.",
    searchPlaceholder: "Filter all sections…",
    clearFilter: "Clear the filter",
    filterMore: (count: number) => `${count} more match. Narrow the filter to see them.`,
    collapseAll: "Collapse all",
    expandAll: "Expand all",
    pinnedMore: "Show all pinned",
    pinnedFewer: "Show three again",
    folderCount: (count: string) => `${count} files`,

    move: {
      intoItself: (name: string) => `${name} cannot be moved inside itself.`,
      nameTaken: (name: string) => `A file called ${name} is already there.`,
      failed: (name: string) => `${name} could not be moved.`,
      title: (name: string) => `Move "${name}" to…`,
      root: "Vault root",
      nowhere: (name: string) => `There is nowhere ${name} can be moved to.`,
      done: (name: string, folder: string) => `${name} moved to ${folder}.`
    },

    sections: {
      pinned: "Pinned",
      bookmarks: "Bookmarks",
      latest: "Latest",
      files: "Files and folders"
    },

    bookmarks: {
      empty: "No bookmarks yet.",
      hint: (path: string) =>
        `Write them into ${path}: a heading is a folder, a list item is a link.`,
      missingFile: (path: string) => `There is no bookmarks file at ${path} yet.`,
      badTarget: (name: string) => `${name} does not point anywhere that can be opened.`,
      missingFolder: (path: string) => `there is no folder at ${path}.`,
      missingNote: (path: string) => `there is no note called ${path}.`,
      copyPath: "Copy path for Schreibstube",
      copied: (path: string) => `${path} copied as a bookmark link.`,
      copyFailed: "the clipboard is not available here.",
      quickOpen: "Search bookmarks…",
      recent: "Recently opened",
      all: "All bookmarks"
    },

    latest: {
      synced: "Updated externally",
      alert: "A source was updated in the background",
      created: "Created",
      modified: "Modified",
      empty: "No notes yet."
    },

    menu: {
      open: "Open",
      openNewTab: "Open in new tab",
      setIcon: "Set icon…",
      changeIcon: "Change icon…",
      clearIcon: "Remove icon",
      keepTop: "Keep at top of folder",
      releaseTop: "Stop keeping at top",
      pin: "Add to Pinned",
      unpin: "Remove from Pinned",
      bindSource: "Bind to a source…",
      checkSource: "Check source now",
      openSource: "Open source",
      unbindSource: "Remove source binding",
      syncFolder: "Check every bound note here",
      newNote: "New note",
      newFolder: "New folder",
      rename: "Rename…",
      renameNoteAi: "Rename from the text…",
      renameImageAi: "Rename from the picture…",
      renaming: "Reading it…",
      move: "Move to…",
      delete: "Delete",
      more: "More actions"
    },

    icons: {
      title: "Choose an icon",
      search: "Search icons…",
      none: "No icon matches that.",
      clear: "Remove icon",
      groups: {
        documents: "Documents",
        folders: "Folders",
        property: "Property",
        business: "Business",
        status: "Status",
        misc: "Everything else"
      }
    },

    badge: {
      synced: "In sync with its source",
      pending: (count: number) => `${count} change(s) waiting from the source`,
      unchecked: "Bound to a source, never checked",
      error: "The source cannot be fetched",
      checkedAt: (when: string) => `last checked ${when}`,
      never: "never checked"
    },

    bind: {
      title: "Bind to a source",
      desc:
        "The note mirrors this Markdown file: the source is the truth and nothing is ever " +
        "pushed back. HTTPS only; a GitHub page URL is rewritten to its raw form.",
      placeholder: "https://raw.githubusercontent.com/owner/repo/main/note.md",
      submit: "Bind",
      bound: (name: string) => `${name} is now bound to its source.`,
      unbound: (name: string) => `${name} is no longer bound to a source.`,
      noSource: "this note has no source to open.",
      checked: (name: string) => `${name} is up to date with its source.`,
      folderChecked: (checked: number, changed: number, failed: number) =>
        `${checked} checked, ${changed} with updates, ${failed} failed.`,
      folderEmpty: "no bound notes in this folder."
    },

    create: {
      noteTitle: "New note",
      folderTitle: "New folder",
      namePlaceholder: "Name",
      renameTitle: "Rename",
      exists: "something with that name is already there.",
      invalid: "that name cannot be used."
    },

    delete: {
      title: "Delete",
      confirm: (name: string) => `Move "${name}" to the vault's trash?`,
      folderConfirm: (name: string, count: number) =>
        `Move "${name}" and the ${count} item(s) inside it to the vault's trash?`,
      submit: "Delete",
      failed: (name: string) => `"${name}" could not be deleted.`
    }
  },

  print: {
    noNote: "open a note first — printing sets the note you are looking at.",
    noTemplates: (root: string) =>
      `no print template found in ${root}. A template is a folder with a template.md and a ` +
      "template.typ; copy one from examples/print/ to start.",
    unknownTemplate: (name: string) =>
      `this note asks for the template "${name}", which is not in the templates folder.`,
    noLayout: (name: string) => `${name} has no template.typ, so there is nothing to print with.`,
    working: (name: string) => `printing with ${name}…`,
    drawing: (index: number, total: number) => `drawing diagram ${index} of ${total}…`,
    downloading: (label: string, megabytes: number) =>
      `fetching the ${label} (${megabytes} MB, once per device)…`,
    verifying: "checking what was downloaded…",
    starting: "starting the typesetter…",
    compiling: "typesetting…",
    mismatch: (detail: string) =>
      `the downloaded typesetter is not what this version expects and was not used (${detail}).`,
    unreachable: (detail: string) =>
      `the typesetter could not be fetched (${detail}). It is needed once per device; try again when online.`,
    compilerRefused: (detail: string) => `the template did not compile — ${detail}`,
    pictureFailed: (name: string) => `${name} could not be read and was left out`,
    panelsLost: (index: number, missing: number, total: number) =>
      `diagram ${index}: ${missing} of ${total} drawings could not be captured and are missing`,
    done: (path: string, kilobytes: number) => `printed ${path} (${kilobytes} KB).`,
    withWarnings: (detail: string) => `printed, with something left out — ${detail}`,
    failed: (detail: string) => `printing failed — ${detail}`,
    chooseTemplate: "Print with which template?",
    templateHint: "Set schreibstubePrintTemplate in the note to skip this."
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
