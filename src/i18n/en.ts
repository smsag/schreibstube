import { enExtra } from "./en-extra";

/**
 * The reference catalogue.
 *
 * Its shape is the message type every other language has to satisfy, so adding
 * a string here without translating it does not compile. Entries that take
 * values are functions, which keeps word order translatable — German and
 * English do not put the count in the same place.
 */
export const en = {
  commands: {
    print: "Print doc",
    focusSentence: "Focus: sentence",
    focusParagraph: "Focus: paragraph",
    newNote: "New doc",
    insertTaskSummary: "Insert: task summary",
    insertSlideshow: "Insert: slideshow",
    insertPdfSummary: "Insert: summary from the attached PDF",
    sendToReminders: "Send task to Erinnerungen",
    reminders: "Compare with Erinnerungen",
    rename: "Rename doc with AI",
    summarize: "Insert: AI summary of the selection",
    table: "Insert: table from the selection",
    tableAi: "Insert: AI table from the selection",
    insertToday: "Insert: today's date",
    openExplorer: "Open explorer",
    collapseExplorer: "Explorer: collapse folders",
    explorerUndo: "Explorer: undo the last move or delete",
    folderTiles: "Explorer: this note's folder as tiles",
    related: "Related notes",
    openBookmark: "Open bookmark",
    pinTag: "Pin tag",
    openReview: "Open review sidebar",
    proofread: "Proof-read doc",
    syncAll: "Update all docs",
    syncNote: "Update doc",
    sendMail: "Send doc as mail",
    queryMailbox: "Search mailbox",
    fetchReplies: "Fetch replies into doc",
    publish: "Publish folder",
    linksSwitch: "Links: switch side"
  },

  common: {
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    testConnection: "Test connection",
    remove: "Remove",
    copy: "Copy",
    copied: "Copied",
    notice: (message: string) => `Schreibstube: ${message}`,
    /** Obsidian returns no leaf when the sidebar that would hold the pane is
     *  gone from the workspace. Saying so beats a command that does nothing. */
    sidebarMissing: (pane: string) =>
      `no sidebar is available for ${pane}. Show the sidebar and run the command again.`
  },

  tasks: {
    alreadyPresent: "this note already has a task summary ribbon.",
    none: "No tasks",
    /** The ribbon's one line. Digits are emphasised by the renderer, so the
     *  numbers have to appear as plain digits here. */
    ribbon: (open: number, total: number) => `${open} open of ${total}`,
    /** The badge after a heading. */
    badge: (open: number, total: number) => `${open} of ${total} open`,
    menuSend: "Send to Erinnerungen",
    markTooltip: "Sent to Erinnerungen",
    remindersOff:
      "sending to Erinnerungen is off. Turn it on in Settings → Schreibstube → Erinnerungen.",
    noShortcut: "no Shortcut name is set. Enter it in Settings → Schreibstube → Erinnerungen.",
    notATask: "the cursor is not on a task.",
    sent: (title: string) => `sent to Erinnerungen: ${title}`,
    taskNotFound: "no note in this vault holds that task.",
    noStatusShortcut:
      "no status Shortcut name is set. Enter it in Settings → Schreibstube → Erinnerungen.",
    noneSent: "no task in this note has been sent to Erinnerungen.",
    checking: "asking Erinnerungen…",
    nothingDone: "Erinnerungen reports nothing new as done.",
    ticked: (count: number) => `${count} task(s) ticked as done in Erinnerungen.`
  },

  slideshow: {
    /** Shown in place of the block when its text does not parse. */
    tooFew: (min: number) => `a slideshow needs at least ${min} images.`,
    tooMany: (max: number) => `a slideshow holds at most ${max} images.`,
    notImage: (line: number, text: string) =>
      `line ${line}: expected an image "![alt](path)" — got "${text}"`,
    emptyPath: (line: number) => `line ${line}: the image path is empty.`,
    unknownLayout: (line: number, value: string, allowed: string) =>
      `line ${line}: unknown layout "${value}" — expected ${allowed}.`,
    /** The region's accessible name, per layout, and the control labels. */
    region: (n: number) => `Slideshow, ${n} images`,
    regionFeature: (n: number) => `Scene with details, ${n} images`,
    regionStrip: (n: number) => `Image strip, ${n} images`,
    regionFilmstrip: (n: number) => `Slideshow with thumbnails, ${n} images`,
    regionMasonry: (n: number) => `Image wall, ${n} images`,
    /** A comparison is always two images, so its name does not count them. */
    regionCompare: "Before and after",
    compareHandle: "Move the divider",
    showImage: (n: number) => `Show image ${n}`,
    previous: "Previous image",
    next: "Next image",
    fullscreen: "Present fullscreen",
    exit: "Exit presentation"
  },

  notes: {
    /** The base of a new note's name, the word Obsidian itself uses. */
    untitled: "Untitled",
    createFailed: "the note could not be created."
  },

  links: {
    /** The status bar while link mode is on, so a mode with no other mark on
     *  screen says which way the next link opens. */
    toLeft: "← left",
    toRight: "right →"
  },

  publish: {
    heading: "Publishing",
    /** The name a freshly added account carries until it is given one. */
    newAccountName: "Website",
    openSite: "Open the website",
    openSiteDesc: "Opens the published site in the browser.",
    openSiteButton: "Open",
    intro:
      "Publishes a folder of the vault as a website. Only notes whose frontmatter says so are " +
      "transferred. The bridge renders the Markdown and writes it over SFTP, so the hosting " +
      "credentials stay out of the vault — which is also what makes this work on mobile.",
    bridgeUrl: "Bridge URL",
    bridgeUrlDesc: "Leave empty to use the same bridge as email.",
    token: "Publish token",
    tokenDesc:
      "The bridge's PUBLISH_TOKEN — deliberately a different token from the mail one, so a " +
      "leaked token cannot open both. Stored in Obsidian's secret storage.",
    accounts: "Accounts",
    accountName: "Name",
    accountFolder: "Folder",
    accountTarget: "Target",
    accountDesc: "The site's name, the folder in the vault, and the target the bridge knows.",
    addAccount: "Add account",
    writeBack: "Record the publication in the note",
    writeBackDesc: "Writes the time and the address into the frontmatter after publishing.",
    headerTags: "Tags in the header",
    headerTagsDesc:
      "Up to three tags linked at the top of every page, each to a page listing the notes that carry it. Nested tags count: projekt also lists notes tagged projekt/alpha. A tag no published note carries is left out.",
    headerTagPlaceholder: "#tag",
    targetPlaceholder: "Target on the bridge",
    targetsUnavailable: "Targets could not be loaded — type the name.",
    keysHeading: "Frontmatter fields",
    keysDesc:
      "Which frontmatter key carries which meaning. Leave a field empty to keep the default. A " +
      "changed key replaces the default: notes still using the old name are no longer " +
      "recognised. Rename here if another plugin has claimed one of the names.",
    keyPublished: "Publish (yes/no)",
    keyTitle: "Title",
    keyDate: "Date",
    keyDescription: "Description",
    keySlug: "Address (slug)",
    keyPublishedAt: "Published at (written)",
    keyPublishedUrl: "Published to (written)",
    setup: "Bridge configuration",
    setupDesc:
      "Generates the environment block for this account, ready to paste into the bridge's " +
      "deployment. Fill in the host, the user and the credentials there.",
    setupCopy: "Copy configuration",
    lastRun: "Last publication",
    lastRunNever: "Not published from this vault yet.",
    lastRunSummary: (when: string, written: number, deleted: number) =>
      `${when} — ${written} written, ${deleted} deleted`,

    planTitle: (account: string) => `Publish: ${account}`,
    planNotes: (count: number, folder: string) => `${count} note(s) in ${folder}`,
    planUploadNotes: (count: number) => `${count} note(s) to transfer`,
    planUploadAssets: (count: number) => `${count} media file(s) to transfer`,
    planUnchanged: (count: number) => `${count} unchanged`,
    planDelete: (count: number) => `${count} file(s) will be deleted`,
    planDeleteHeading: "Will be deleted:",
    planMore: (count: number) => `… and ${count} more`,
    planConfirm: "Publish",
    chooseAccount: "Choose an account",

    running: "publishing …",
    uploading: (done: number, total: number) => `transferring ${done}/${total} …`,
    building: "building the website …",
    done: (written: number, unchanged: number, deleted: number) =>
      `published — ${written} written, ${unchanged} unchanged, ${deleted} deleted.`,
    failed: (reason: string) => `publication failed — ${reason}`,
    busy: "a publication is already running.",
    noAccount: "no publishing account configured — see Settings.",
    noNotes: (folder: string) =>
      `no note in ${folder} is marked for publication, and nothing published is left to take down.`,
    emptyFolder: (folder: string) =>
      `${folder} holds no notes — check the account's folder. Nothing was published or taken down.`,
    missingSource: (path: string) => `the source for ${path} is missing — please try again.`,
    changedDuringPublish: (path: string) =>
      `${path} changed while publishing — publish again to send the new version.`,
    writeBackFailed: (path: string) => `published, but ${path} could not be updated.`,
    unknownTarget: (target: string) => `the bridge has no target named ${target}.`,
    connectionOk: (target: string, entries: number) =>
      `connection to ${target} works (${entries} entries).`,
    connectionFailed: (reason: string) => reason,
    bridgeOutdated: (bridge: number, plugin: number) =>
      `the bridge speaks protocol ${bridge}, the plugin expects ${plugin} — redeploy the bridge.`
  },

  mail: {
    heading: "Email",
    intro:
      "Email runs through a small self-hosted bridge (see bridge/ in the repository), which " +
      "speaks IMAP and SMTP on the plugin's behalf. The bridge holds the mailbox password; the " +
      "plugin only stores the bridge token, so mail credentials never enter the vault. This is " +
      "also what makes the mail commands work on mobile.",
    bridgeUrl: "Bridge URL",
    bridgeUrlDesc: "Base URL of your deployed bridge, e.g. https://bridge.example.app",
    token: "Bridge token",
    tokenDesc: "The bridge's MAIL_TOKEN. Stored in Obsidian's secret storage.",
    from: "From address",
    fromDesc: "Optional. Overrides the bridge's MAIL_FROM — use for a second identity.",
    mailbox: "Mailbox",
    mailboxDesc: "IMAP mailbox searched by the query and reply commands.",
    maxResults: "Maximum results",
    maxResultsDesc: "Number of messages a search returns. Only the newest matches are kept.",
    filterResults: "Filter results…",
    noSubject: "(no subject)",
    mergeHeading: "Merge heading",
    mergeHeadingDesc: "Fetched replies are appended under this heading in the note.",

    searchTitle: (mailbox: string) => `Search ${mailbox}`,
    searchFrom: "From",
    searchSubject: "Subject",
    searchText: "Text",
    searchSince: "Since",
    search: "Search",
    searchPlaceholderFrom: "sender@example.com",
    searchPlaceholderSubject: "contains…",
    searchPlaceholderText: "anywhere in the message",
    confirmTitle: "Send email",
    confirmTo: "To",
    confirmCc: "Cc",
    confirmBcc: "Bcc",
    confirmSubject: "Subject",
    send: "Send",
    resendWarning: "This note was already sent once. Sending again delivers a duplicate."
  },

  diagnostics: {
    heading: "Diagnostics",
    debugLogging: "Debug logging",
    debugLoggingDesc:
      "Log detailed diagnostics to the developer console (Ctrl/Cmd+Shift+I). Errors are always " +
      "logged; enable this to trace what the plugin is doing."
  },

  language: {
    heading: "Language",
    name: "Interface language",
    desc: "Follows Obsidian's language unless you choose otherwise.",
    auto: "Follow Obsidian",
    de: "Deutsch",
    en: "English",
    changed: "language changed — reopen the settings to see it everywhere."
  },

  ...enExtra
};

/** The shape every other catalogue has to satisfy. */
export type Messages = typeof en;
