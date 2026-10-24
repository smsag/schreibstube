# Related passages for projects

Schreibstube (Obsidian) searches the vault by meaning; Nimbus (a native macOS/iOS app on the same vault) writes
project status reports and wants the notes that belong to a project without carrying its tag. Nimbus cannot call
Schreibstube's search: it runs only inside Obsidian, and on a phone the two never run side by side. So Schreibstube
writes what it found into one file in the vault, and Nimbus reads only that file. This document is the file's
contract; `related-cases.json` holds the examples both test suites run. A change here is a change in both apps.

Nothing else is shared: Nimbus reads neither Schreibstube's index nor its settings.

## 1. The file

`.obsidian/plugins/schreibstube/nimbus-related.json`, UTF-8 JSON, at most 2 MB.

```json
{
  "format": "schreibstube-related",
  "version": 1,
  "writtenAt": "2026-10-14T18:00:00.000Z",
  "model": "xenova-paraphrase-multilingual-MiniLM-L12-v2",
  "floor": 0.65,
  "projects": [
    {
      "tag": "propstack/2026-c3",
      "note": "_inbox/Propstack 2026-C3.md",
      "related": [
        {
          "path": "Meetings/Weekly 2026-10-12.md",
          "heading": "Compliance",
          "text": "## Compliance\nDie Anforderungen für den Energieausweis …",
          "score": 0.712,
          "modified": "2026-10-12T09:41:00.000Z"
        }
      ]
    }
  ]
}
```

- `format` is exactly `schreibstube-related`, `version` exactly `1`. A reader refuses any other value and says so;
  it never guesses at another version.
- `writtenAt`, `modified`: ISO 8601 in UTC (`Date.prototype.toISOString`).
- `model`: the embedding model the scores come from. `floor`: the lowest score written (that model's "balanced"
  related floor).
- `projects`: one entry per project, sorted by `tag`. `note` is the project note's vault path.
- `related`: best first (by `score`, then `path`), at most 20 per project. One entry per note: its best passage.
  - `path`: vault path of the note, with `.md`.
  - `heading`: the words of the heading line the passage starts with (without `#` and the space), `null` when it
    starts with none.
  - `text`: the passage as Schreibstube embedded it (frontmatter, code and URLs removed, links as their words), at
    most 600 UTF-16 code units; longer is cut at 600.
  - `score`: cosine similarity to the closest of the project's own passages, rounded to three decimals, at least
    `floor`.
  - `modified`: the note's last modification time.

## 2. Which projects

A note is a project when its frontmatter has `nimbusProject` with a non-empty string value. The tag is that value
trimmed of spaces and tabs, lowercased, without every leading `#`, without `/` at either end (Nimbus' rule for tags,
`TaggedTasks.normalized`); empty after that: no project. Two notes with the same tag: the first by path (code-unit order) is
the project; the other is ignored. A note that opts out of the index (`schreibstubeIndex: false`) is no project.

## 3. The project's own passages

The passages a project is searched from (its anchors):

- every passage of the project note, and
- every passage of any other note whose text contains the tag as a tag: `#` + the tag, or `#` + the tag + `/…`
  (case-insensitive), not preceded by a letter, digit, `_`, `#`, `&`, `/`, `]`, `[` or `=`.

Only passages with substance count: after removing heading lines and tags, at least 40 letters or digits. At most
32 anchors: the project note's first, then other notes' by path.

## 4. Which notes are related

A candidate is any indexed note that is not the project note and contains no passage with the project's tag (those
are the project's own and already known to the reader). Its score is its best passage's cosine to any anchor; it is
related when the score is at least `floor` and that passage has substance (as in 3). Notes with `type: summary` in
their frontmatter (reports, also Nimbus' own) are no candidates.

No recency or folder filter is applied here: the reader decides what it shows.

The writer bounds its work, and a list can come out shorter for it: at most 250 projects per file (the first by tag),
at most 400 notes read per project to tell which carry its tag (past that, a note Obsidian lists with the tag is
treated as carrying it), and at most 120 candidates read per project to fill its 20. Trimmed to the 2 MB limit, the
last entries of the longest lists go first.

## 5. When it is written

- Only by the device that keeps the index (desktop by default): a phone never writes the file. Of two desktops on
  one vault, one: the first to write names itself in `nimbus-related.writer.json` beside the file, and another
  desktop takes over only once that claim is three days old. So two devices never write it at once. The reader
  ignores the claim file.
- After the index has changed (built, a note re-embedded or removed) and when a project note changed, at most once
  every five minutes, and only when the content (everything but `writtenAt`) differs from the file on disk.
- No projects: the file is written with an empty `projects` list, so a reader can tell "no projects" from "never
  written".
- When the search is switched off, the file is deleted, by the desktop that writes it.

## 6. What the reader does (Nimbus)

- Missing file, or Schreibstube not in `.obsidian/community-plugins.json`: as if there were no Schreibstube; the
  report says nothing about it.
- Unreadable, wrong `format`, other `version`, larger than 2 MB: said in the report ("Schreibstube-Liste nicht
  lesbar"), never guessed at.
- `writtenAt` older than 14 days: said in the report.
- From the project's entry: notes it reads as sources anyway, reports, notes it doesn't know and notes not changed
  in the last 30 days are dropped; the first five remain.
