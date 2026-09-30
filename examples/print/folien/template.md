---
schreibstubePrintTemplate: true
schreibstubeEntry: slides
schreibstubeSlides: true
schreibstubePage: { size: presentation-16-9, margin: "16mm 20mm 14mm" }
schreibstubeData:
  subtitle: ""
  author: ""
  accent: ""
  font: ""
  logo: ""
---

# Folien

Eine Notiz als Präsentation: jede Folie eine Seite, im Format 16:9 oder 4:3. Die Gliederung der Notiz ist die Gliederung der Folien; nichts muss umgebaut werden.

## Die Gliederung

| Im Markdown        | Auf den Folien                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `#`                | neue Folie mit Titel; ohne Text darunter ein Kapiteltrenner                                     |
| `#` ganz am Anfang | ohne Text darunter die Titelfolie                                                               |
| `##`               | neue Folie mit Titel                                                                            |
| `###`              | eine Spalte; die Überschrift steht über ihr. Zwei `###` ergeben zwei Spalten, drei ergeben drei |
| `####`             | eine Zwischenüberschrift in ihrer Spalte                                                        |
| `---`              | neue Folie ohne Titel, etwa um eine volle Folie fortzusetzen                                    |

Was vor der ersten `###` steht, läuft über die ganze Breite. Ab der vierten `###` beginnt eine zweite Reihe, statt dass die Spalten schmaler werden.

Gleich breit sind die Spalten, solange die Folie nichts anderes sagt. Ein Kommentar, den jede Markdown-Ansicht verbirgt, ändert das: `## Zwei Wege <!-- columns: 1 2 -->` teilt in ein Drittel und zwei Drittel, `<!-- columns: 2 1 1 -->` bei drei Spalten die Hälfte und zwei Viertel. Der Kommentar darf auch in einer eigenen Zeile in der Folie stehen, und Obsidians `%% columns: 1 2 %%` gilt genauso. Passt die Zahl der Breiten nicht zur Zahl der Spalten, bleiben sie gleich breit, und der Druck sagt es.

Im Druckdialog wählt **Ausrichtung**, ob der Inhalt mittig steht (so beginnt er) oder links. Die Ausrichtung verschiebt Blöcke, nicht Zeilen: mittig steht ein Absatz, eine Liste oder eine Tabelle als Ganzes in der Mitte, die Zeilen darin bleiben linksbündig. `align: left` in der Notiz lässt den Dialog links beginnen.

Ein Bild zeigt seinen Alternativtext als Bildunterschrift: auf einer Folie ohne Spalten rechts neben dem Bild, unten bündig, in einer Spalte darunter. `![Küche nach der Renovierung](kueche.jpg)` schreibt ihn; ein Bild ohne Text steht allein.

Eine Folie, auf der mehr steht, als passt, wird als Ganzes verkleinert, bis sie passt — sie wird nie abgeschnitten und nie auf eine zweite Seite umbrochen. Sehr kleine Schrift in der Vorschau heißt: diese Folie gehört geteilt.

## Einrichten

Unter `schreibstubeData` stehen die Angaben der Titelfolie: `author` hier für jede Präsentation, `subtitle` besser in der Notiz. Gesetzt ist sie in Fira Sans, die das Plugin mit dem Typesetter lädt.

### Eigenes Erscheinungsbild

Drei Werte machen aus den Folien die eigenen; leer bleibt es beim Blau und bei Fira Sans.

```yaml
schreibstubeData:
  accent: "#8c1a33"
  font: Source Sans 3
  logo: logo.png
```

- `accent` ist die Farbe für Linien, Spaltenköpfe, Aufzählungspunkte und Links, geschrieben als `#rrggbb`. Eine Angabe in anderer Form lässt es beim Blau.
- `font` ist der Familienname einer Schrift, deren Dateien (`.ttf` oder `.otf`) in `fonts/` in diesem Ordner liegen. Code bleibt in JetBrains Mono.
- `logo` ist der Dateiname eines Bildes, das direkt in diesem Ordner liegt. Es steht oben rechts auf jeder Folie und groß über dem Titel der Titelfolie; Kapiteltrenner bleiben ohne. Fehlt die Datei, wird ohne Logo gedruckt und der Druck sagt, welche fehlt.

Jeder der drei Werte lässt sich in einer Notiz unter `schreibstubePrint` überschreiben, etwa `accent` für die Präsentation eines Partners.

## Benutzen

```yaml
---
schreibstubePrintTemplate: Folien
schreibstubePrint:
  subtitle: Quartalsbericht Vertrieb
  format: "4:3"
  align: left
---
```

Das Format wählt der Druckdialog; `format` in der Notiz legt fest, womit er beginnt. Ohne Angabe ist es 16:9.

## Werte, die die Vorlage liest

| Schlüssel  | Woher                                   | Wofür                       |
| ---------- | --------------------------------------- | --------------------------- |
| `title`    | erste Überschrift der Notiz, sonst Name | Fußzeile jeder Folie        |
| `subtitle` | Notiz oder Vorlage                      | Titelfolie, unter dem Titel |
| `author`   | Vorlage oder Notiz                      | Titelfolie, vor dem Datum   |
| `accent`   | Vorlage oder Notiz                      | Farbe der Linien und Köpfe  |
| `font`     | Vorlage oder Notiz                      | Schrift des Textes          |
| `logo`     | Vorlage oder Notiz                      | Logo auf jeder Folie        |
| `date`     | automatisch, Notiz sticht               | Titelfolie                  |
| `lang`     | Sprache des Plugins                     | Silbentrennung              |
