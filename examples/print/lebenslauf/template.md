---
schreibstubePrintTemplate: true
schreibstubeEntry: cv
schreibstubePage: { size: a4, margin: "41.4pt 54.5pt 34pt" }
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

Trage Name, Adresse und Kontakt hier oben in `schreibstubeData` ein. Mehrere Kontaktangaben trennst du mit `·`; gedruckt stehen sie mit etwas Luft um den Punkt.

Für ein Foto legst du die Bilddatei (PNG, JPG, WebP, GIF oder SVG) direkt in diesen Ordner, nicht in einen Unterordner, und setzt `photo` auf ihren Dateinamen, etwa `photo: foto.jpg`. Es wird quadratisch zugeschnitten und mit runden Ecken gesetzt; ohne Foto rückt der Kopf nach links und nichts bleibt leer stehen.

Gesetzt ist sie in Fira Sans, die Überschriften in Fira Sans Condensed; beide lädt das Plugin mit dem Satzteil. Die Abstände sind an einem Export aus iA Writer gemessen: Listen enger als Absätze, feste Stufen um die Überschriften. Trennlinien (`---`) beginnen eine neue Seite.

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

## Aktualisieren

Eine neue Version des Plugins ändert diese Kopie nicht. Um sie zu übernehmen, ohne deine Angaben zu verlieren, ersetze `template.typ` durch die neue und übernimm die Zeile `schreibstubePage` oben; `schreibstubeData`, dein Foto und `fonts/` bleiben, wie sie sind. **Vorlage anlegen** legt keine zweite Kopie in einen Ordner, in dem schon eine liegt.
