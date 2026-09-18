---
schreibstubePrintTemplate: true
schreibstubeEntry: cv
schreibstubePage: { size: a4 }
schreibstubeHrIsPageBreak: true
schreibstubeData:
  name: Vorname Nachname
  address: "Musterstraße 1, 12345 Musterstadt, DE"
  contact: "+49 000 0000000 · du@example.de"
  photo: ""
---

# Lebenslauf

Foto und Kontakt oben, darunter die Überschriften der Notiz selbst. Die Gliederung, die ein Lebenslauf ohnehin hat, wird gesetzt statt umgebaut.

## Die Gliederung

| Ebene | Im Markdown | Auf dem Papier                         |
| ----- | ----------- | -------------------------------------- |
| 3     | `###`       | Abschnitt: Berufserfahrung, Ausbildung |
| 4     | `####`      | Position                               |
| 5     | `#####`     | Arbeitgeber und Zeitraum, grau         |

Kursives wird grau und aufrecht gesetzt — gedacht für die Stufe hinter einem Werkzeug (`Linear — *Experte*`).

## Einrichten

Trage Name, Adresse und Kontakt hier oben in `schreibstubeData` ein. Für ein Foto legst du die Bilddatei in diesen Ordner und setzt `photo` auf ihren Dateinamen; ohne Foto rückt der Kopf nach links und nichts bleibt leer stehen.

Lege deine Schriftdateien in `fonts/` ab. Diese Vorlage fragt nach Fira Sans und Fira Sans Condensed; ohne sie setzt Typst in seiner eingebauten Schrift.

## Benutzen

```yaml
---
schreibstubePrintTemplate: Lebenslauf
---
```

Mehr braucht die Notiz nicht, wenn alles Persönliche in der Vorlage steht. Ein einzelner Wert lässt sich für eine Bewerbung überschreiben:

```yaml
schreibstubePrint:
  contact: "+49 000 0000000 · bewerbung@example.de"
```
