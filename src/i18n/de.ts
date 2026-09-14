/**
 * Die deutsche Fassung.
 *
 * Muss die Form von `en` erfüllen: ein fehlender Eintrag ist ein Compilerfehler
 * und keine Lücke, die jemand erst in der Oberfläche bemerkt.
 */
import type { Messages } from "./en";

export const de: Messages = {
  commands: {
    print: "Drucken: diese Notiz als PDF",
    addPrintTemplate: "Drucken: Vorlage anlegen",
    focusSentence: "Fokus: Satz",
    focusParagraph: "Fokus: Absatz",
    focusDisable: "Fokus: aus",
    newNote: "Fokus: neue Notiz im eigenen Fenster",
    insertTaskSummary: "Aufgaben: Zusammenfassung einfügen",
    sendToReminders: "Aufgaben: an Erinnerungen senden",
    checkNoteReminders: "Aufgaben: diese Notiz mit Erinnerungen abgleichen",
    fetchReminders: "Aufgaben: Erledigtes aus Erinnerungen holen",
    renameFile: "KI: Notiz aus ihrem Text benennen",
    renameImage: "KI: Bild aus dem Bild benennen",
    summarize: "KI: Auswahl zusammenfassen",
    openExplorer: "Explorer: Bereich öffnen",
    collapseExplorer: "Explorer: alle Ordner zuklappen",
    openBookmark: "Explorer: Lesezeichen öffnen",
    openReview: "Korrektur: Seitenleiste öffnen",
    proofread: "Korrektur: diese Notiz korrigieren",
    checkGlossary: "Korrektur: diese Notiz gegen das Glossar prüfen",
    syncAll: "Sync: alle gebundenen Notizen prüfen",
    syncNote: "Sync: Quelle dieser Notiz prüfen",
    sendMail: "Mail: diese Notiz senden",
    queryMailbox: "Mail: Postfach durchsuchen",
    fetchReplies: "Mail: Antworten in diese Notiz holen",
    publish: "Veröffentlichen: Ordner veröffentlichen",
    publishPreview: "Veröffentlichen: Veröffentlichung prüfen",
    openSite: "Veröffentlichen: Website öffnen",
    linksLeft: "Links: nach links öffnen",
    linksRight: "Links: nach rechts öffnen",
    linksNormal: "Links: normal öffnen"
  },

  common: {
    cancel: "Abbrechen",
    close: "Schließen",
    save: "Speichern",
    testConnection: "Verbindung testen",
    remove: "Entfernen",
    copy: "Kopieren",
    copied: "Kopiert",
    notice: (message: string) => `Schreibstube: ${message}`,
    sidebarMissing: (pane: string) =>
      `keine Seitenleiste für ${pane} verfügbar. Seitenleiste einblenden und den Befehl erneut ausführen.`
  },

  tasks: {
    alreadyPresent: "diese Notiz hat schon eine Aufgaben-Zusammenfassung.",
    none: "Keine Aufgaben",
    ribbon: (open: number, total: number) => `${open} offen von ${total}`,
    badge: (open: number, total: number) => `${open} von ${total} offen`,
    menuSend: "An Erinnerungen senden",
    markTooltip: "An Erinnerungen gesendet",
    remindersOff:
      "Senden an Erinnerungen ist aus. Einschalten unter Einstellungen → Schreibstube → Erinnerungen.",
    noShortcut:
      "kein Kurzbefehl eingetragen. Namen eintragen unter Einstellungen → Schreibstube → Erinnerungen.",
    notATask: "der Cursor steht auf keiner Aufgabe.",
    sent: (title: string) => `an Erinnerungen gesendet: ${title}`,
    taskNotFound: "keine Notiz in diesem Vault enthält diese Aufgabe.",
    noStatusShortcut:
      "kein Status-Kurzbefehl eingetragen. Namen eintragen unter Einstellungen → Schreibstube → Erinnerungen.",
    noneSent: "keine Aufgabe dieser Notiz wurde an Erinnerungen gesendet.",
    checking: "Erinnerungen wird gefragt…",
    nothingDone: "Erinnerungen meldet nichts Neues als erledigt.",
    ticked: (count: number) => `${count} Aufgabe(n) als in Erinnerungen erledigt abgehakt.`
  },

  notes: {
    untitled: "Unbenannt",
    createFailed: "die Notiz konnte nicht angelegt werden."
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

    remindersHeading: "Erinnerungen",
    remindersIntro:
      "Sendet eine Aufgabe über einen einmal eingerichteten Kurzbefehl an Apples Erinnerungen. " +
      "Die Zeile der Aufgabe wird zum Titel, der darunter eingerückte Text zur Notiz, und ein " +
      "Link zurück zur Aufgabe kommt dazu, damit die Erinnerung die Notiz an der richtigen " +
      "Stelle wieder öffnet. Nur macOS und iOS.",
    remindersEnabled: "Aufgaben an Erinnerungen senden",
    remindersEnabledDesc: "Bietet den Befehl und den Eintrag im Kontextmenü des Editors an.",
    remindersList: "Erinnerungen-Liste",
    remindersListDesc:
      "Name der Liste, in der die Erinnerung angelegt wird; wird dem Kurzbefehl übergeben. Leer " +
      "lassen, damit der Kurzbefehl wählt.",
    remindersShortcut: "Name des Kurzbefehls",
    remindersShortcutDesc:
      "Der Kurzbefehl, der die Erinnerung anlegt. Er erhält eine Texteingabe: JSON mit title, " +
      "notes, list, link und note.",
    remindersSetup: "Den Kurzbefehl anlegen",
    remindersSetupDesc:
      'In der App Kurzbefehle einen Kurzbefehl mit diesem Namen anlegen, der Text annimmt. "Wörterbuch ' +
      'aus Eingabe abrufen" hinzufügen, dann "Neue Erinnerung hinzufügen" mit Titel aus title, ' +
      "Notizen aus notes und der Liste aus list. Als #tag geschriebene Tags bleiben Text: " +
      "Erinnerungen bietet keinen Weg, von außen ein echtes Tag zu setzen.",
    remindersStatusShortcut: "Name des Status-Kurzbefehls",
    remindersStatusShortcutDesc:
      "Der Kurzbefehl, der meldet, welche Erinnerungen erledigt sind. Er erhält JSON mit ids, " +
      "links und list; seine Ausgabe geht zurück ans Plugin: beliebiger Text, der die Links der " +
      "Erinnerungen enthält, etwa ihre Notizen.",
    remindersStatusSetup: "Den Status-Kurzbefehl anlegen",
    remindersStatusSetupDesc:
      'Einen Kurzbefehl mit diesem Namen anlegen, der Text annimmt. "Erinnerungen suchen" ' +
      'hinzufügen mit „Ist erledigt“, der verwendeten Liste und Notizen enthält "schreibstube?task=". ' +
      'Dann "Details von Erinnerungen abrufen" für die Notizen, "Text kombinieren" mit Zeilenumbrüchen, ' +
      "und diesen Text als Ausgabe. Damit Notizen ohne Zutun aktuell bleiben, im selben Kurzbefehl " +
      '"Datei sichern" hinzufügen, das die Berichtsdatei im Vault überschreibt, und ihn per ' +
      "Automation ausführen.",
    remindersReportFile: "Berichtsdatei",
    remindersReportFileDesc:
      "Pfad im Vault, in den eine Automation die Ausgabe des Status-Kurzbefehls schreibt. Das " +
      "Plugin liest die Datei bei jeder Änderung und hakt die genannten Aufgaben ab. Leer lassen, " +
      "um das abzuschalten.",

    explorerHeading: "Schreibstube Explorer",
    explorerIntro:
      "Die eigene Dateiliste der Schreibstube: ein Symbol je Datei und Ordner, eine " +
      "Sync-Markierung an Notizen mit Quelle und ein angehefteter Block oben in jedem Ordner. " +
      "Öffnen über den Befehl „Schreibstube Explorer öffnen“.",
    explorerForeign: "Einträge anderer Plugins",
    explorerForeignDesc:
      "Der Bereich löst Obsidians file-menu-Event aus, andere Plugins können also beitragen. " +
      "Hinter einem Eintrag gesammelt bleibt das Menü lesbar statt in fremde Blöcke zu zerfallen.",
    explorerForeignSubmenu: "Unter „Weitere Aktionen“",
    explorerForeignInline: "Am Ende des Menüs",
    explorerForeignOff: "Gar nicht",
    explorerBookmarks: "Bereich Lesezeichen",
    explorerBookmarksDesc:
      "Eine Linkliste über dem Dateibaum: Webseiten, Obsidian-URIs, Vault-Ordner und Notizen. " +
      "Der Bereich liest die Datei nur, eingetragen werden Links von Hand.",
    explorerBookmarksFile: "Lesezeichen-Datei",
    explorerBookmarksFileDesc:
      "Vault-Pfad der Markdown-Datei, aus der die Lesezeichen gelesen werden. Eine Überschrift " +
      "ist ein Ordner, ein Listenpunkt ein Link.",
    explorerLatest: "Bereich Zuletzt",
    explorerLatestDesc:
      "Zwei kurze Listen zwischen Lesezeichen und Baum: die zuletzt erstellten und die zuletzt " +
      "geänderten Notizen. Was als erstellt erscheint, wiederholt sich nicht als geändert.",
    explorerLatestCount: "Notizen je Liste",
    explorerLatestCountDesc: (max: number) =>
      `Wie viele Notizen jede der beiden Listen zeigt (1 bis ${max}).`,
    explorerLatestExclude: "Nie anzeigen",
    explorerLatestExcludeDesc:
      "Vault-Pfade, durch Komma oder Zeilenumbruch getrennt. Ein Ordner schließt alles darin " +
      "aus. Die Lesezeichen-Datei ist immer ausgenommen.",
    explorerTaskCounts: "Aufgabenzähler",
    explorerTaskCountsDesc:
      'Zeigt hinter dem Namen einer Notiz, wie viele Aufgaben sie enthält und wie viele davon offen sind, als "1 / 7". ' +
      "Notizen ohne Aufgaben zeigen nichts.",
    explorerIcons: "Symbolsatz",
    explorerIconsDesc: (count: number, version: string) =>
      `${count} Symbole aus Tabler Icons ${version} (MIT), im Plugin enthalten — offline und mobil verfügbar.`,

    aiHeading: "KI-Modelle",
    aiIntro:
      "Anbieter, Modell und API-Schlüssel für alle KI-Befehle (Benennen und Zusammenfassen).",
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
      "Bilder werden vor dem Senden auf diese maximale Kantenlänge (px) verkleinert. Kleiner ist " +
      "günstiger und schneller.",
    renameMinChars: "Mindestlänge des Inhalts",
    renameMinCharsDesc: "Der Befehl tut nichts, wenn die Notiz weniger Zeichen hat.",
    renameMaxChars: "Maximal gesendeter Inhalt",
    renameMaxCharsDesc: "Wie viele Zeichen vom Anfang der Notiz an das LLM gehen.",
    renameMaxFilename: "Maximale Länge des Dateinamens",
    renameMaxFilenameDesc: "Der erzeugte Dateiname wird auf so viele Zeichen gekürzt.",

    summarizeHeading: "Auswahl zusammenfassen",
    summarizeIntro:
      "„Auswahl zusammenfassen“ schickt den markierten Text an das LLM und ersetzt ihn durch das " +
      "Ergebnis. Es nutzt das oben konfigurierte Modell.",
    summarizePrompt: "Prompt für die Zusammenfassung",
    summarizePromptDesc:
      "Systemanweisung, wie das LLM die Auswahl zusammenfassen soll. Leer lassen für den Standard.",
    summarizeTokens: "Maximale Antwortlänge",
    summarizeTokensDesc: (min: number, max: number) =>
      `Obergrenze für die Länge der Zusammenfassung (${min}–${max}).`,

    proofreadHeading: "Korrektur",
    proofreadIntro:
      "Wird von der Korrektur-Seitenleiste genutzt. Vorschläge kommen einzeln und werden erst " +
      "geschrieben, wenn sie übernommen wurden.",
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
    glossaryRulesDesc:
      "Eine Regel pro Zeile: Ordner | Glossarpfad. Die erste Übereinstimmung gilt.",
    glossaryUnderline: "Glossartreffer im Editor unterstreichen",
    glossaryUnderlineDesc:
      "Markiert Begriffe der Stufe „Fehler“ beim Schreiben. Standardmäßig aus, damit lange " +
      "Notizen ruhig bleiben.",

    printHeading: "Drucken",
    printIntro: (typst: string) =>
      `Aus einer Notiz wird ein PDF über eine Vorlage: ein Ordner mit einer template.md, die sagt, ` +
      `was die Vorlage braucht, einer template.typ, die die Seite setzt, und ihren Schriften. ` +
      `Gesetzt wird auf dem Gerät mit Typst ${typst} — also offline, auch am Telefon, und auf jeder ` +
      "Plattform, auf der Obsidian läuft.",
    printEnabled: "Drucken einschalten",
    printEnabledDesc: (megabytes: number) =>
      `Aus, bis du es einschaltest — denn das Einschalten lädt den Satzteil: ${megabytes} MB, ` +
      "einmal pro Gerät. Vorher wird nichts geladen.",
    printRuntimeInstalled: (megabytes: number) =>
      `Der Satzteil liegt auf diesem Gerät (${megabytes} MB). Drucken geht offline.`,
    printRuntimeMissing: (megabytes: number) =>
      `Der Satzteil liegt noch nicht auf diesem Gerät. Er ist ${megabytes} MB groß und wird einmal ` +
      "geladen — jetzt oder beim ersten Drucken.",
    printRuntimeHeading: "Der Satzteil",
    printDownloadNow: "Jetzt laden",
    printRemoveRuntime: "Satzteil entfernen",
    printAddTemplateDesc:
      "Legt eine der beiden Beispielvorlagen in einem Ordner deiner Wahl an. Keine bringt eine " +
      "Schrift mit, denn Schriften sind lizenziert; eine Vorlage ohne wird in Typsts eigener gesetzt.",
    printTemplateRoot: "Vorlagenordner",
    printTemplateRootDesc:
      "Wohin eine neue Vorlage standardmäßig kommt. Eine Vorlage ist jeder Ordner mit einer " +
      "template.md, die schreibstubePrintTemplate setzt — gefunden wird sie überall im Vault; " +
      "das hier bestimmt nur den Vorschlag.",
    printOutputFolder: "Zielordner",
    printOutputFolderDesc:
      "Wohin ein gedrucktes PDF geschrieben wird. Leer lassen, damit es neben der Notiz liegt.",
    printOutputBesideNote: "neben der Notiz",
    commandsHeading: "Befehle",
    commandsIntro: "In der Befehlspalette, jeweils mit „Schreibstube: “ davor.",

    syncHeading: "Dokument-Sync",
    syncIntro:
      "Eine Notiz wird an eine entfernte Markdown-Datei gebunden, indem schreibstubeSyncedFrom: " +
      "<url> ins Frontmatter kommt. Die Quelle ist die einzige Wahrheit: Änderungen erscheinen " +
      "als Karten in der Korrektur-Seitenleiste, zurückgeschrieben wird nie.",
    syncEnabled: "Dokument-Sync aktivieren",
    syncEnabledDesc: "Standardmäßig aus. Gebundene Notizen werden bis dahin ignoriert.",
    syncOnOpen: "Beim Öffnen einer gebundenen Notiz prüfen",
    syncOnOpenDesc:
      "Prüft zusätzlich beim Öffnen, im Rahmen des Intervalls unten. Sonst nur auf Befehl.",
    syncInterval: "Mindestabstand automatischer Prüfungen in Minuten",
    syncIntervalDesc:
      "Pro Notiz. Null prüft bei jedem Öffnen. Eine manuelle Prüfung läuft immer. Eine Notiz " +
      "mit schreibstubeSyncEvery — „Alle 2 Tage“, „wöchentlich“ oder ein Cron-Ausdruck — hält " +
      "sich an ihr eigenes Intervall statt an dieses.",
    syncToken: "GitHub-Token",
    syncTokenDesc:
      "Optional. Nötig für Quellen in privaten Repositories, und erhöht GitHubs Ratenlimit. " +
      "Liegt in Obsidians Secret Storage.",
    syncPoll: "Alle gebundenen Notizen im Hintergrund prüfen",
    syncPollDesc:
      "Prüft alle gebundenen Notizen nach Zeitplan, nicht nur die geöffnete. Änderungen werden " +
      "gezählt und erscheinen als Karten, sobald die Notiz geöffnet wird.",
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
    renameTooShort: "diese Notiz ist zu kurz, um aus ihrem Inhalt benannt zu werden.",
    cannotName: "nur eine Notiz oder ein Bild lässt sich aus dem Inhalt benennen.",
    renameFailedExists: "Umbenennen fehlgeschlagen — eine Datei dieses Namens existiert bereits.",
    imageTooLarge: "das Bild überschreitet 10 MB.",
    unsupportedImage: "nicht unterstütztes Format — möglich sind jpg, png, gif, webp.",
    failRename: "Schreibstube: Umbenennen fehlgeschlagen",
    failImage: "Schreibstube: Bild konnte nicht verarbeitet werden",
    failSummarize: "Schreibstube: Zusammenfassen fehlgeschlagen"
  },

  cron: {
    empty: "Kein Ausdruck angegeben.",
    fieldCount: (found: number) =>
      `Fünf Felder erwartet (Minute Stunde Tag Monat Wochentag), ${found} gefunden.`,
    invalidField: (name: string, value: string) => `Feld ${name}: "${value}" ist ungültig.`,
    fields: {
      minute: "Minute",
      hour: "Stunde",
      dayOfMonth: "Tag des Monats",
      month: "Monat",
      dayOfWeek: "Wochentag"
    },
    presets: {
      hourly: "Stündlich",
      everyFourHours: "Alle 4 Stunden",
      dailyEight: "Täglich 8:00",
      weekdaysEight: "Werktags 8:00"
    },
    nextRun: (when: string) => `Nächste Prüfung: ${when}`,
    never: "Gültig, aber dieser Zeitpunkt tritt nie ein."
  },

  source: {
    missing: "Keine Quell-URL angegeben.",
    notAUrl: "Quell-URL ist keine gültige URL.",
    notHttps: "Nur HTTPS-Quellen werden geladen.",
    notMarkdown: "Quelle ist keine Markdown-Datei (.md).",
    notFound: (status: number) => `Quelle nicht gefunden (HTTP ${status}).`,
    privateNeedsToken: "Für ein privates Repository wird ein GitHub-Token benötigt.",
    tokenNoAccess:
      "GitHub antwortet so auch, wenn das Token dieses Repository nicht sehen darf — " +
      "Repository-Zugriff des Tokens prüfen.",
    rateLimited: "GitHub-Ratenlimit erreicht. Ein Token erhöht das Limit deutlich.",
    denied: (status: number) => `Zugriff verweigert (HTTP ${status}). Token prüfen.`,
    httpStatus: (status: number) => `Quelle antwortete mit HTTP ${status}.`,
    metadataNotFile: "GitHub lieferte Metadaten statt Dateiinhalt.",
    notMarkdownType: (type: string) => `Quelle ist kein Markdown (${type}).`,
    tooLarge: "Quelle überschreitet die Größengrenze.",
    timeout: (seconds: number) => `Quelle antwortete nicht innerhalb von ${seconds}s.`,
    networkError: "Netzwerkfehler."
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
    panelProofread: "Korrektur lesen",
    panelGlossaryCheck: "Glossar prüfen",
    panelStop: "Abbrechen",
    panelCheckSource: "Quelle prüfen",
    noTerms: "Kein Glossar ausgewählt oder keine prüfbaren Begriffe.",
    running: "Korrektur läuft …",
    cancelled: "Korrektur abgebrochen.",
    failedShort: "Korrektur fehlgeschlagen.",
    unknownError: "Unbekannter Fehler.",
    applied: (count: number) => `${count} Änderungen übernommen.`,
    appliedWithSkipped: (applied: number, skipped: number) =>
      `${applied} übernommen, ${skipped} nicht mehr zuordenbar.`,
    noSuggestions: "Keine Vorschläge.",
    suggestions: (count: number) => `${count} Vorschläge.`,
    blocksRejected: (count: number) =>
      `${count} Abschnitt(e) verworfen (geschützter Inhalt verändert).`,
    chunksFailed: (count: number) => `${count} Anfrage(n) fehlgeschlagen.`,
    cardDiverged: "Lokale Änderung — Übernehmen stellt den Stand der Quelle wieder her.",
    cardFirstSync: "Erster Abgleich mit der Quelle.",
    sourceMatches: "Notiz entspricht der Quelle.",
    sourceUnchangedLocalEdits: "Quelle unverändert, die Notiz enthält lokale Änderungen.",
    divergedChanges: (count: number) =>
      `${count} Unterschied(e). Die Notiz wurde lokal geändert, Übernehmen stellt die Quelle ` +
      `wieder her.`,
    sourceChanges: (count: number) => `${count} Änderung(en) aus der Quelle.`,
    pendingFromPoll: (count: number) =>
      `${count} Änderung(en) aus der letzten Hintergrundprüfung. "Quelle prüfen" holt sie.`,
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
    disabled:
      "Dokument-Sync ist aus. Einschalten unter Einstellungen → Schreibstube → Dokument-Sync.",
    busy: "es läuft bereits eine Prüfung.",
    noneChecked: "keine gebundenen Notizen geprüft.",
    checked: (checked: number, changed: number, failed: number) =>
      `${checked} geprüft, ${changed} mit Aktualisierungen, ${failed} fehlgeschlagen.`,
    withUpdates: (count: number) =>
      `${count} Notiz(en) mit Aktualisierungen aus der Quelle — im Überprüfungsbereich übernehmen.`,

    every: {
      notWords:
        "das Prüfintervall dieser Notiz ist nicht lesbar. Schreibe es als „Alle 2 Tage“, " +
        "„wöchentlich“ oder als fünfteiligen Cron-Ausdruck.",
      tooSmall: "ein Prüfintervall muss mindestens eine Minute betragen.",
      panel: (words: string, cron: string) => `Höchstens ${words} geprüft (${cron})`,
      panelCron: (cron: string) => `Nach dem Zeitplan der Notiz geprüft (${cron})`
    }
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

  explorer: {
    title: "Schreibstube Explorer",
    empty: "In diesem Vault liegt noch keine Datei.",
    searchPlaceholder: "Alle Sektionen filtern …",
    clearFilter: "Filter leeren",
    taskCount: (open: number, total: number) => `${open} von ${total} Aufgaben offen`,
    filterMore: (count: number) => `${count} weitere Treffer. Filter eingrenzen, um sie zu sehen.`,
    collapseAll: "Alle zuklappen",
    expandAll: "Alle aufklappen",
    pinnedMore: "Alle Angehefteten zeigen",
    pinnedFewer: "Wieder drei zeigen",
    folderCount: (count: string) => `${count} Dateien`,

    move: {
      intoItself: (name: string) => `${name} lässt sich nicht in sich selbst verschieben.`,
      nameTaken: (name: string) => `Dort liegt bereits ${name}.`,
      failed: (name: string) => `${name} konnte nicht verschoben werden.`,
      title: (name: string) => `„${name}“ verschieben nach …`,
      root: "Vault-Wurzel",
      nowhere: (name: string) => `Es gibt keinen Ort, an den ${name} verschoben werden kann.`,
      done: (name: string, folder: string) => `${name} nach ${folder} verschoben.`
    },

    sections: {
      pinned: "Angeheftet",
      bookmarks: "Lesezeichen",
      latest: "Zuletzt",
      files: "Dateien und Ordner"
    },

    bookmarks: {
      empty: "Noch keine Lesezeichen.",
      hint: (path: string) =>
        `Trage sie in ${path} ein: eine Überschrift ist ein Ordner, ein Listenpunkt ein Link.`,
      missingFile: (path: string) => `Unter ${path} liegt noch keine Lesezeichen-Datei.`,
      badTarget: (name: string) => `${name} zeigt auf nichts, was sich öffnen lässt.`,
      missingFolder: (path: string) => `unter ${path} liegt kein Ordner.`,
      missingNote: (path: string) => `es gibt keine Notiz namens ${path}.`,
      copyPath: "Pfad für Schreibstube kopieren",
      copied: (path: string) => `${path} als Lesezeichen-Link kopiert.`,
      copyFailed: "die Zwischenablage steht hier nicht zur Verfügung.",
      quickOpen: "Lesezeichen suchen …",
      recent: "Zuletzt geöffnet",
      all: "Alle Lesezeichen"
    },

    latest: {
      synced: "Extern aktualisiert",
      alert: "Eine Quelle wurde im Hintergrund aktualisiert",
      created: "Erstellt",
      modified: "Geändert",
      empty: "Noch keine Notizen."
    },

    menu: {
      open: "Öffnen",
      openNewTab: "In neuem Tab öffnen",
      setIcon: "Symbol wählen …",
      changeIcon: "Symbol ändern …",
      clearIcon: "Symbol entfernen",
      keepTop: "Im Ordner oben halten",
      releaseTop: "Nicht mehr oben halten",
      pin: "Zu „Angeheftet“ hinzufügen",
      unpin: "Aus „Angeheftet“ entfernen",
      bindSource: "Mit Quelle verbinden …",
      checkSource: "Quelle jetzt prüfen",
      openSource: "Quelle öffnen",
      unbindSource: "Quellbindung entfernen",
      syncFolder: "Alle gebundenen Notizen hier prüfen",
      newNote: "Neue Notiz",
      newFolder: "Neuer Ordner",
      rename: "Umbenennen …",
      renameNoteAi: "Aus dem Text benennen …",
      renameImageAi: "Aus dem Bild benennen …",
      renaming: "Liest …",
      move: "Verschieben nach …",
      delete: "Löschen",
      more: "Weitere Aktionen"
    },

    icons: {
      title: "Symbol wählen",
      search: "Symbole suchen …",
      none: "Dazu passt kein Symbol.",
      clear: "Symbol entfernen",
      groups: {
        documents: "Dokumente",
        folders: "Ordner",
        property: "Immobilien",
        business: "Geschäft",
        status: "Status",
        misc: "Sonstiges"
      }
    },

    badge: {
      synced: "Mit der Quelle abgeglichen",
      pending: (count: number) => `${count} Änderung(en) aus der Quelle warten`,
      unchecked: "An eine Quelle gebunden, noch nie geprüft",
      error: "Die Quelle lässt sich nicht laden",
      checkedAt: (when: string) => `zuletzt geprüft ${when}`,
      never: "noch nie geprüft"
    },

    bind: {
      title: "Mit Quelle verbinden",
      desc:
        "Die Notiz spiegelt diese Markdown-Datei: die Quelle ist die Wahrheit, zurück " +
        "geschrieben wird nie. Nur HTTPS; eine GitHub-Seiten-URL wird auf die Rohform " +
        "umgeschrieben.",
      placeholder: "https://raw.githubusercontent.com/owner/repo/main/notiz.md",
      submit: "Verbinden",
      bound: (name: string) => `${name} ist jetzt an die Quelle gebunden.`,
      unbound: (name: string) => `${name} ist nicht mehr an eine Quelle gebunden.`,
      noSource: "diese Notiz hat keine Quelle zum Öffnen.",
      checked: (name: string) => `${name} ist auf dem Stand der Quelle.`,
      failed: (reason: string) => `Quelle konnte nicht geladen werden — ${reason}`,
      folderChecked: (checked: number, changed: number, failed: number) =>
        `${checked} geprüft, ${changed} mit Aktualisierungen, ${failed} fehlgeschlagen.`,
      folderEmpty: "keine gebundenen Notizen in diesem Ordner."
    },

    create: {
      noteTitle: "Neue Notiz",
      folderTitle: "Neuer Ordner",
      namePlaceholder: "Name",
      renameTitle: "Umbenennen",
      exists: "unter dem Namen liegt dort schon etwas.",
      invalid: "dieser Name ist nicht verwendbar."
    },

    delete: {
      title: "Löschen",
      confirm: (name: string) => `„${name}“ in den Papierkorb des Vaults verschieben?`,
      folderConfirm: (name: string, count: number) =>
        `„${name}“ mit ${count} enthaltenen Objekt(en) in den Papierkorb des Vaults verschieben?`,
      submit: "Löschen",
      failed: (name: string) => `„${name}“ konnte nicht gelöscht werden.`
    }
  },

  print: {
    noNote: "zuerst eine Notiz öffnen — gedruckt wird die Notiz, die vor dir liegt.",
    noTemplates:
      "keine Druckvorlage in diesem Vault. Eine Vorlage ist ein Ordner mit template.md und " +
      "template.typ; „Drucken: Vorlage anlegen“ legt eine an.",
    unknownTemplate: (name: string) =>
      `diese Notiz verlangt die Vorlage „${name}“, und kein Ordner in diesem Vault ist eine.`,
    noLayout: (name: string) => `${name} hat keine template.typ — damit lässt sich nichts drucken.`,
    working: (name: string) => `drucke mit ${name} …`,
    drawing: (index: number, total: number) => `zeichne Diagramm ${index} von ${total} …`,
    downloading: (label: string, megabytes: number) =>
      `lade den Satzteil „${label}“ (${megabytes} MB, einmal pro Gerät) …`,
    verifying: "prüfe das Geladene …",
    starting: "starte den Satz …",
    compiling: "setze …",
    mismatch: (detail: string) =>
      `der geladene Satzteil ist nicht der erwartete und wurde nicht benutzt (${detail}).`,
    unreachable: (detail: string) =>
      `der Satzteil ließ sich nicht laden (${detail}). Er wird einmal pro Gerät gebraucht; mit Netz erneut versuchen.`,
    compilerRefused: (detail: string) => `die Vorlage ließ sich nicht setzen — ${detail}`,
    pictureFailed: (name: string) => `${name} ließ sich nicht lesen und fehlt`,
    panelsLost: (index: number, missing: number, total: number) =>
      `Diagramm ${index}: ${missing} von ${total} Zeichnungen ließen sich nicht aufnehmen und fehlen`,
    done: (path: string, kilobytes: number) => `${path} gedruckt (${kilobytes} KB).`,
    withWarnings: (detail: string) => `gedruckt, aber etwas fehlt — ${detail}`,
    failed: (detail: string) => `Drucken fehlgeschlagen — ${detail}`,
    chooseTemplate: "Mit welcher Vorlage drucken?",
    templateHint: "schreibstubePrintTemplate in der Notiz setzen, um das zu überspringen.",
    offTitle: "Drucken ist aus",
    offMessage: (megabytes: number) =>
      `Gesetzt wird auf diesem Gerät statt auf einem Server — dafür braucht es einen Satzteil: ` +
      `${megabytes} MB, einmal geladen und dann behalten. Zum Laden das Drucken einschalten.`,
    offSubmit: "Drucken einschalten",
    unsupported:
      "dieses Gerät kann den Satzteil nicht ausführen, hier lässt sich also nicht drucken. " +
      "Drucken braucht WebAssembly, einen Worker und eine Prüfsumme — was jede Plattform, auf " +
      "der Obsidian läuft, normalerweise hat.",
    runtimeReady: "der Satzteil liegt auf diesem Gerät. Ab jetzt geht Drucken offline.",
    runtimeRemoved: "der Satzteil wurde entfernt. Der nächste Druck lädt ihn erneut.",
    chooseExample: "Welche Vorlage soll ich anlegen?",
    chooseFolder: "In welchen Ordner soll die Vorlage?",
    templateExists: (path: string) => `${path} gibt es schon und blieb unangetastet.`,
    templateAdded: (path: string) =>
      `${path} angelegt. Die template.md darin sagt, was die Vorlage braucht; eine Schrift kommt ` +
      "in ihren fonts/-Ordner."
  },

  secrets: {
    notSelected: (label: string) => `kein ${label} ausgewählt — in den Einstellungen einen wählen.`,
    notFound: (label: string) => `${label} nicht gefunden — Einstellungen prüfen.`,
    apiKey: "API-Schlüssel",
    mailToken: "Mail-Token",
    publishToken: "Publish-Token",
    githubToken: "GitHub-Token"
  }
};
