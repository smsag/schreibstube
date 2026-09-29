---
schreibstubePrintTemplate: true
schreibstubeEntry: standard
schreibstubePage: { size: a4, margin: "25mm 25mm 30mm" }
---

# Standard

Die Vorlage, mit der gedruckt wird, wenn nichts anderes verlangt ist: das Klartext-Theme auf Papier. A4, der Text in JetBrains Mono und im Flattersatz, Überschriften, Tabellenköpfe und Callout-Beschriftungen in Fira Sans, Striche, Ziffern und Zitatbalken in hellem Grau, Code zwischen zwei Haarlinien, Links in Textfarbe mit gepunkteter Linie. Unten stehen Titel und Seitenzahl, sobald es mehr als eine Seite ist. Sie ist in Schreibstube eingebaut und muss nicht im Vault liegen.

## Eingebaut

Standard ist Teil von Schreibstube, nicht des Vaults: Sie steht immer zur Wahl, lässt sich nicht löschen und liegt in keinem Vorlagenordner. **Vorlage anlegen** bietet sie deshalb nicht zum Kopieren an. Eine Vorlage im Vault, die ebenfalls `Standard` heißt, tritt nicht an ihre Stelle; sie ist über ihren Ordnerpfad erreichbar.

Fira Sans und JetBrains Mono lädt das Plugin mit dem Typesetter.

Im Druckdialog wählt **Schrift des Textes** zwischen JetBrains Mono und Fira Sans; der Seitenfuß folgt der Wahl, Überschriften, Tabellen und Code bleiben, wie sie sind. Die Wahl gilt für diesen einen Druck. Eine Notiz, die immer in Fira Sans gedruckt werden soll, sagt es selbst, und der Dialog beginnt dann dort:

```yaml
---
schreibstubePrint:
  monospace: false
---
```

## Benutzen

Nichts. Eine Notiz ohne `schreibstubePrintTemplate` wird mit der Standardvorlage gedruckt, solange in den Druck-Einstellungen keine andere als Standard gewählt ist. Ausdrücklich verlangen lässt sie sich auch:

```yaml
---
schreibstubePrintTemplate: Standard
---
```

## Werte, die die Vorlage liest

| Schlüssel   | Woher                                   | Wofür                                           |
| ----------- | --------------------------------------- | ----------------------------------------------- |
| `title`     | erste Überschrift der Notiz, sonst Name | Titel des PDFs; Titelzeile, wenn keine da ist   |
| `lang`      | Sprache des Plugins                     | Silbentrennung                                  |
| `monospace` | Druckdialog, beginnend bei der Notiz    | `false`: Text in Fira Sans statt JetBrains Mono |
