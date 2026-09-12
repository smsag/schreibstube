/**
 * A deliberately awkward vault, and a large one.
 *
 * The tests used to describe the site someone would write on purpose. These
 * describe the one that turns up: emoji in a filename, a note that is one long
 * line, a date in the wrong shape, a title that is only punctuation, an
 * attachment nobody embeds, and a wikilink to a note that was never published.
 */
import { createHash } from "node:crypto";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const notes = [
  {
    name: "Hallo Welt",
    slug: "hallo-welt",
    title: "Hallo Welt",
    date: "2026-09-12",
    description: "Der erste Beitrag.",
    body: [
      "Ein Absatz mit [[Grundstück Größe|einem Link]] und einem toten [[Fehlt]].",
      "",
      "> [!warning] Achtung",
      "> Ein Callout mit **Fett** und `Code`.",
      "",
      "> [!tip]- Eingeklappt",
      "> Versteckt, ohne JavaScript.",
      "",
      "| Spalte | Wert |",
      "|---|---|",
      "| a | 1 |",
      "",
      "- [x] erledigt",
      "- [ ] offen",
      "",
      "Eine Fussnote.[^1]",
      "",
      "[^1]: Die Anmerkung.",
      "",
      "![[bild.png]]",
      "",
      "%% Dieser Kommentar darf nie erscheinen. %%"
    ].join("\n")
  },
  {
    name: "Grundstück Größe",
    slug: "grundstueck-groesse",
    title: "Grundstück & Größe",
    date: "2026-08-01",
    body: [
      "Umlaute im Titel, Mathematik im Text: $E = mc^2$.",
      "",
      "$$",
      "a^2 + b^2 = c^2",
      "$$"
    ].join("\n")
  },
  {
    name: "🌱 Notiz mit Emoji",
    slug: "notiz-mit-emoji",
    title: "🌱 Notiz mit Emoji",
    date: "2026-07-15",
    body: "Ein Name, den niemand als Pfad verwenden sollte.\n\n![[clip.mp4]]"
  },
  {
    name: "Eine Zeile",
    slug: "eine-zeile",
    title: "Eine sehr lange Zeile",
    date: "2026-07-01",
    body: `Lang. ${"Wort ".repeat(2000)}Ende.`
  },
  {
    name: "Diagramm",
    slug: "diagramm",
    title: "Diagramm",
    date: "2026-06-01",
    body: ["```mermaid", "flowchart LR", "  A --> B", "```"].join("\n")
  },
  {
    name: "Ohne Titel",
    slug: "ohne-titel",
    title: "Ohne Titel",
    date: "",
    body: "Kein Datum, keine Überschrift, nur Text."
  }
];

const assets = [
  { name: "bild.png", bytes: Buffer.from("89504e470d0a1a0a", "hex") },
  { name: "clip.mp4", bytes: Buffer.from("000000206674797069736f6d", "hex") },
  { name: "ungenutzt.png", bytes: Buffer.from("89504e470d0a1a0a00", "hex") }
];

/** The index and the sources, as the plugin would send them. */
export function awkwardVault() {
  const sources = new Map();

  const indexNotes = notes.map((note) => {
    const source = `---\npublished: true\n---\n\n# ${note.title}\n\n${note.body}\n`;
    const hash = sha256(source);
    sources.set(hash, source);

    return {
      sourcePath: `Blog/${note.name}.md`,
      sha256: hash,
      slug: note.slug,
      title: note.title,
      date: note.date,
      description: note.description
    };
  });

  const index = {
    siteTitle: "Schreibstube",
    notes: indexNotes,
    assets: assets.map((asset) => ({
      sourcePath: `Blog/${asset.name}`,
      sha256: sha256(asset.bytes),
      name: asset.name,
      bytes: asset.bytes.length
    }))
  };

  return { index, sources };
}

/** A vault large enough to show a quadratic rendering mistake. */
export function largeVault(count) {
  const sources = new Map();

  const indexNotes = Array.from({ length: count }, (_, i) => {
    const source =
      `---\npublished: true\n---\n\n# Beitrag ${i}\n\n` +
      `Ein Absatz mit [[Beitrag ${(i + 1) % count}]] und etwas Text.\n\n` +
      "| a | b |\n|---|---|\n| 1 | 2 |\n";
    const hash = sha256(source);
    sources.set(hash, source);

    return {
      sourcePath: `Blog/Beitrag ${i}.md`,
      sha256: hash,
      slug: `beitrag-${i}`,
      title: `Beitrag ${i}`,
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`
    };
  });

  return { index: { siteTitle: "Schreibstube", notes: indexNotes, assets: [] }, sources };
}
