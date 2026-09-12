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
    focusSentence: "Focus mode: sentence",
    focusParagraph: "Focus mode: paragraph",
    focusDisable: "Focus mode: off",
    renameFile: "Rename file from content",
    renameImage: "Rename image from content",
    summarize: "Summarize selection",
    openExplorer: "Open file pane",
    openBookmark: "Open bookmark",
    openReview: "Open proof-read sidebar",
    proofread: "Proof-read note",
    checkGlossary: "Check note against glossary",
    syncAll: "Check all bound notes for updates",
    syncNote: "Check note source for updates",
    sendMail: "Send note as email",
    queryMailbox: "Query mailbox",
    fetchReplies: "Fetch replies into note",
    publish: "Publish",
    publishPreview: "Preview publication",
    openSite: "Open website",
    linksLeft: "Open links to the left",
    linksRight: "Open links to the right",
    linksNormal: "Open links normally"
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

  publish: {
    heading: "Publishing",
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
    noNotes: (folder: string) => `no note in ${folder} is marked for publication.`,
    missingSource: (path: string) => `the source for ${path} is missing — please try again.`,
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
