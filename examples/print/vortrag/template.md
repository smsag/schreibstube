---
schreibstubePrintTemplate: true
schreibstubeEntry: vortrag
schreibstubeSlides: true
schreibstubePage: { size: presentation-16-9, margin: "16mm 22mm 14mm" }
schreibstubeData:
  subtitle: ""
  author: ""
  scheme: light
  logo: ""
---

# Vortrag

Eine Notiz als Präsentation im Klartext-Theme: jede Folie eine Seite, im Format 16:9 oder 4:3. Der Text steht in JetBrains Mono und im Flattersatz, Überschriften in Fira Sans, eng gesetzt. Es gibt keine Akzentfarbe. Jede Markierung ist Schrift in hellem Grau: Ein Folientitel trägt seine Ebene als kleines `#₁` oder `#₂` am Rand, ein Listenpunkt einen Strich, ein Schritt seine Ziffer ohne Punkt. Code steht zwischen zwei Haarlinien unter `</> Sprache`, Links in Textfarbe mit gepunkteter Linie, Callouts mit einem Strich in ihrer Farbe. Das helle und das dunkle Farbschema des Themes stehen beide zur Wahl.

Die Gliederung der Notiz ist die Gliederung der Folien, genau wie bei **Folien**; nichts muss umgebaut werden.

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

- `## Zwei Wege <!-- columns: 1 2 -->` teilt in ein Drittel und zwei Drittel; Obsidians `%% columns: 1 2 %%` gilt genauso.
- `<!-- layout: image-left -->` oder `image-right` setzt das erste Bild der Folie auf eine Hälfte in voller Höhe.
- Ein Bild allein auf einer Folie bekommt den ganzen Platz unter dem Titel. Sein Alternativtext ist die Bildunterschrift: `![Küche nach der Renovierung](kueche.jpg)`.
- `> [!notes]` sind Sprechernotizen. Keine Folie zeigt sie; **Sprechernotizen** im Druckdialog hängt sie nach der letzten Folie an.
- `<!-- agenda -->` auf einer Folie listet dort die Kapiteltrenner des Vortrags.

Eine Folie, auf der mehr steht, als passt, wird als Ganzes verkleinert, bis sie passt. Sehr kleine Schrift in der Vorschau heißt: diese Folie gehört geteilt.

## Einrichten

Unter `schreibstubeData` stehen die Werte, die für jede Präsentation gelten: `author` für die Titelfolie, `scheme` für das Farbschema, `logo` für ein Bild. `subtitle` schreibt man besser in die Notiz.

- `scheme: light` ist das helle Schema des Themes, gut für ein PDF zum Mitlesen und für helle Räume. `scheme: dark` ist das dunkle, ruhiger auf einem Beamer im abgedunkelten Raum. Jeder andere Wert bleibt hell.
- `logo` ist der Dateiname eines Bildes, das direkt in diesem Ordner liegt. Es steht oben rechts auf jeder Folie und über dem Titel der Titelfolie; Kapiteltrenner bleiben ohne. Fehlt die Datei, wird ohne Logo gedruckt, und der Druck sagt, welche fehlt.

Im Druckdialog wählt **Schrift des Textes** zwischen JetBrains Mono, wie im Theme, und Fira Sans; Überschriften und Code bleiben, wie sie sind. **Format** wählt 16:9 oder 4:3, **Ausrichtung** mittig oder links. Die Ausrichtung verschiebt Blöcke, nicht Zeilen: Ein Absatz oder eine Liste steht als Ganzes in der Mitte, die Zeilen darin bleiben linksbündig.

Fira Sans und JetBrains Mono lädt das Plugin mit dem Typesetter; ein `fonts/`-Ordner ist nicht nötig.

## Benutzen

```yaml
---
schreibstubePrintTemplate: Vortrag
schreibstubePrint:
  subtitle: Eigentümerversammlung 2026
  scheme: dark
  format: "16:9"
  align: left
  monospace: false
---
```

Jeder Wert unter `schreibstubeData` lässt sich so in einer Notiz überschreiben. `format`, `align` und `monospace` legen fest, womit der Druckdialog beginnt.

## Werte, die die Vorlage liest

| Schlüssel   | Woher                                   | Wofür                                           |
| ----------- | --------------------------------------- | ----------------------------------------------- |
| `title`     | erste Überschrift der Notiz, sonst Name | Fußzeile jeder Folie                            |
| `subtitle`  | Notiz oder Vorlage                      | Titelfolie, unter dem Titel                     |
| `author`    | Vorlage oder Notiz                      | Titelfolie, vor dem Datum                       |
| `scheme`    | Vorlage oder Notiz                      | `light` oder `dark`                             |
| `logo`      | Vorlage oder Notiz                      | Logo auf jeder Folie                            |
| `date`      | automatisch, Notiz sticht               | Titelfolie                                      |
| `monospace` | Druckdialog, beginnend bei der Notiz    | `false`: Text in Fira Sans statt JetBrains Mono |
| `lang`      | Sprache des Plugins                     | Silbentrennung                                  |
