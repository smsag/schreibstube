---
schreibstubePrintTemplate: true
schreibstubeEntry: slides
schreibstubeSlides: true
schreibstubePage: { size: presentation-16-9, margin: "16mm 20mm 14mm" }
schreibstubeData:
  subtitle: ""
  author: ""
---

# Folien

Eine Notiz als Präsentation: jede Folie eine Seite, im Format 16:9 oder 4:3. Die Gliederung der Notiz ist die Gliederung der Folien; nichts muss umgebaut werden.

## Die Gliederung

| Im Markdown        | Auf den Folien                                               |
| ------------------ | ------------------------------------------------------------ |
| `#`                | neue Folie mit Titel; ohne Text darunter ein Kapiteltrenner  |
| `#` ganz am Anfang | ohne Text darunter die Titelfolie                            |
| `##`               | neue Folie mit Titel                                         |
| `###`              | eine von zwei Spalten; die Überschrift steht über der Spalte |
| `####`             | eine von drei Spalten                                        |
| `---`              | neue Folie ohne Titel, etwa um eine volle Folie fortzusetzen |

Welche der beiden Spaltenebenen eine Folie zuerst trifft, gilt für die ganze Folie; die andere ist dort eine gewöhnliche Zwischenüberschrift in ihrer Spalte. Was vor der ersten Spaltenüberschrift steht, läuft über die ganze Breite. Mehr Spalten, als die Ebene hat, beginnen eine zweite Reihe.

Eine Folie, auf der mehr steht, als passt, wird als Ganzes verkleinert, bis sie passt — sie wird nie abgeschnitten und nie auf eine zweite Seite umbrochen. Sehr kleine Schrift in der Vorschau heißt: diese Folie gehört geteilt.

## Einrichten

Unter `schreibstubeData` stehen die Angaben der Titelfolie: `author` hier für jede Präsentation, `subtitle` besser in der Notiz. Gesetzt ist sie in Fira Sans, die das Plugin mit dem Typesetter lädt.

## Benutzen

```yaml
---
schreibstubePrintTemplate: Folien
schreibstubePrint:
  subtitle: Quartalsbericht Vertrieb
  format: "4:3"
---
```

Das Format wählt der Druckdialog; `format` in der Notiz legt fest, womit er beginnt. Ohne Angabe ist es 16:9.

## Werte, die die Vorlage liest

| Schlüssel  | Woher                                   | Wofür                       |
| ---------- | --------------------------------------- | --------------------------- |
| `title`    | erste Überschrift der Notiz, sonst Name | Fußzeile jeder Folie        |
| `subtitle` | Notiz oder Vorlage                      | Titelfolie, unter dem Titel |
| `author`   | Vorlage oder Notiz                      | Titelfolie, vor dem Datum   |
| `date`     | automatisch, Notiz sticht               | Titelfolie                  |
| `lang`     | Sprache des Plugins                     | Silbentrennung              |
