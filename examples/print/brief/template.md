---
schreibstubePrintTemplate: true
schreibstubeEntry: letter
schreibstubePage: { size: a4 }
schreibstubeData:
  senderName: Vorname Nachname
  senderAddress: "Musterstraße 1\n12345 Musterstadt"
  senderPhone: ""
  senderEmail: ""
  recipient: ""
  subject: ""
  signature: Mit freundlichen Grüßen
---

# Brief

Ein deutscher Geschäftsbrief nach DIN 5008: Absender klein über dem Anschriftenfeld, Empfänger dort, wo ein Fensterumschlag ihn zeigt, Datum rechts, Betreff fett, dann der Text.

## Einrichten

Trage deinen Absender einmal hier oben in `schreibstubeData` ein. Er gilt dann für jeden Brief, der diese Vorlage benutzt.

Lege deine Schriftdateien in `fonts/` ab — `.ttf` oder `.otf`. Ohne eigene Schrift setzt Typst den Brief in seiner eingebauten Schrift, was funktioniert, aber nicht nach dir aussieht.

## Benutzen

Eine Notiz, die als Brief gedruckt wird, sagt im Frontmatter, an wen sie geht:

```yaml
---
schreibstubePrintTemplate: Brief
schreibstubePrint:
  recipient: "Frau Handan Ekinci\nHintere Marktstraße 83\n90441 Nürnberg"
  subject: Kündigung Tanzkurs
---
```

Der Text der Notiz ist der Text des Briefes — Anrede, Inhalt, Dank. Gruß und Unterschrift kommen aus der Vorlage.

## Werte, die die Vorlage liest

| Schlüssel       | Woher                     | Wofür                               |
| --------------- | ------------------------- | ----------------------------------- |
| `senderName`    | Vorlage                   | Absenderzeile und Rücksendeangabe   |
| `senderAddress` | Vorlage                   | ebenso; Zeilenumbrüche sind erlaubt |
| `senderPhone`   | Vorlage                   | optional, unter der Adresse         |
| `senderEmail`   | Vorlage                   | optional, darunter                  |
| `recipient`     | Notiz                     | das Anschriftenfeld                 |
| `subject`       | Notiz                     | die Betreffzeile                    |
| `date`          | automatisch, Notiz sticht | rechts über dem Betreff             |
| `signature`     | Vorlage                   | die Grußformel am Ende              |
