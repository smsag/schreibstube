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

    basesHeading: "Bases",
    basesReadingView: "Open notes from bases in Reading view",
    basesReadingViewDesc:
      "A note opened from a base — a row in a table, a card, a list entry, or a link in one — opens " +
      "for reading rather than editing, in every layout and whether the base is a file or embedded " +
      "in a note. Back returns to the base.",

    focusHeading: "Focus mode",
    focusOpacity: "Dim opacity",
    focusOpacityDesc:
      "Opacity of out-of-focus lines in focus mode (0.2 = very faint, 0.8 = nearly full).",

    newDocLink: "New doc from outside Obsidian",
    newDocLinkDesc:
      "This link runs New doc in this vault from anywhere: a keyboard shortcut of the system's, " +
      "the Shortcuts app, Raycast, Alfred, or a home-screen icon. The README explains the setup.",
    newDocLinkCopy: "Copy link",

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
    explorerShowExtensions: "Show file extensions",
    explorerShowExtensionsDesc:
      "Off, a row shows only the name and its icon says what the file is: Plan.md, Plan.png and Plan.excalidraw.md all read Plan. On, rows show the whole name. Renaming edits the name without its extension either way.",
    recommendedPlacement: "Recommended",
    recommendedPlacementDesc:
      "Where the notes, pictures and conversations that belong with the open note are shown. Under " +
      "the note, they are read where the note ends; the sidebar panel can still be opened from a " +
      "note's menu.",
    recommendedSidebar: "In the right sidebar",
    recommendedFooter: "Under the note",
    recommendedCount: "Number of recommendations",
    recommendedCountDesc: (min: number, max: number) =>
      `How many recommendations are shown, notes, pictures and conversations together, the most relevant first. ${min} to ${max}.`,
    explorerTaskCounts: "Task counts",
    explorerTaskCountsDesc:
      'Show how many tasks a note holds and how many are still open, as "1 / 7" after its ' +
      "name. Notes without tasks show nothing.",
    explorerIcons: "Icon set",
    explorerIconsDesc: (count: number, version: string) =>
      `${count} icons from Tabler Icons ${version} (MIT), bundled with the plugin so they work offline and on mobile.`,

    aiHeading: "AI models",
    aiIntro:
      "Provider, model, and API key shared by every AI command: rename, summarize, AI table, tag suggestions and picture descriptions.",
    provider: "LLM provider",
    model: "Model",
    customModel: "Custom model ID",
    customModelDesc: "Optional. Overrides the model above — use for a newer or unlisted model.",
    customModelPlaceholder: "the provider's model ID",
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
    glossaryTermFolder: "Term folder",
    glossaryTermFolderDesc:
      "A folder of one note per term, such as the glossary folder Pythia writes. Each note is a " +
      "term; the words listed under schreibstubeAvoid on it are flagged, with the term offered " +
      "instead. Joins the default glossaries. Manage the words in the proofreading panel.",
    glossaryTermFolderPlaceholder: "Glossary",
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
      "Writes one of the example templates into a folder you choose. None carries a font " +
      "file: Fira Sans, JetBrains Mono and Typst's own faces are fetched with the typesetter, " +
      "and a template that names no font is set in those.",
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
      `Examples: ${examples}.`
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
    failTags: "Schreibstube: tag suggestions failed",
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
    failDescribe: "Schreibstube: describing the picture failed",
    folder: {
      off: "picture descriptions are switched off in the settings.",
      nothing: (name: string, described: number) =>
        described > 0
          ? `every picture in ${name} has a description (${described}).`
          : `no picture in ${name} to describe.`,
      relinked: (count: number) =>
        `${count} description(s) whose picture had been renamed were found again.`,
      tooLarge: (count: number, megabytes: number) =>
        `${count} picture(s) over ${megabytes} MB are left out.`,
      deferred: (count: number, cap: number) =>
        `${count} more wait for the next run: a run describes at most ${cap}.`,
      confirmTitle: (count: number, name: string) => `Describe ${count} picture(s) in ${name}?`,
      confirmBody: (count: number, provider: string) =>
        `Each picture is made smaller, stripped of its location data and sent to ${provider}: ` +
        `${count} request(s), one after another. Every description becomes a note.`,
      confirmAction: "Describe",
      progress: (done: number, total: number, name: string) =>
        `Describing pictures in ${name}: ${done} of ${total}.`,
      stop: "Stop",
      stopping: "Stopping after this picture…",
      done: (count: number, name: string) => `${count} picture(s) in ${name} described.`,
      unusable: (count: number) =>
        `${count} answer(s) were unusable; nothing was written for them.`,
      failed: (count: number) => `${count} failed — the console says why.`,
      stopped: "Stopped; the rest are still undescribed."
    }
  },

  properties: {
    chooseIcon: "Choose icon…",
    enterToday: "Enter today",
    noNote: "could not tell which note this property belongs to.",
    heading: "Properties",
    dateFormat: "Date format",
    dateFormatDesc: (example: string) =>
      `For text, e.g. DD.MM.YYYY or dddd, D. MMMM. Date properties always get YYYY-MM-DD. ` +
      `Today: ${example}`,
    setFolder: "Property set folder",
    setFolderDesc:
      "Every note in this folder is a property set: its frontmatter keys and values are added " +
      "to a note, its body is not. Templater templates are rendered for the note they go into " +
      "when Templater is installed. Schreibstube's own sets are always offered.",
    setFolderPlaceholder: "Templates/Properties",
    addSet: "Add property set…",
    addSetButton: "Add set",
    setPickerPlaceholder: "Which set should this note get?",
    setFromSchreibstube: "Schreibstube",
    setNames: {
      mail: "Mail",
      sync: "Document sync",
      print: "Print",
      glossaryNote: "Glossary note",
      glossaries: "Glossaries for this note",
      publish: "Publish"
    } as Record<string, string>,
    setAdded: (name: string, added: number, kept: number) =>
      kept > 0 ? `${name}: ${added} added, ${kept} already there.` : `${name}: ${added} added.`,
    setNothingToAdd: (name: string) => `${name}: every key is already there.`,
    setTemplaterMissing: (keys: string) =>
      `Templater is not available, so these were added empty: ${keys}.`,
    setTemplaterFailed: (reason: string, keys: string) =>
      `Templater could not render the set (${reason}), so these were added empty: ${keys}.`,
    setRenderedInvalid: (name: string) =>
      `${name}: Templater's output is not valid frontmatter, so nothing was added.`,
    setUnreadable: (name: string) => `${name}: its frontmatter could not be read.`,
    setSkipped: (name: string, keys: string) =>
      `${name}: left out ${keys} — a set adds text, numbers, yes/no and lists.`,
    setWriteFailed: (reason: string) => `could not add the properties — ${reason}`,
    setCompleteOffer: (name: string, missing: string) => `${name} also uses ${missing}.`,
    setCompleteAction: "Add them",
    mailFieldsAction: "Add mail fields"
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
    allChunksFailed: (detail: string) => `Proofreading failed for every request: ${detail}`,
    /** What a glossary card says when the glossary entry itself says nothing. */
    hitSubstitution: (term: string) => `"${term}" is no longer the preferred term.`,
    hitCapitalization: (spelling: string) => `Spelling per the glossary: "${spelling}".`,
    hitSuperseded: (term: string) => `"${term}" is superseded — decide for yourself.`,
    hitAvoid: (term: string) => `"${term}" should be avoided.`,
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
    acceptAll: (count: number) => `Accept all (${count})`,
    panelTerms: (folder: string) => `Terms (${folder})`,
    panelTermsEmpty: "No word is marked to avoid yet. Select one in the note, then Add rule.",
    panelAddTermRule: "Add rule",
    panelRemoveTermRule: (word: string) => `Allow "${word}" again`,
    panelOpenTerm: (term: string) => `Open ${term}`,
    termByModel: (definition: string) => `${definition} (definition by model)`,
    termNoNotes: (folder: string) =>
      folder ? `no term notes in ${folder}.` : "no term folder set in the settings.",
    termPickerPlaceholder: (word: string) =>
      word ? `Which term should replace "${word}"?` : "Which term should a word be avoided for?",
    termAvoidTitle: (term: string) => `Avoid in favour of ${term}`,
    termAvoidDesc: "Flagged in every checked note, with the term offered in its place.",
    termAvoidPlaceholder: "Word to avoid",
    termAvoidSubmit: "Add",
    termAvoidSuggestions: "Translations on the term note:",
    termAvoidErrors: {
      empty: "Enter a word.",
      same: "That is the term itself.",
      duplicate: "Already listed for this term.",
      tooLong: "Too long for a term.",
      tooMany: "This term already lists as many words as it can.",
      multiline: "One line only."
    } as Record<string, string>,
    termRuleAdded: (word: string, term: string) => `"${word}" is now flagged in favour of ${term}.`,
    termRuleRemoved: (word: string, term: string) => `"${word}" is no longer flagged for ${term}.`,
    termWriteFailed: (reason: string) => `could not update the term note — ${reason}`,
    termOverlap: (word: string, term: string, glossary: string) =>
      `"${word}" is defined in ${glossary} and on the term note ${term}. Keep it in one place.`,
    termOverlapMore: (count: number) => `…and ${count} more word(s) defined in both places.`,
    /** What reading a glossary note's term table reports, one line per problem. */
    glossary: {
      noTable: "No term table found.",
      unknownSeverity: (key: string, value: string, fallback: string) =>
        `Unknown ${key} "${value}", using ${fallback}.`,
      missingColumns: (names: string) => `Missing required column(s): ${names}.`,
      skippedRequired: (line: number) => `Skipped line ${line}: concept and term are required.`,
      skippedStatus: (line: number, status: string) =>
        `Skipped line ${line}: unknown status "${status}".`,
      unknownMatch: (line: number, mode: string) =>
        `Line ${line}: unknown match mode "${mode}", using word.`,
      skippedDuplicate: (line: number, term: string, concept: string) =>
        `Skipped line ${line}: "${term}" is already defined in concept "${concept}".`,
      tooManyPreferred: (concept: string, count: number) =>
        `Concept "${concept}" has ${count} preferred terms; only the first is used.`
    }
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
      notWhole: "a check interval has to be a whole number of minutes, hours or days.",
      /** Without a cron when the phrase has none cron could say honestly. */
      panel: (words: string, cron: string | null) =>
        cron === null ? `Checked at most ${words}` : `Checked at most ${words} (${cron})`,
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
    drawing: (index: number, total: number) => `drawing diagram ${index} of ${total} for the mail…`,
    searching: "searching mailbox…",
    merged: (count: number) => `merged ${count} new message(s).`,
    needsMessageId: (key: string) => `this note has no ${key} — send it as an email first.`,
    needsEditor: "open a note in editing mode to insert the message.",
    needsRecipient: (key: string) => `add a "${key}:" recipient to the note's frontmatter first.`,
    invalidRecipient: (addresses: string) => `not a valid email address: ${addresses}`,
    invalidSender: (key: string, value: string) =>
      `"${key}" must be one address, alone or as "Name <address>": ${value}`,
    needsSubject: (key: string) => `add a "${key}:" line to the note's frontmatter first.`,
    invalidSubject: (key: string) => `"${key}" must be a single line of text.`,
    sent: "email sent.",
    sentNoCopy: "email sent (no copy filed in Sent).",
    sendUnconfirmed: (detail: string) =>
      `send not confirmed — the email may have been delivered anyway. Check your Sent folder before sending again. (${detail})`,
    frontmatterUnreadable: "the note's frontmatter cannot be read; check its properties.",
    sentRefused: (addresses: string) =>
      `email sent, but the mail server refused these recipients, who will not receive it: ${addresses}`,
    failSend: "Schreibstube: send failed",
    failSearch: "Schreibstube: mailbox search failed",
    failMerge: "Schreibstube: merging replies failed",
    /** Stay until dismissed: the mail went, and the note is the only place
     *  that would have remembered it. */
    sentButIdUnwritten: (key: string, id: string) =>
      `email sent, but ${key} could not be written to the note. Add it by hand to enable reply fetching: ${id}`,
    mergedButIdsUnwritten: (key: string) =>
      `replies merged, but ${key} could not be updated — running the command again may duplicate them.`,
    bridgeUnreachable:
      "the bridge could not be asked whether it takes pictures, so the diagrams go as their source text.",
    fetchingAttachments: "fetching attachments…",
    attachmentsSaved: (count: number) =>
      count === 1 ? "1 attachment saved." : `${count} attachments saved.`,
    attachmentsTooOld:
      "the mail bridge cannot hand over attachments yet — redeploy it. The mail was inserted without them.",
    attachmentsUnknown:
      "the mail bridge could not be asked whether it hands over attachments. The mail was inserted without them.",
    attachmentsNoteChanged:
      "another note was opened while the attachments were fetched, so the mail was not inserted. Its files are saved.",
    failAttachments:
      "Schreibstube: attachments could not be fetched; the mail was inserted without them"
  },

  explorer: {
    orphans: {
      repaired: (count: number) =>
        count === 1
          ? "1 description found its picture again."
          : `${count} descriptions found their pictures again.`,
      none: "Every picture description finds its picture.",
      placeholder: (count: number) =>
        count === 1
          ? "1 description whose picture is missing — open it"
          : `${count} descriptions whose pictures are missing — open one`
    },
    title: "Schreibstube Explorer",
    empty: "This vault has no files yet.",
    searchPlaceholder: "Search the vault…",
    clearFilter: "Clear the search",
    taskCount: (done: number, total: number) => `${done} of ${total} tasks done`,
    filterEmpty: "Nothing here answers that.",
    filterMore: (count: number) =>
      count === 1
        ? "1 more match. Narrow the search to see it."
        : `${count} more matches. Narrow the search to see them.`,
    foundByMeaning: "Found by meaning: the words differ, the subject matches.",
    searchingByMeaning: "Searching by meaning…",
    filterHint:
      "Finds files by name, title, alias, tag and text. Narrow it with tag:, path:, name:, text: or sync:, or type #tag.",
    filterStatus: (count: number) => (count === 1 ? "1 match" : `${count} matches`),
    rootFolder: "Vault root",
    collapseAll: "Collapse all",
    expandAll: "Expand all",
    pinnedMore: "Show all pinned",
    pinnedFewer: "Show three again",
    folderCount: (count: string) => (count === "1" ? "1 file" : `${count} files`),

    related: {
      viewTitle: "Recommended",
      viewNoNote: "Open a note to see what belongs with it.",
      viewEmpty:
        "Nothing links or tags this note together with anything else, and nothing reads alike.",
      summary: (count: number) => (count === 1 ? "1 recommendation" : `${count} recommendations`),
      untitled: "Untitled conversation",
      follow: "Follow the open note",
      stay: "Stay on this note",
      openSource: "Open this note",
      picture: "Picture",
      conversation: "Conversation in Pythia",
      copyLink: "Copy Obsidian URL",
      copied: "Obsidian URL copied.",
      copyFailed: "The URL could not be copied to the clipboard.",
      openBeside: "Open to the right",
      collapse: "Collapse Recommended",
      expand: "Expand Recommended",
      relevance: {
        high: "Highly relevant",
        medium: "Relevant",
        low: "Loosely related"
      },
      relevanceTitle: (level: string, reasons: string) => `${level}: ${reasons}`,
      reasons: {
        link: "linked",
        attached: "attached in the conversation",
        meaning: (percent: number) => `${percent}% similar in meaning`,
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

    csv: {
      copied: (rows: number, columns: number) =>
        `table with ${rows} ${rows === 1 ? "row" : "rows"} and ${columns} ${columns === 1 ? "column" : "columns"} copied — paste it into any note.`,
      column: (index: number) => `Column ${index}`,
      empty: "the file holds no rows.",
      malformed: "a quote in the file is never closed, so its columns cannot be told apart.",
      tooLarge: (maxKb: number) =>
        `the file is larger than ${maxKb} KB — too long to paste as a table.`,
      tooManyRows: (max: number) =>
        `the file has more than ${max} rows — too long to paste as a table.`,
      tooManyColumns: (max: number) => `the file has more than ${max} columns.`,
      readFailed: "the file could not be read.",
      copyFailed: "the clipboard is not available here."
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
      related: "Recommended",
      copyCsvTable: "Copy as Markdown table",
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
      describeFolder: "Describe pictures",
      renaming: "Reading it…",
      move: "Move to…",
      delete: "Delete",
      more: "More actions",
      moveSelected: (count: number) => `Move ${count} items to…`,
      deleteSelected: (count: number) => `Delete ${count} items`,
      actionFailed: (detail: string) => `that could not be done — ${detail}`
    },

    icons: {
      title: "Choose an icon",
      search: "Search icons…",
      none: "No icon matches that.",
      clear: "Remove icon",
      groups: {
        documents: "Documents",
        folders: "Folders & containers",
        revision: "Revision & editing",
        markers: "Numbers, letters & shapes",
        story: "Story & characters",
        moods: "Moods & feelings",
        places: "Places, nature & weather",
        research: "Knowledge & research",
        media: "Media & publishing",
        property: "Real estate",
        business: "Business",
        status: "Status",
        logos: "Logos",
        misc: "Everything else"
      }
    },

    badge: {
      synced: "In sync with its source",
      described: "Has a description",
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
      format: "Format",
      formats: { "16:9": "16:9 (widescreen)", "4:3": "4:3" },
      align: "Alignment",
      speakerNotes: "Speaker notes",
      speakerNotesDesc: "Every > [!notes] callout, on pages of their own after the last slide.",
      aligns: { center: "Centred", left: "Left" },
      textFace: "Text font",
      textFaceMono: "JetBrains Mono",
      textFaceSans: "Fira Sans",
      pythiaFootnotes: "Pythia summaries as footnotes",
      pythiaLinks: (links: number) =>
        links === 1
          ? "One passage links to a Pythia conversation."
          : `${links} passages link to Pythia conversations.`,
      pythiaUpdate: (outdated: number, missing: number) =>
        `Update summaries (${outdated} outdated, ${missing} missing)`,
      pythiaUpdating: (done: number, total: number) => `Updating summaries: ${done} of ${total}…`,
      pythiaUpdated: (refreshed: number, failed: number) =>
        failed === 0
          ? `${refreshed} summaries updated.`
          : `${refreshed} summaries updated; ${failed} could not be written — Pythia's notices say why.`,
      pythiaUpdateFailed: (detail: string) => `The summaries were not updated — ${detail}`,
      frontmatter: "Print properties",
      slideshows: "Slideshows",
      slideshow: { layout: "As in the note", stacked: "Every picture, one under another" },
      print: "Print",
      working: "Setting the preview…",
      pages: (total: number) => (total === 1 ? "1 page" : `${total} pages`),
      failed: (detail: string) => `No preview — ${detail}`
    },
    pythiaUnavailable:
      "Pythia did not hand over its footnotes, so the note is printed without them.",
    pythiaTimeout: (seconds: number) => `Pythia did not finish within ${seconds} seconds.`,
    unknownTemplate: (name: string) =>
      `this note asks for the template "${name}", and no folder in this vault is one.`,
    noLayout: (name: string) => `${name} has no template.typ, so there is nothing to print with.`,
    working: (name: string) => `printing with ${name}…`,
    drawing: (index: number, total: number) => `drawing diagram ${index} of ${total}…`,
    downloading: (label: string, megabytes: number) =>
      `fetching the ${label} (${megabytes} MB, once per device)…`,
    downloadingFont: (face: string) => `fetching the font ${face} (once per device)…`,
    /** What each part of the typesetter is called in a notice; the runtime
     *  names them by role, which is not a word for a person. */
    assetLabel: (label: string) =>
      ({ compiler: "typesetter", loader: "loader", font: "font" })[label] ?? label,
    busy: "a print is already running — please wait.",

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
    slideWidths: (title: string, given: number, columns: number) =>
      `${title === "" ? "a slide" : `the slide "${title}"`}: ${
        given === 0
          ? "its column widths could not be read — write them as two or three numbers, such as 1 2"
          : `${given} column widths for ${columns} column${columns === 1 ? "" : "s"}`
      }, so its columns stay equal`,
    slideLayout: (title: string, value: string) =>
      `${title === "" ? "a slide" : `the slide "${title}"`} asks for the layout "${value}", which is not one — image-left or image-right`,
    slideNoPicture: (title: string, layout: string) =>
      `${title === "" ? "a slide" : `the slide "${title}"`} asks for ${layout} and has no picture on a line of its own, so it stays as it is`,
    notesHeading: "Speaker notes",
    notesSlide: "Slide",
    slidesSmall: (pages: readonly number[], percent: number) =>
      `${pages.length === 1 ? `slide ${pages[0]} holds` : `slides ${pages.join(", ")} hold`} more than fits and ${pages.length === 1 ? "is" : "are"} set as small as ${percent} % — worth splitting`,
    templatePictureMissing: (name: string, template: string) =>
      `${name} is not in the folder of the template "${template}", so it was left out`,
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
    templateExists: (path: string) =>
      `${path} already exists and was left alone. For a new version, replace its template.typ, ` +
      "or rename the folder and add the template again.",
    templateAdded: (path: string) => `${path} added. Open its template.md to see what it needs.`,
    diagramAsSource: (language: string) => `${language}: could not be drawn, printed as source`,
    htmlDropped: "HTML is dropped when printing",
    mathAsSource: "math is printed as written, not typeset",
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
    compilerSilent: "the compiler gave no answer",
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
    /** Read off the layout's source before it compiles; the job's file system is what enforces it. */
    layout: {
      tooLarge: (kilobytes: number) => `layout is larger than ${kilobytes} KB`,
      package: (line: number) =>
        `line ${line}: a package needs the network, which a print does not have`,
      leavesFolder: (line: number) =>
        `line ${line}: a path outside the template folder names nothing a print can read`,
      absolute: (line: number) =>
        `line ${line}: a path from the root names nothing a print can read; it starts at the template folder`
    }
  },

  semantic: {
    sources: {
      asks: (plugin: string, plural: string) =>
        `${plugin} asks to add its ${plural} to search by meaning and Recommended. Nothing of it is read until you allow it; Settings → Search by meaning → Other plugins' sources has the switch.`,
      allow: "Allow",
      notNow: "Not now",
      notRead: (plural: string) => `${plural}: not read yet — the first search reads them`,
      forget: "Forget",
      forgetDesc:
        "Removes the answer and every file this source left; its plugin is asked again when it next registers.",
      heading: "Other plugins' sources",
      intro:
        "Plugins that hand their own items to search by meaning, to be found beside your notes. A source is read only once you allow it; switched off, its items leave search and Recommended at once.",
      none: "No plugin has registered a source.",
      item: (plural: string, count: number) =>
        count === 1 ? `${plural}: 1 item indexed` : `${plural}: ${count} items indexed`,
      pending: "Waiting for your answer",
      noteKind: "Note",
      noteKinds: "Notes",
      imageKind: "Picture",
      imageKinds: "Pictures"
    },
    building: "Search by meaning: reading the vault…",
    progress: (done: number, total: number) => `Search by meaning: ${done} of ${total} notes read`,
    busy: "Search by meaning is already reading the vault.",
    desktopBuilds: (read: number, total: number, budget: number) =>
      `Search by meaning: ${read} of ${total} notes are ready. The desktop builds the rest; ` +
      `Build now in the settings adds ${budget} on this phone.`,
    phoneBudget: (count: number) =>
      `Search by meaning: ${count} notes added on this phone. The desktop finishes the rest, ` +
      "or press Build now again.",
    heading: "Search by meaning",
    intro:
      "Finds notes by what they are about, not only by the words in their name. A small " +
      "language model runs on this device; nothing leaves it. The first build reads every " +
      "note once, which takes a few minutes on a desktop.",
    enabled: "Search by meaning",
    enabledDesc: (megabytes: number) =>
      "Adds notes that match what was typed in meaning to the Explorer search, after a short " +
      `pause in typing. Downloads the model (about ${megabytes} MB) the first time.`,
    maxNotes: "Most notes to index",
    maxNotesDesc: (min: number, max: number) =>
      `The newest notes up to this number are read. Between ${min} and ${max}.`,
    buildNow: "Build now",
    rebuild: "Rebuild",
    rebuildDesc: "Reads every note again from scratch.",
    rebuildDescPhone:
      "On a phone this adds notes like Build now: the index is the desktop's, and clearing it here would clear it there.",
    status: "Status",
    report: {
      heading: "Details",
      coverage: "Coverage",
      coverageValue: (indexed: number, inScope: number, share: number) =>
        `${indexed} of ${inScope} notes (${share} %)`,
      vault: "Vault",
      vaultValue: (notes: number, optedOut: number, overCap: number, cap: number) =>
        `${notes} notes` +
        (optedOut > 0 ? `; ${optedOut} kept out by their frontmatter` : "") +
        (overCap > 0 ? `; ${overCap} past the limit of ${cap}` : ""),
      notIndexed: "Not in the index",
      notIndexedValue: (missing: number, failed: number) =>
        [
          missing > 0 ? `${missing} not read yet` : "",
          failed > 0 ? `${failed} failed, tried again once edited` : ""
        ]
          .filter(Boolean)
          .join("; "),
      passages: "Passages",
      passagesValue: (count: number, perNote: string) => `${count}, ${perNote} per note`,
      file: "Index file",
      fileValue: (
        size: string,
        edits: string | null,
        keeper: "desktop" | "mobile" | null,
        writtenAt: number | null
      ) =>
        size +
        (edits ? ` plus ${edits} of edits` : "") +
        (keeper ? `; kept by the ${keeper === "desktop" ? "desktop" : "phone"}` : "") +
        (writtenAt
          ? `; written ${new Date(writtenAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
          : ""),
      model: "Model",
      modelValue: (model: string, backend: string | null, device: "desktop" | "mobile") =>
        `${model} on this ${device === "mobile" ? "phone" : "desktop"}; ` +
        (backend ? `running in ${backend}` : "not loaded"),
      building: "Building",
      buildingValue: (
        done: number,
        total: number,
        counts: string,
        pace: string | null,
        left: string | null
      ) =>
        `${done} of ${total} notes; ${counts}` +
        (pace ? `; ${pace} passages a second` : "") +
        (left ? `; about ${left} left` : ""),
      buildCounts: (embedded: number, reused: number, failed: number) =>
        `${embedded} embedded, ${reused} unchanged` + (failed > 0 ? `, ${failed} failed` : ""),
      lastBuild: "Last build",
      lastCatchUp: "Last catch-up",
      lastBuildValue: (
        endedAt: number,
        took: string,
        counts: string,
        pace: string | null,
        stopped: boolean,
        error: string | null
      ) =>
        `${new Date(endedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}, ` +
        (error ? `failed after ${took}: ${error}` : `took ${took}; ${counts}`) +
        (pace ? `; ${pace} passages a second` : "") +
        (stopped ? "; stopped at the phone's limit" : ""),
      lastSearch: "Last search",
      lastSearchValue: (
        total: string,
        load: string | null,
        embed: string | null,
        rank: string,
        notes: number,
        hits: number
      ) =>
        `${total}` +
        (load ? `; loading the model ${load}` : "") +
        (embed ? `; the query ${embed}` : "; the query from memory") +
        `; ranking ${notes} notes ${rank}; ${hits} found`,
      textSearch: "Text search",
      textSearchValue: (notes: number, words: number, readIn: string | null) =>
        `${notes} notes read` + (readIn ? ` in ${readIn}` : "") + `, ${words} different words`,
      textSearchUnread:
        "Not read yet. The Explorer search reads the notes' text the first time it is used.",
      seconds: (n: number) => `${n} s`,
      minutes: (n: number) => `${n} min`,
      hours: (h: number, m: number) => (m > 0 ? `${h} h ${m} min` : `${h} h`),
      decimal: (n: number) => n.toFixed(1)
    },
    state: {
      off: "Off.",
      blocked: (name: string) =>
        `Paused on this phone while ${name} runs a language model of its own: two need more ` +
        `memory than iOS lets Obsidian hold, and it would restart the app. Switch ${name} off ` +
        `on this phone to search by meaning here; on a desktop both run.`,
      notBuilt:
        "Not built yet. It builds when the Explorer search is first used, or with Build now.",
      loading: "Loading the model…",
      building: (done: number, total: number) => `Reading notes: ${done} of ${total}.`,
      ready: (count: number) => (count === 1 ? "Ready: 1 note." : `Ready: ${count} notes.`),
      partial: (count: number) => `Unfinished: ${count} notes read. Build now to finish.`,
      outdated: (count: number) =>
        `${count} notes, but the notes to index have changed. Build now to catch up.`,
      failed: (error: string) => `Failed: ${error}`,
      outOfMemory: "The device ran out of memory. Lower the number of notes and build again.",
      offline:
        "The model is not downloaded yet and this device is offline. Connect to the " +
        "internet and build again.",
      timedOut: "The model did not answer in time. Build now to try again.",
      paused: "Paused after a build did not finish twice in a row. Build now to try again.",
      phonePaused:
        "Paused on this phone: Obsidian closed twice in a row while the model was working. " +
        "Edits are indexed by the desktop meanwhile. Build now to try again.",
      desktopBuilds: (count: number, budget: number) =>
        `${count} notes ready. A phone does not build the index on its own: the desktop ` +
        `finishes it and it arrives by sync. Build now adds ${budget} notes here.`
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
      count === 1 ? "1 passage inserted." : `${count} passages inserted.`,
    noteChanged: "another note is in front now, so the passages were not inserted."
  },

  sums: {
    heading: "Sums and formulas",
    intro:
      "Select lines with amounts to see their total in the status bar. In a table, write =sum, " +
      "=avg, =median, =count, =min or =max in a cell to show that result of the cells above it. " +
      "=sum(fixed) keeps the result the doc had when it was first mailed, published or printed.",
    numberFormat: "Number format",
    numberFormatDesc:
      "How a number like 1.234 is read when it could be either, and how results are written. " +
      "Numbers that say it on their own, like 1.234,50, are always read right.",
    automatic: (example: string) => `Automatic (${example})`,
    defaultCurrency: "Default currency",
    defaultCurrencyDesc:
      "Numbers without a currency count in it, and totals in several currencies are converted into it.",
    noCurrency: "None",
    convert: "Convert currencies",
    convertDesc:
      "Convert totals in several currencies into the default currency at the European Central " +
      "Bank's daily rates. The rates are fetched from ecb.europa.eu when a total needs them, at " +
      "most twice a day; nothing about your notes is sent.",
    rates: "Exchange rates",
    ratesOf: (date: string) => `Rates of ${date}.`,
    noRates: "No rates fetched yet.",
    updateRates: "Update now",
    statusBar: (total: string, count: number) => `∑ ${total} · ${count} amounts`,
    statusBarTitle: "Total of the selection. Click to copy it.",
    total: (total: string, count: number) =>
      count === 1 ? `${total} (1 amount)` : `${total} (${count} amounts)`,
    menuItem: (total: string) => `Copy sum: ${total}`,
    noAmounts: "no amounts in the selection.",
    copied: (total: string) => `copied ${total}.`,
    copyFailed: "the total could not be copied to the clipboard.",

    mixed: "mixed currencies",
    unavailable: "–",
    skipped: (count: number) => (count === 1 ? "1 cell skipped" : `${count} cells skipped`),
    now: (total: string) => `now ${total}`,
    frozen: (count: number) =>
      count === 0
        ? "nothing to freeze in this doc."
        : count === 1
          ? "1 total frozen."
          : `${count} totals frozen.`,
    ratesUpdated: (date: string) => `exchange rates of ${date} fetched.`,
    ratesFailed: (message: string) => `exchange rates could not be fetched: ${message}`,
    ratesTimeout: (seconds: number) =>
      `the European Central Bank did not answer within ${seconds} seconds.`,
    ratesUnreadable: "the European Central Bank's answer was not a list of rates.",
    freezeStale: "the doc's formulas changed since it was sent, so nothing was frozen.",
    freezeFailed: (path: string) =>
      `the fixed totals in ${path} could not be written; they stay live until the next send.`
  },

  tagSuggest: {
    controlSetting: "Suggest tags beside Add property",
    controlSettingDesc:
      "Show the Suggest tags control at the foot of every note's properties. Insert: suggested " +
      "tags in the command palette works either way.",
    loading: "Looking at related notes…",
    button: "Suggest tags",
    buttonLabel: "Suggest tags for this note",
    title: (note: string) => `Tags for ${note}`,
    fromVault: "From related notes",
    noneFromVault: "No group of related notes shares a tag this note does not already have.",
    fromNote: "Stated by the note",
    noneFromNote: "The note states no keywords.",
    fromModel: "From the content",
    modelDesc:
      "Sends the beginning of the note and the vault's tags to the AI provider in the settings.",
    askModel: "Ask AI",
    asking: "Asking…",
    noneFromModel: "The AI suggested no further tag.",
    isNew: "new",
    carriers: (count: number, linked: boolean) =>
      linked
        ? count === 1
          ? "on a linked note"
          : `on ${count} related notes, a linked one among them`
        : `on ${count} related notes`,
    add: (count: number) =>
      count === 0 ? "Add tags" : count === 1 ? "Add 1 tag" : `Add ${count} tags`,
    added: (count: number) =>
      count === 0
        ? "the note already had these tags."
        : count === 1
          ? "1 tag added."
          : `${count} tags added.`,
    writeFailed: (reason: string) => `the tags could not be written: ${reason}`,
    loadFailed: (reason: string) => `could not gather tag suggestions: ${reason}`
  },

  /** The buttons on the bar Obsidian shows over a picture in the editor. */
  pictureActions: {
    open: "Open description",
    describe: "Describe picture",
    favorite: "Mark as favourite",
    unfavorite: "Remove from favourites"
  }
};
