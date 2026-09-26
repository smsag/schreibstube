---
schreibstubePrintTemplate: true
schreibstubeEntry: standard
schreibstubePage: { size: a4, margin: "25mm 25mm 30mm" }
---

# Standard

Die Vorlage, mit der gedruckt wird, wenn nichts anderes verlangt ist: A4, die Überschriften der Notiz, die Seitenzahl unten, sobald es mehr als eine Seite ist. Sie ist in Schreibstube eingebaut und muss nicht im Vault liegen.

## Anpassen

Diese Kopie im Vault ersetzt die eingebaute, solange sie `Standard` heißt: Ändere hier die `template.typ`, und jede Notiz ohne eigene Vorlage wird so gedruckt. Soll wieder die eingebaute gelten, benenne diesen Ordner um oder lösche ihn.

Lege eine Schrift in `fonts/` und nenne sie in der `template.typ` bei `set text(font: …)`. Ohne eigene Schrift wird in der Standardschrift gesetzt, die das Plugin mit dem Satzteil lädt — Libertinus Serif, und DejaVu Sans Mono für Code.

## Benutzen

Nichts. Eine Notiz ohne `schreibstubePrintTemplate` wird mit der Standardvorlage gedruckt, solange in den Druck-Einstellungen keine andere als Standard gewählt ist. Ausdrücklich verlangen lässt sie sich auch:

```yaml
---
schreibstubePrintTemplate: Standard
---
```

## Werte, die die Vorlage liest

| Schlüssel | Woher                                   | Wofür                                         |
| --------- | --------------------------------------- | --------------------------------------------- |
| `title`   | erste Überschrift der Notiz, sonst Name | Titel des PDFs; Titelzeile, wenn keine da ist |
| `lang`    | Sprache des Plugins                     | Silbentrennung                                |
