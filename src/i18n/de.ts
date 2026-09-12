/**
 * Die deutsche Fassung.
 *
 * Muss die Form von `en` erfüllen: ein fehlender Eintrag ist ein Compilerfehler
 * und keine Lücke, die jemand erst in der Oberfläche bemerkt.
 */
import type { Messages } from "./en";

export const de: Messages = {
  commands: {
    focusSentence: "Fokus: Satz",
    focusParagraph: "Fokus: Absatz",
    focusDisable: "Fokus: aus",
    renameFile: "Datei aus Inhalt benennen",
    renameImage: "Bild aus Inhalt benennen",
    summarize: "Auswahl zusammenfassen",
    openReview: "Korrektur-Seitenleiste öffnen",
    proofread: "Notiz korrigieren",
    checkGlossary: "Notiz gegen Glossar prüfen",
    syncAll: "Alle gebundenen Notizen prüfen",
    syncNote: "Quelle dieser Notiz prüfen",
    sendMail: "Notiz als E-Mail senden",
    queryMailbox: "Postfach durchsuchen",
    fetchReplies: "Antworten in die Notiz holen",
    publish: "Veröffentlichen",
    publishPreview: "Veröffentlichung prüfen",
    openSite: "Website öffnen",
    linksLeft: "Links nach links öffnen",
    linksRight: "Links nach rechts öffnen",
    linksNormal: "Links normal öffnen"
  },

  common: {
    cancel: "Abbrechen",
    close: "Schließen",
    save: "Speichern",
    testConnection: "Verbindung testen",
    remove: "Entfernen",
    copy: "Kopieren",
    copied: "Kopiert",
    notice: (message: string) => `Schreibstube: ${message}`
  },

  publish: {
    heading: "Veröffentlichen",
    intro:
      "Veröffentlicht einen Ordner des Vaults als Website. Übertragen werden nur Notizen, deren " +
      "Frontmatter das sagt. Die Bridge rendert das Markdown und schreibt es per SFTP — die " +
      "Zugangsdaten des Webspace bleiben außerhalb des Vaults, und genau deshalb funktioniert " +
      "das auch mobil.",
    bridgeUrl: "Bridge-URL",
    bridgeUrlDesc: "Leer lassen, wenn dieselbe Bridge wie für E-Mail genutzt wird.",
    token: "Publish-Token",
    tokenDesc:
      "Der PUBLISH_TOKEN der Bridge — bewusst ein anderer als der Mail-Token, damit ein " +
      "verlorenes Token nicht beides öffnet. Liegt in Obsidians Secret Storage.",
    accounts: "Konten",
    accountName: "Name",
    accountFolder: "Ordner",
    accountTarget: "Ziel",
    accountDesc: "Name der Website, Ordner im Vault und Ziel auf der Bridge.",
    addAccount: "Konto hinzufügen",
    writeBack: "Veröffentlichung in die Notiz schreiben",
    writeBackDesc: "Trägt Zeitpunkt und Adresse nach dem Veröffentlichen ins Frontmatter ein.",
    targetPlaceholder: "Ziel auf der Bridge",
    targetsUnavailable: "Ziele nicht abrufbar — Namen eintragen.",
    keysHeading: "Frontmatter-Felder",
    keysDesc:
      "Welcher Frontmatter-Schlüssel welche Bedeutung hat. Leer lassen, um den Standard zu " +
      "behalten. Ein geänderter Schlüssel ersetzt den Standard: Notizen mit dem alten Namen " +
      "werden dann nicht mehr erkannt. Hier umbenennen, wenn ein anderes Plugin dieselben Namen " +
      "belegt.",
    keyPublished: "Veröffentlichen (ja/nein)",
    keyTitle: "Titel",
    keyDate: "Datum",
    keyDescription: "Beschreibung",
    keySlug: "Adresse (Slug)",
    keyPublishedAt: "Veröffentlicht am (wird geschrieben)",
    keyPublishedUrl: "Veröffentlicht unter (wird geschrieben)",
    setup: "Bridge-Konfiguration",
    setupDesc:
      "Erzeugt den Umgebungsblock für dieses Konto, fertig zum Einfügen in die Bridge. Host, " +
      "Benutzer und Zugangsdaten werden dort ergänzt.",
    setupCopy: "Konfiguration kopieren",
    lastRun: "Letzte Veröffentlichung",
    lastRunNever: "Aus diesem Vault noch nicht veröffentlicht.",
    lastRunSummary: (when: string, written: number, deleted: number) =>
      `${when} — ${written} geschrieben, ${deleted} gelöscht`,

    planTitle: (account: string) => `Veröffentlichen: ${account}`,
    planNotes: (count: number, folder: string) => `${count} Notiz(en) im Ordner ${folder}`,
    planUploadNotes: (count: number) => `${count} Notiz(en) zu übertragen`,
    planUploadAssets: (count: number) => `${count} Medien zu übertragen`,
    planUnchanged: (count: number) => `${count} unverändert`,
    planDelete: (count: number) => `${count} Datei(en) werden gelöscht`,
    planDeleteHeading: "Wird gelöscht:",
    planMore: (count: number) => `… und ${count} weitere`,
    planConfirm: "Veröffentlichen",
    chooseAccount: "Konto wählen",

    running: "Veröffentlichung läuft …",
    uploading: (done: number, total: number) => `überträgt ${done}/${total} …`,
    building: "baut die Website …",
    done: (written: number, unchanged: number, deleted: number) =>
      `veröffentlicht — ${written} geschrieben, ${unchanged} unverändert, ${deleted} gelöscht.`,
    failed: (reason: string) => `Veröffentlichung fehlgeschlagen — ${reason}`,
    busy: "eine Veröffentlichung läuft bereits.",
    noAccount: "kein Veröffentlichungs-Konto eingerichtet — siehe Einstellungen.",
    noNotes: (folder: string) => `keine Notiz in ${folder} ist zur Veröffentlichung markiert.`,
    missingSource: (path: string) => `die Quelle zu ${path} fehlt — bitte erneut versuchen.`,
    writeBackFailed: (path: string) =>
      `veröffentlicht, aber ${path} konnte nicht aktualisiert werden.`,
    unknownTarget: (target: string) => `die Bridge kennt kein Ziel namens ${target}.`,
    connectionOk: (target: string, entries: number) =>
      `Verbindung zu ${target} steht (${entries} Einträge).`,
    connectionFailed: (reason: string) => reason,
    bridgeOutdated: (bridge: number, plugin: number) =>
      `die Bridge spricht Protokoll ${bridge}, das Plugin erwartet ${plugin} — Bridge neu ausrollen.`
  },

  mail: {
    heading: "E-Mail",
    intro:
      "E-Mail läuft über eine kleine selbst gehostete Bridge (siehe bridge/ im Repository), die " +
      "IMAP und SMTP für das Plugin spricht. Das Postfach-Passwort liegt dort; das Plugin " +
      "speichert nur den Bridge-Token, sodass keine Mail-Zugangsdaten in den Vault gelangen. " +
      "Genau deshalb funktionieren die Mail-Befehle auch mobil.",
    bridgeUrl: "Bridge-URL",
    bridgeUrlDesc: "Basis-URL der ausgerollten Bridge, z. B. https://bridge.example.app",
    token: "Bridge-Token",
    tokenDesc: "Der MAIL_TOKEN der Bridge. Liegt in Obsidians Secret Storage.",
    from: "Absenderadresse",
    fromDesc: "Optional. Überschreibt MAIL_FROM der Bridge — für eine zweite Identität.",
    mailbox: "Postfach",
    mailboxDesc: "IMAP-Postfach, das Suche und Antwortabruf durchsuchen.",
    maxResults: "Maximale Treffer",
    maxResultsDesc: "Wie viele Nachrichten eine Suche liefert. Nur die neuesten werden behalten.",
    mergeHeading: "Überschrift für Antworten",
    mergeHeadingDesc: "Abgeholte Antworten werden unter dieser Überschrift angehängt.",

    searchTitle: (mailbox: string) => `${mailbox} durchsuchen`,
    searchFrom: "Von",
    searchSubject: "Betreff",
    searchText: "Text",
    searchSince: "Seit",
    search: "Suchen",
    searchPlaceholderFrom: "absender@example.com",
    searchPlaceholderSubject: "enthält …",
    searchPlaceholderText: "irgendwo in der Nachricht",
    confirmTitle: "E-Mail senden",
    confirmTo: "An",
    confirmCc: "Cc",
    confirmBcc: "Bcc",
    confirmSubject: "Betreff",
    send: "Senden",
    resendWarning:
      "Diese Notiz wurde bereits einmal gesendet. Ein weiterer Versand stellt ein Duplikat zu."
  },

  diagnostics: {
    heading: "Diagnose",
    debugLogging: "Debug-Protokoll",
    debugLoggingDesc:
      "Schreibt ausführliche Diagnosen in die Entwicklerkonsole (Strg/Cmd+Umschalt+I). Fehler " +
      "werden immer protokolliert; hiermit lässt sich verfolgen, was das Plugin tut."
  },

  language: {
    heading: "Sprache",
    name: "Sprache der Oberfläche",
    desc: "Folgt der Sprache von Obsidian, sofern nichts anderes gewählt ist.",
    auto: "Obsidian folgen",
    de: "Deutsch",
    en: "English",
    changed: "Sprache geändert — Einstellungen neu öffnen, damit sie überall greift."
  },

  settings: {
    overlayHeading: "Überschriften-Stapel",
    overlayEnabled: "Überschriften-Stapel anzeigen",
    overlayEnabledDesc:
      "Zeigt den mitlaufenden Pfad der übergeordneten Überschriften am oberen Rand der Notiz.",

    focusHeading: "Fokus-Modus",
    focusOpacity: "Abdunklung",
    focusOpacityDesc:
      "Deckkraft der Zeilen außerhalb des Fokus (0,2 = sehr blass, 0,8 = fast voll).",

    aiHeading: "KI-Modelle",
    aiIntro:
      "Gilt für alle KI-gestützten Befehle. Der API-Schlüssel liegt in Obsidians Secret Storage, " +
      "nie im Vault.",
    provider: "LLM-Anbieter",
    model: "Modell",
    customModel: "Eigene Modell-ID",
    customModelDesc: "Optional. Überschreibt das Modell oben — für neuere oder ungelistete.",
    customModelPlaceholder: "z. B. claude-3-7-sonnet-latest",
    apiKey: "API-Schlüssel",
    apiKeyDesc: "Ein Secret aus Obsidians Secret Storage wählen oder ein neues anlegen.",

    renameHeading: "Datei aus Inhalt benennen",
    renameImageSize: "Maximale Bildgröße",
    renameImageSizeDesc:
      "Bilder werden vor dem Senden auf diese Kantenlänge der längeren Seite verkleinert.",
    renameMinChars: "Mindestlänge des Inhalts",
    renameMinCharsDesc: "Der Befehl tut nichts, wenn die Notiz weniger Zeichen hat.",
    renameMaxChars: "Maximal gesendeter Inhalt",
    renameMaxCharsDesc: "Wie viele Zeichen vom Anfang der Notiz an das LLM gehen.",
    renameMaxFilename: "Maximale Länge des Dateinamens",
    renameMaxFilenameDesc: "Der erzeugte Dateiname wird auf so viele Zeichen gekürzt.",

    summarizeHeading: "Auswahl zusammenfassen",
    summarizeIntro: "Ersetzt den markierten Text durch eine Zusammenfassung.",
    summarizePrompt: "Prompt für die Zusammenfassung",
    summarizePromptDesc: "Systemanweisung. Leer lassen, um den Standard wiederherzustellen.",
    summarizeTokens: "Maximale Antwortlänge",
    summarizeTokensDesc: "Obergrenze für die Länge der Zusammenfassung.",

    proofreadHeading: "Korrektur",
    proofreadIntro:
      "Die Seitenleiste schlägt eine Änderung nach der anderen vor. Nichts wird in die Notiz " +
      "geschrieben, bevor sie übernommen wurde.",
    proofreadPrompt: "Prompt für die Korrektur",
    proofreadPromptDesc: "Systemanweisung. Leer lassen, um den Standard wiederherzustellen.",
    proofreadTokens: "Maximale Antwortlänge",
    proofreadTokensDesc: "Obergrenze pro Anfrage. Das Budget richtet sich nach der Chunk-Größe.",
    proofreadChunk: "Zeichen pro Anfrage",
    proofreadChunkDesc:
      "Kleinere Abschnitte zeigen die ersten Vorschläge früher, kosten aber mehr Anfragen.",
    proofreadConcurrency: "Parallele Anfragen",
    proofreadConcurrencyDesc: "Wie viele Abschnitte gleichzeitig unterwegs sind.",

    glossaryHeading: "Glossar",
    glossaryIntro:
      "Ein Glossar ist eine Notiz mit schreibstubeGlossary: true im Frontmatter und einer " +
      "Begriffstabelle. Die Prüfung läuft lokal und braucht keinen API-Schlüssel.",
    glossaryDefault: "Standard-Glossare",
    glossaryDefaultDesc: "Pfade im Vault, einer pro Zeile. Gilt, wenn nichts Genaueres passt.",
    glossaryRules: "Ordnerregeln",
    glossaryRulesDesc: "Eine Regel pro Zeile: Ordner | Glossarpfad. Die erste Übereinstimmung gilt.",
    glossaryUnderline: "Glossartreffer im Editor unterstreichen",
    glossaryUnderlineDesc:
      "Markiert Begriffe der Stufe „Fehler“ beim Schreiben. Standardmäßig aus, damit lange " +
      "Notizen ruhig bleiben.",

    syncHeading: "Dokument-Sync",
    syncIntro:
      "Eine an eine entfernte Markdown-Quelle gebundene Notiz spiegelt diese. Die Quelle ist die " +
      "Wahrheit; zurückgeschrieben wird nie.",
    syncEnabled: "Dokument-Sync aktivieren",
    syncEnabledDesc: "Standardmäßig aus. Gebundene Notizen werden bis dahin ignoriert.",
    syncOnOpen: "Beim Öffnen einer gebundenen Notiz prüfen",
    syncOnOpenDesc: "Prüft die Quelle beim Öffnen, im Rahmen des Intervalls unten.",
    syncInterval: "Mindestabstand automatischer Prüfungen in Minuten",
    syncIntervalDesc: "Pro Notiz. Null prüft bei jedem Öffnen. Eine manuelle Prüfung läuft immer.",
    syncToken: "GitHub-Token",
    syncTokenDesc: "Nur für private Repositories nötig. Liegt in Obsidians Secret Storage.",
    syncPoll: "Alle gebundenen Notizen im Hintergrund prüfen",
    syncPollDesc: "Läuft nach dem Zeitplan unten, und einmal beim Start, falls ein Lauf ausfiel.",
    syncSchedule: "Zeitplan",
    syncScheduleDesc: (examples: string) =>
      "Fünf Cron-Felder: Minute, Stunde, Tag des Monats, Monat, Wochentag. Gilt in Ortszeit. Ein " +
      "Zeitpunkt, der bei geschlossenem Obsidian fällig wurde, läuft einmal beim nächsten Start. " +
      `Beispiele: ${examples}.`,
    syncNextRun: (when: string) => `Nächste Prüfung: ${when}`,
    syncNeverRuns: "Gültig, aber dieser Zeitpunkt tritt nie ein."
  },

  ai: {
    busy: "ein KI-Befehl läuft bereits — bitte warten.",
    noNote: "keine Notiz im Editor geöffnet.",
    selectText: "zuerst Text markieren, der zusammengefasst werden soll.",
    summarizing: "fasst zusammen …",
    summarizeFailed: "Zusammenfassung fehlgeschlagen — das LLM lieferte eine leere Antwort.",
    renameFailedName: "Umbenennen fehlgeschlagen — das LLM lieferte keinen brauchbaren Namen.",
    renameFailedExists: "Umbenennen fehlgeschlagen — eine Datei dieses Namens existiert bereits.",
    imageTooLarge: "das Bild überschreitet 10 MB.",
    unsupportedImage: "nicht unterstütztes Format — möglich sind jpg, png, gif, webp.",
    failRename: "Schreibstube: Umbenennen fehlgeschlagen",
    failImage: "Schreibstube: Bild konnte nicht verarbeitet werden",
    failSummarize: "Schreibstube: Zusammenfassen fehlgeschlagen",
  },

  proofread: {
    busy: "es läuft bereits eine Korrektur.",
    noteClosed: "die geprüfte Notiz ist nicht mehr geöffnet.",
    spotGone: "Stelle nicht mehr auffindbar.",
    failed: (reason: string) => `Korrektur fehlgeschlagen — ${reason}`,
    panelTitle: "Schreibstube: Korrektur",
    panelNoNote: "Keine Notiz geöffnet",
    panelIdle: "Keine offenen Vorschläge.",
    panelRunning: "Läuft …",
    panelSection: (done: number, total: number) => `Abschnitt ${done} von ${total}`,
    panelGlossaryMissing: (path: string) => `Glossar nicht gefunden: ${path}`,
    panelNoGlossary: "Keine Glossarnotiz im Vault.",
    panelSource: (status: string) => `Quelle (${status})`,
    panelGlossary: (source: string) => `Glossar (${source})`,
    panelCheckedAt: (when: string) => `Zuletzt geprüft: ${when}`,
    badgeGlossary: "Glossar",
    badgeSource: "Quelle",
    badgeStale: "veraltet",
    badgeInflection: "Beugung prüfen",
    categories: {
      spelling: "Rechtschreibung",
      grammar: "Grammatik",
      punctuation: "Zeichensetzung",
      style: "Stil",
      terminology: "Terminologie",
      capitalization: "Schreibweise",
      update: "Aktualisierung"
    },
    syncStatus: {
      none: "nicht gebunden",
      idle: "gebunden",
      checking: "wird geprüft",
      clean: "aktuell",
      diverged: "lokal geändert",
      unsynced: "noch nie abgeglichen",
      missing: "nicht gefunden",
      error: "Fehler"
    },
    glossarySource: {
      frontmatter: "aus dieser Notiz",
      folder: "aus Ordnerregel",
      session: "manuell gewählt",
      default: "Standard",
      none: "keins"
    },
    accept: "Übernehmen",
    reject: "Verwerfen",
    show: "Anzeigen",
    acceptAll: (count: number) => `Alle übernehmen (${count})`
  },

  sync: {
    notBound: "diese Notiz ist an keine Quelle gebunden.",
    noneChecked: "keine gebundenen Notizen geprüft.",
    checked: (checked: number, changed: number, failed: number) =>
      `${checked} geprüft, ${changed} mit Aktualisierungen, ${failed} fehlgeschlagen.`,
    withUpdates: (count: number) => `${count} Notiz(en) mit Aktualisierungen aus der Quelle.`
  },

  mailNotices: {
    busy: "ein Mail-Befehl läuft bereits — bitte warten.",
    noBody: "die Notiz hat keinen Text zum Senden.",
    noCriteria: "mindestens ein Suchkriterium angeben.",
    noMessages: "keine Nachricht gefunden.",
    noReplies: "keine neuen Antworten.",
    sending: "sendet …",
    searching: "durchsucht das Postfach …",
    merged: (count: number) => `${count} neue Nachricht(en) übernommen.`,
    needsMessageId: (key: string) =>
      `diese Notiz hat kein ${key} — sie muss zuerst als E-Mail gesendet werden.`,
    needsEditor: "eine Notiz im Bearbeitungsmodus öffnen, um die Nachricht einzufügen.",
    needsRecipient: (key: string) => `zuerst „${key}:“ mit einem Empfänger ins Frontmatter setzen.`,
    invalidRecipient: (addresses: string) => `keine gültige E-Mail-Adresse: ${addresses}`,
    needsSubject: (key: string) => `zuerst eine Zeile „${key}:“ ins Frontmatter setzen.`,
    sent: "E-Mail gesendet.",
    sentNoCopy: "E-Mail gesendet (keine Kopie in „Gesendet“).",
    failSend: "Schreibstube: Senden fehlgeschlagen",
    failSearch: "Schreibstube: Postfachsuche fehlgeschlagen",
    failMerge: "Schreibstube: Übernehmen der Antworten fehlgeschlagen"
  },

  secrets: {
    notSelected: (label: string) =>
      `kein ${label} ausgewählt — in den Einstellungen einen wählen.`,
    notFound: (label: string) => `${label} nicht gefunden — Einstellungen prüfen.`,
    apiKey: "API-Schlüssel",
    mailToken: "Mail-Token",
    publishToken: "Publish-Token",
    githubToken: "GitHub-Token"
  }
};
