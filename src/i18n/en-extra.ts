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

    iconShortcodesHeading: "Icons in the text",
    iconShortcodesEnabled: "Draw :folder: as the icon",
    iconShortcodesEnabledDesc:
      "Type a colon and two letters of an icon's name to choose one; it is written as `:name:` and " +
      "drawn as the glyph here, and reads as the name anywhere else. Switch off if another plugin " +
      "already uses the colon for emoji.",

    focusHeading: "Focus mode",
    focusOpacity: "Dim opacity",
    focusOpacityDesc:
      "Opacity of out-of-focus lines in focus mode (0.2 = very faint, 0.8 = nearly full).",

    remindersHeading: "Erinnerungen",
    remindersIntro:
      "Sends a task to Apple's Reminders through a Shortcut you install once. The task's line " +
      "becomes the title, the text indented under it the note, and a link back to the task is " +
      "added so the reminder can reopen the note at the right place. macOS and iOS only.",
    remindersEnabled: "Send tasks to Erinnerungen",
    remindersEnabledDesc: "Offer the command and the entry in the editor's context menu.",
    remindersList: "Reminders list",
    remindersListDesc:
      "Name of the list the reminder is created in, handed to the Shortcut. Leave empty to let " +
      "the Shortcut choose.",
    remindersShortcut: "Shortcut name",
    remindersShortcutDesc:
      "The Shortcut that creates the reminder. It receives one text input: JSON with title, " +
      "notes, list, link and note.",
    remindersSetup: "Building the Shortcut",
    remindersSetupDesc:
      'In the Shortcuts app, create a shortcut with that name that accepts text. Add "Get ' +
      'Dictionary from Input", then "Add New Reminder" with Title from the dictionary\'s title, ' +
      "Notes from notes and the list from list. Tags written as #tag stay text: Reminders offers " +
      "no way to set a real tag from outside.",
    remindersStatusShortcut: "Status Shortcut name",
    remindersStatusShortcutDesc:
      "The Shortcut that reports which reminders are done. It receives JSON with ids, links and " +
      "list, and its output is handed back to the plugin: any text that contains the reminders' " +
      "links, such as their notes.",
    remindersStatusSetup: "Building the status Shortcut",
    remindersStatusSetupDesc:
      'Create a shortcut with that name that accepts text. Add "Find Reminders" with Is Completed ' +
      'true, List from the list you use, and Notes contains "schreibstube?task=". Add "Get Details ' +
      'of Reminders" for the Notes, then "Combine Text" with new lines, and end with that text as ' +
      'the output. To keep notes current without running anything, add "Save File" to the same ' +
      "shortcut, overwriting the report file in the vault, and run it from an automation.",
    remindersReportFile: "Report file",
    remindersReportFileDesc:
      "Vault path of the file an automation writes the status Shortcut's output to. The plugin " +
      "reads it whenever it changes and ticks the tasks it names. Leave empty to turn this off.",

    explorerHeading: "Schreibstube Explorer",
    explorerIntro:
      "Schreibstube's own file list: an icon per file and folder, a sync mark on notes bound " +
      "to a source, and a pinned block at the top of each folder. Open it with the " +
      '"Open explorer" command.',
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
    explorerDescriptionNotes: "Show picture descriptions as notes",
    explorerDescriptionNotesDesc:
      "Off: a described picture is one row, found by its description too, and its description note stays " +
      "out of the tree. On: the description notes appear as ordinary notes.",
    explorerTaskCounts: "Task counts",
    explorerTaskCountsDesc:
      'Show how many tasks a note holds and how many are still open, as "1 / 7" after its ' +
      "name. Notes without tasks show nothing.",
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

    describeHeading: "Picture descriptions",
    describeIntro:
      "Describe a picture from its menu in Schreibstube Explorer: the configured model writes a title, a " +
      "description and keywords into a note of its own, so the picture can be found by what it shows. " +
      "The picture is resized first, which drops its location data, and then sent to the provider above.",
    describeEnabled: "Describe pictures",
    describeEnabledDesc:
      "Adds Describe picture to a picture's menu. Nothing is sent anywhere while this is off.",
    describeFolder: "Folder for descriptions",
    describeFolderDesc: "One note per picture, all in this folder.",
    describeLanguage: "Language of descriptions",
    describeLanguageAuto: "Interface language",
    describeTags: "Keywords as tags",
    describeTagsDesc:
      "Also write the keywords as Obsidian tags. Off by default: many pictures with several keywords each " +
      "fill the tag pane.",

    summarizeHeading: "Summarize selection",
    summarizeIntro:
      'The "Insert: AI summary of the selection" command sends the selected text to the LLM and replaces it with ' +
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
    glossaryDefaultPlaceholder: "Glossaries/House.md",
    glossaryRules: "Folder rules",
    glossaryRulesDesc: "One rule per line: folder | glossary path. The first match wins.",
    glossaryRulesPlaceholder: "Clients | Glossaries/Clients.md",
    glossaryUnderline: "Underline glossary hits in the editor",
    glossaryUnderlineDesc:
      "Marks error-severity terms as you write. Off by default to keep long notes quiet.",

    printHeading: "Printing",
    printIntro: (typst: string) =>
      `A note becomes a PDF through a template: a folder holding a template.md that says what the ` +
      `template needs, a template.typ that lays the page out, and its fonts. Typesetting is done on ` +
      `the device by Typst ${typst}, so printing works offline and on a phone, on every platform ` +
      "Obsidian runs on.",
    printEnabled: "Enable printing",
    printEnabledDesc: (megabytes: number) =>
      `Off until you switch it on, because switching it on is what fetches the typesetter: ` +
      `${megabytes} MB, once per device. Nothing is downloaded before then.`,
    printRuntimeInstalled: (megabytes: number) =>
      `The typesetter is on this device (${megabytes} MB). Printing works offline.`,
    printRuntimeMissing: (megabytes: number) =>
      `The typesetter is not on this device yet. It is ${megabytes} MB and is fetched once, ` +
      "either now or the first time you print.",
    printRuntimeHeading: "The typesetter",
    printDownloadNow: "Download now",
    printRemoveRuntime: "Remove the typesetter",
    printAddTemplate: "Add a template",
    printAddTemplateButton: "Add",
    printAddTemplateDesc:
      "Writes one of the two example templates into a folder you choose. Neither carries a " +
      "typeface, since fonts are licensed; a template with none is set in the standard fonts " +
      "fetched with the typesetter.",
    printTemplateRoot: "Templates folder",
    printTemplateRootDesc:
      "Where a new template goes by default. A template is any folder with a template.md marked " +
      "schreibstubePrintTemplate, and one is found wherever you keep it — this only says where " +
      "the suggestion points.",
    printOutputFolder: "Output folder",
    printOutputFolderDesc:
      "Where a printed PDF is written. Leave empty to put it beside the note it came from.",
    printOutputBesideNote: "beside the note",
    printDefaultTemplate: "Default template",
    printDefaultTemplateDesc:
      "What a note that names no template is printed with. A note chooses its own with " +
      "schreibstubePrintTemplate in its frontmatter.",
    printDefaultBuiltin: "Standard (built in)",
    printDefaultAsk: "Ask every time",
    printDefaultMissing: (path: string) => `${path} (not found)`,
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
    renameFailed: (detail: string) => `rename failed — ${detail}`,
    selectionMoved: "the selection changed while the summary was being written; nothing replaced.",
    imageTooLarge: "image exceeds the 10 MB limit.",
    unsupportedImage: "unsupported format — supported image types: jpg, png, gif, webp.",
    failRename: "Schreibstube: rename failed",
    failImage: "Schreibstube: could not process image",
    failSummarize: "Schreibstube: summarize failed",
    tableMenu: "Convert to table",
    tableMenuAi: "Convert to table with AI",
    tableSelectLines: "select at least two lines to turn into a table.",
    tableNoColumns: "the selection has no clear columns — try the AI table instead.",
    tableTooLong: (max: number) =>
      `the selection is too long for an AI table (at most ${max} characters).`,
    tableCreating: "creating table…",
    tableFailedEmpty: "table conversion failed — the LLM returned no usable table.",
    tableSelectionMoved: "the text changed while the table was being created; nothing replaced.",
    tableHeaderName: "Name",
    tableHeaderValue: "Value",
    failTable: "Schreibstube: table conversion failed",
    describing: "describing the picture…",
    described: (title: string) => `described: ${title}`,
    describeUnusable: "the model's description was unusable — nothing written.",
    failDescribe: "Schreibstube: describing the picture failed"
  },

  properties: {
    chooseIcon: "Choose icon…",
    enterToday: "Enter today",
    noNote: "could not tell which note this property belongs to.",
    heading: "Properties",
    dateFormat: "Date format",
    dateFormatDesc: (example: string) =>
      `For text, e.g. DD.MM.YYYY or dddd, D. MMMM. Date properties always get YYYY-MM-DD. ` +
      `Today: ${example}`
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
    notMarkdown: "The source is not a Markdown file (.md).",
    notFound: (status: number) => `Source not found (HTTP ${status}).`,
    privateNeedsToken: "A private repository needs a GitHub token.",
    tokenNoAccess:
      "GitHub answers the same when the token cannot see this repository — " +
      "check the token's repository access.",
    rateLimited: "GitHub rate limit reached. A token raises the limit considerably.",
    denied: (status: number) => `Access denied (HTTP ${status}). Check the token.`,
    httpStatus: (status: number) => `The source answered with HTTP ${status}.`,
    metadataNotFile: "GitHub returned metadata instead of the file's contents.",
    notMarkdownType: (type: string) => `The source is not Markdown (${type}).`,
    tooLarge: "The source exceeds the size limit.",
    timeout: (seconds: number) => `The source did not answer within ${seconds}s.`,
    networkError: "Network error."
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
    glossaryHits: (count: number) =>
      count === 0 ? "Glossary: no matches." : `Glossary: ${count} match(es).`,
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
    show: "Locate",
    showInsert: "Locate insertion point",
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
    taskCount: (done: number, total: number) => `${done} of ${total} tasks done`,
    filterEmpty: "Nothing here answers that.",
    filterMore: (count: number) => `${count} more match. Narrow the filter to see them.`,
    foundByMeaning: "Found by meaning: the words differ, the subject matches.",
    collapseAll: "Collapse all",
    expandAll: "Expand all",
    pinnedMore: "Show all pinned",
    pinnedFewer: "Show three again",
    folderCount: (count: string) => `${count} files`,

    related: {
      viewTitle: "Related notes",
      viewNoNote: "Open a note to see what it sits among.",
      viewEmpty: "Nothing links, tags or files this note beside anything else.",
      summary: (count: number) => (count === 1 ? "1 related note" : `${count} related notes`),
      root: "Vault root",
      reasons: {
        link: "linked",
        sharedLink: (count: number) => (count === 1 ? "1 shared link" : `${count} shared links`),
        coCitation: (count: number) =>
          count === 1 ? "listed together" : `listed together ${count}×`,
        tag: (count: number) => (count === 1 ? "1 shared tag" : `${count} shared tags`),
        folder: "same folder"
      }
    },
    tiles: {
      viewTitle: "Image tiles",
      viewTitleFor: (folder: string) => `${folder} · tiles`,
      root: "Vault root",
      noFolder: "Choose a folder in the Explorer to see its pictures here.",
      gone: "This folder is no longer in the vault.",
      empty: "No pictures lie directly in this folder.",
      summary: (count: number) => (count === 1 ? "1 picture" : `${count} pictures`),
      following: "Follows the folder chosen in the Explorer; close this tab to stop.",
      more: (count: number) =>
        `${count} more are not drawn. Move them into a folder of their own to see them.`
    },

    tags: {
      pick: "Pick a tag to pin…",
      none: "No note in this vault carries a tag yet.",
      notes: (count: number) => (count === 1 ? "1 note" : `${count} notes`),
      pinned: (tag: string) => `#${tag} pinned.`,
      alreadyPinned: (tag: string) => `#${tag} is already pinned.`,
      rowLabel: (tag: string) => `Notes tagged #${tag}`,
      viewTitle: "Tagged notes",
      viewTitleFor: (tag: string) => `#${tag}`,
      viewNoTag: "Press a pinned tag in the Explorer to list its notes here.",
      viewEmpty: "No note carries this tag any more.",
      summary: (notes: string, open: number, total: number) =>
        total === 0 ? `${notes}, no tasks` : `${notes} · ${open} of ${total} tasks open`,
      root: "Vault root"
    },

    move: {
      intoItself: (name: string) => `${name} cannot be moved inside itself.`,
      nameTaken: (name: string) => `A file called ${name} is already there.`,
      failed: (name: string) => `${name} could not be moved.`,
      title: (name: string) => `Move "${name}" to…`,
      root: "Vault root",
      nowhere: (name: string) => `There is nowhere ${name} can be moved to.`,
      done: (name: string, folder: string) => `${name} moved to ${folder}.`,
      manyTitle: (count: number) => `Move ${count} items to…`,
      nowhereMany: "There is no folder all of them can be moved to.",
      manyDone: (moved: number, folder: string, refused: number) =>
        refused === 0
          ? `${moved} items moved to ${folder}.`
          : `${moved} items moved to ${folder}; ${refused} could not be.`
    },

    sections: {
      pinned: "Pinned",
      bookmarks: "Bookmarks",
      latest: "Updated externally",
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
      openFailed: (name: string) => `${name} could not be opened.`,
      copyPath: "Copy path for Schreibstube",
      copied: (path: string) => `${path} copied as a bookmark link.`,
      copyFailed: "the clipboard is not available here.",
      quickOpen: "Search bookmarks…",
      all: "All bookmarks"
    },

    latest: {
      alert: "A source was updated in the background",
      empty: "No source has changed."
    },

    menu: {
      open: "Open",
      openNewTab: "Open in new tab",
      openNewWindow: "Open in new window",
      setIcon: "Set icon…",
      changeIcon: "Change icon…",
      clearIcon: "Remove icon",
      keepTop: "Keep at top of folder",
      releaseTop: "Stop keeping at top",
      pin: "Add to Pinned",
      unpin: "Remove from Pinned",
      related: "Related notes",
      showImages: "Images as tiles",
      pinTag: "Pin a tag of this note…",
      showTag: "Show tagged notes",
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
      describeImage: "Describe picture",
      renaming: "Reading it…",
      move: "Move to…",
      delete: "Delete",
      more: "More actions",
      moveSelected: (count: number) => `Move ${count} items to…`,
      deleteSelected: (count: number) => `Delete ${count} items`
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
      never: "never checked",
      published: (site: string, when: string) => `Published on ${site} · ${when}`,
      marked: (site: string) => `Marked for publication on ${site}`,
      notYetPublished: "not published yet",
      siteLastPublished: (when: string) => `the site was last published ${when}`,
      siteNeverPublished: "the site has not been published from this vault yet"
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
      failed: (reason: string) => `the source could not be fetched — ${reason}`,
      folderEmpty: "no bound notes in this folder."
    },

    create: {
      noteTitle: "New note",
      folderTitle: "New folder",
      namePlaceholder: "Name",
      renameTitle: "Rename",
      exists: "something with that name is already there.",
      invalid: "that name cannot be used.",
      badCharacters: 'a name cannot contain / \\ : * ? " < > or |.',
      linkCharacters: "a name cannot contain # ^ [ or ]: links to the file would break.",
      hidden: "a name starting with a dot is hidden by the vault.",
      trailingDot: "a name cannot end with a dot.",
      tooLong: "a name can be at most 255 characters."
    },

    delete: {
      title: "Delete",
      confirm: (name: string) => `Move "${name}" to the trash?`,
      folderConfirm: (name: string, count: number) =>
        `Move "${name}" and the ${count} item(s) inside it to the trash?`,
      submit: "Delete",
      failed: (name: string) => `"${name}" could not be deleted.`,
      done: (name: string) => `"${name}" moved to the trash.`,
      manyConfirm: (count: number) => `Move ${count} items to the trash?`,
      manyDone: (count: number) => `${count} items moved to the trash.`
    },

    undo: {
      action: "Undo",
      nothing: "there is nothing to undo.",
      moveUndone: (count: number) =>
        count === 1 ? "the move was undone." : `${count} moves were undone.`,
      deleteUndone: (count: number) =>
        count === 1 ? "the delete was undone." : `${count} deletes were undone.`,
      blocked: (name: string) => `${name} could not be put back: something is there now.`,
      systemTrash: "it went to the system trash, which this pane cannot reach into."
    },

    import: {
      done: (count: number, folder: string) =>
        count === 1 ? `1 file imported into ${folder}.` : `${count} files imported into ${folder}.`,
      refused: (count: number) => `${count} left out:`,
      reasonFolder: "a folder — drop its files instead",
      reasonTooLarge: "too large",
      reasonBadName: "a name the vault refuses",
      reasonTooMany: "past the limit for one drop",
      failed: (name: string) => `${name} could not be written.`
    }
  },

  print: {
    noNote: "open a note first — printing sets the note you are looking at.",
    defaultMissing: (path: string) =>
      `the default template ${path} is no longer in this vault; choose one, or pick another default in the print settings.`,
    builtIn: "built in",
    slideshowUnreadable: (detail: string) => `a slideshow was printed as its source — ${detail}`,
    preparing: "preparing the print…",
    dialog: {
      title: "Print",
      template: "Template",
      margins: "Margins",
      margin: { small: "Small", standard: "Standard", wide: "Wide" },
      marginFixed: "This template sets its own margins.",
      pageBreaks: "Horizontal rules as page breaks",
      frontmatter: "Print properties",
      slideshows: "Slideshows",
      slideshow: { layout: "As in the note", stacked: "Every picture, one under another" },
      print: "Print",
      working: "Setting the preview…",
      pages: (shown: number, total: number) =>
        shown === total
          ? total === 1
            ? "1 page"
            : `${total} pages`
          : `the first ${shown} of ${total} pages`,
      failed: (detail: string) => `No preview — ${detail}`
    },
    unknownTemplate: (name: string) =>
      `this note asks for the template "${name}", and no folder in this vault is one.`,
    noLayout: (name: string) => `${name} has no template.typ, so there is nothing to print with.`,
    working: (name: string) => `printing with ${name}…`,
    drawing: (index: number, total: number) => `drawing diagram ${index} of ${total}…`,
    downloading: (label: string, megabytes: number) =>
      `fetching the ${label} (${megabytes} MB, once per device)…`,
    downloadingFont: (face: string) => `fetching the font ${face} (once per device)…`,
    verifying: "checking what was downloaded…",
    starting: "starting the typesetter…",
    compiling: "typesetting…",
    compilingLong: (seconds: number) =>
      `typesetting a long document — this can take up to ${seconds} s on this device…`,
    compileTimeout: (seconds: number) =>
      `the document took longer than ${seconds} s to set and was stopped. Try printing it in two parts.`,
    mismatch: (detail: string) =>
      `the downloaded typesetter is not what this version expects and was not used (${detail}).`,
    timeout: (seconds: number) => `no answer within ${seconds}s`,
    unreachable: (detail: string) =>
      `the typesetter could not be fetched (${detail}). It is needed once per device; try again when online.`,
    compilerRefused: (detail: string) => `the template did not compile — ${detail}`,
    pictureFailed: (name: string) => `${name} could not be read and was left out`,
    panelsLost: (index: number, missing: number, total: number) =>
      `diagram ${index}: ${missing} of ${total} drawings could not be captured and are missing`,
    done: (path: string, kilobytes: number) => `printed ${path} (${kilobytes} KB).`,
    withWarnings: (detail: string) => `printed, with something left out — ${detail}`,
    failed: (detail: string) => `printing failed — ${detail}`,
    offTitle: "Printing is off",
    offMessage: (megabytes: number) =>
      `Printing sets the note on this device rather than on a server, so it needs a typesetter: ` +
      `${megabytes} MB, fetched once and then kept. Turn printing on to fetch it.`,
    offSubmit: "Turn on printing",
    unsupported:
      "this device cannot run the typesetter, so printing is not available here. " +
      "Printing needs WebAssembly, a worker and a digest, which every platform Obsidian " +
      "supports normally has.",
    runtimeReady: "the typesetter is on this device. Printing works offline from here.",
    runtimeRemoved: "the typesetter was removed. The next print fetches it again.",
    chooseExample: "Which template shall I add?",
    chooseFolder: "Put the template in which folder?",
    templateExists: (path: string) => `${path} already exists and was left alone.`,
    templateAdded: (path: string) =>
      `${path} added. Open its template.md to see what it needs, and put a font in its fonts/ folder.`,
    diagramAsSource: (language: string) => `${language}: could not be drawn, printed as source`,
    htmlDropped: "HTML is dropped when printing",
    embedNotPrinted: (target: string) => `embedded note is not printed: ${target}`,
    imageUnsupported: (name: string) => `${name} is in a format a print cannot carry`,
    imageNotFound: (source: string) => `image not found: ${source}`,
    footnoteMissing: (name: string) => `footnote [^${name}] has no text and was left out`,
    notReplaced: (path: string) =>
      `${path} is somebody else's file and was left alone; nothing was printed.`,
    outputIsFolder: (path: string) =>
      `${path} is a folder, so the document cannot be written there`,
    replaceTitle: "Replace this file?",
    replaceMessage: (path: string) =>
      `${path} already exists and was not made by printing. Replace it with the printed note?`,
    replaceSubmit: "Replace",
    limits: {
      fontFiles: (count: number, max: number) => `${count} font files, at most ${max} are used`,
      fontBytes: (megabytes: number, max: number) =>
        `fonts total ${megabytes} MB, at most ${max} MB are used`,
      pictureFiles: (count: number, max: number) => `${count} pictures, at most ${max} are used`,
      pictureBytes: (megabytes: number, max: number) =>
        `pictures total ${megabytes} MB, at most ${max} MB are used`,
      pdfBytes: (megabytes: number, max: number) =>
        `the document came to ${megabytes} MB, at most ${max} MB are written`
    },
    layout: {
      tooLarge: (kilobytes: number) => `layout is larger than ${kilobytes} KB`,
      package: (line: number) => `line ${line}: packages cannot be used, printing works offline`,
      leavesFolder: (line: number) => `line ${line}: a path may not leave the template folder`,
      absolute: (line: number) => `line ${line}: a path must be relative to the template folder`
    }
  },

  semantic: {
    building: "Search by meaning: reading the vault…",
    progress: (done: number, total: number) => `Search by meaning: ${done} of ${total} notes read`,
    busy: "Search by meaning is already reading the vault.",
    heading: "Search by meaning",
    intro:
      "Finds notes by what they are about, not only by the words in their name. A small " +
      "language model runs on this device; nothing leaves it. The first build reads every " +
      "note once, which takes a few minutes on a desktop.",
    enabled: "Search by meaning",
    enabledDesc: (megabytes: number) =>
      "Adds notes that match what was typed in meaning to the Explorer filter, after a short " +
      `pause in typing. Downloads the model (about ${megabytes} MB) the first time.`,
    maxNotes: "Most notes to index",
    maxNotesDesc: (min: number, max: number) =>
      `The newest notes up to this number are read. Between ${min} and ${max}.`,
    buildNow: "Build now",
    rebuild: "Rebuild",
    rebuildDesc: "Reads every note again from scratch.",
    status: "Status",
    state: {
      off: "Off.",
      blocked:
        "Paused on this phone while Pythia is switched on: two language models are more than " +
        "the phone lets one app hold.",
      notBuilt:
        "Not built yet. It builds when the Explorer filter is first used, or with Build now.",
      loading: "Loading the model…",
      building: (done: number, total: number) => `Reading notes: ${done} of ${total}.`,
      ready: (count: number) => (count === 1 ? "Ready: 1 note." : `Ready: ${count} notes.`),
      partial: (count: number) => `Unfinished: ${count} notes read. Build now to finish.`,
      outdated: (count: number) =>
        `${count} notes, but the notes to index have changed. Build now to catch up.`,
      failed: (error: string) => `Failed: ${error}`,
      outOfMemory: "The device ran out of memory. Lower the number of notes and build again.",
      paused: "Paused after a build did not finish twice in a row. Build now to try again."
    }
  },
  secrets: {
    notSelected: (label: string) => `no ${label} selected — open Settings to choose one.`,
    notFound: (label: string) => `${label} not found — check Settings.`,
    apiKey: "API key",
    mailToken: "mail token",
    publishToken: "publish token",
    githubToken: "GitHub token"
  },
  pdf: {
    pickTitle: (name: string) => `Passages from ${name}`,
    filter: "Filter",
    filterPlaceholder: "Words from the passage",
    pageLabel: (page: number) => `p. ${page}`,
    chosenCount: (count: number) => (count === 1 ? "1 passage chosen" : `${count} passages chosen`),
    insert: "Insert",
    markLabel: "↗",
    choosePdf: "Which PDF?",
    noneAttached: "this doc points at no PDF. Embed or link one and run the command again.",
    noTextLayer: (name: string) =>
      `${name} has no text layer — a scan is a picture to anything that reads text.`,
    unreadable: (name: string) => `${name} could not be read.`,
    truncated: (read: number, total: number) =>
      `read the first ${read} of ${total} pages; later pages were not offered.`,
    inserted: (count: number) =>
      count === 1 ? "1 passage inserted." : `${count} passages inserted.`
  }
};
