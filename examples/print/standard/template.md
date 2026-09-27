---
schreibstubePrintTemplate: true
schreibstubeEntry: standard
schreibstubePage: { size: a4, margin: "25mm 25mm 30mm" }
---

# Standard

Die Vorlage, mit der gedruckt wird, wenn nichts anderes verlangt ist: das Klartext-Theme auf Papier. A4, der Text in JetBrains Mono und im Flattersatz, Überschriften, Tabellenköpfe und Callout-Beschriftungen in Fira Sans, Striche, Ziffern und Zitatbalken in hellem Grau, Code zwischen zwei Haarlinien, Links in Textfarbe mit gepunkteter Linie. Unten stehen Titel und Seitenzahl, sobald es mehr als eine Seite ist. Sie ist in Schreibstube eingebaut und muss nicht im Vault liegen.

## Anpassen

Diese Kopie im Vault ersetzt die eingebaute, solange sie `Standard` heißt: Ändere hier die `template.typ`, und jede Notiz ohne eigene Vorlage wird so gedruckt. Soll wieder die eingebaute gelten, benenne diesen Ordner um oder lösche ihn.

Fira Sans und JetBrains Mono lädt das Plugin mit dem Satzteil. Eine andere Schrift legst du in `fonts/` und nennst sie in der `template.typ` bei `let mono` oder `let sans`.

Soll der Text nicht in Festbreitenschrift stehen, schalte in den Druck-Einstellungen **Text in Festbreitenschrift** aus; dann wird er in Fira Sans gesetzt. Eine einzelne Notiz entscheidet selbst:

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
| `monospace` | die Notiz, sonst die Druck-Einstellung  | `false`: Text in Fira Sans statt JetBrains Mono |
