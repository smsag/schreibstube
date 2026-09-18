# Syncing tasks with Erinnerungen

Schreibstube keeps one list in Apple's Reminders in step with the tasks in your
vault. You don't send tasks one at a time. Tasks say whether they should be
reminders, and the sync keeps Reminders matching.

## What becomes a reminder

A task with a due date in the Tasks plugin's form, or with the tag `#remind`:

```markdown
- [ ] Call the editor 📅 2026-09-20
- [ ] Order more paper #remind
```

Under **Settings → Schreibstube → Erinnerungen → What becomes a reminder** you
can limit this to `#remind`, so a due date alone is not enough.
**Make task a reminder** (also in the editor's context menu) adds the tag to the
task under the cursor.

The first sync gives every such task a block id at the end of its line:

```markdown
- [ ] Call the editor 📅 2026-09-20 ^r-k3x9a2
```

The id ties the task to its reminder. Obsidian hides it in Reading view. With the
sync on, Live Preview shows it as a small Reminders mark. If you delete the id,
the next sync treats the task as new.

The reminder gets:

| Reminder field | From the task                                                                 |
| -------------- | ----------------------------------------------------------------------------- |
| Title          | The task line, without the box, dates, `#remind` and the id. Other tags stay. |
| Notes          | The text indented under the task, then `↩ Note title` and a link back.        |
| Due date       | `📅 YYYY-MM-DD`, as an all-day date.                                          |
| Completed      | The box.                                                                      |

The link back, `obsidian://schreibstube?task=r-k3x9a2&from=reminders`, opens the
note on the task's line, even after the note has been renamed or moved.

## Who wins

| Change                                | Result                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Task text, date or body edited        | The reminder is updated. The note owns these fields.                    |
| Reminder completed or reopened        | The task is ticked or reopened.                                         |
| Task ticked or unticked in the note   | The reminder follows.                                                   |
| Task deleted, or no longer a reminder | The reminder is deleted.                                                |
| Reminder deleted in Reminders         | The task keeps its date and id. It is not sent again until you edit it. |
| Title edited in Reminders             | Overwritten the next time the task changes in the note.                 |

Reminders added to the list by hand are never touched. The sync only handles
reminders whose notes contain its link.

## How it works

Obsidian cannot reach Reminders, but a Shortcut can. The plugin and the Shortcut
exchange three files in the sync folder (`.schreibstube/reminders` by default):

- **`outbox.json`**, written by the plugin: every operation Reminders has not
  confirmed yet.
- **`inbox.json`**, written by the Shortcut: a snapshot of the list after it has
  applied the outbox.
- **`state.json`**, the plugin's own record of what both sides last agreed on.
  Don't edit it. If you delete it, the next sync rebuilds it, but it can't tell
  a reminder deleted in Reminders apart until the Shortcut has run once.

The plugin makes every decision. The Shortcut only carries out what the outbox
says and reports what the list holds. Operations can be replayed safely, so an
outbox applied twice, or by two devices, does no harm.

### `outbox.json`

```json
{
  "v": 1,
  "seq": 7,
  "list": "Schreibstube",
  "ops": [
    {
      "op": "upsert",
      "id": "r-k3x9a2",
      "match": "task=r-k3x9a2&",
      "title": "Call the editor",
      "notes": "↩ Plan\nobsidian://schreibstube?task=r-k3x9a2&from=reminders",
      "due": "2026-09-20",
      "done": true
    },
    { "op": "delete", "id": "r-p0q1w2", "match": "task=r-p0q1w2&" }
  ]
}
```

- `upsert`: find the reminder in `list` whose notes contain `match`. If there is
  none, create it. Then set title, notes and due date (`null` means no due date).
  Set completion only when `done` is present.
- `delete`: remove the reminder whose notes contain `match`, if there is one.

### `inbox.json`

```json
{
  "appliedSeq": 7,
  "at": "2026-09-18T10:00:00+02:00",
  "reminders": [
    {
      "notes": "…obsidian://schreibstube?task=r-k3x9a2&from=reminders",
      "done": true,
      "title": "Call the editor"
    }
  ]
}
```

- `appliedSeq` is the `seq` of the outbox the Shortcut just applied (0 if there
  was none).
- `at` is when the snapshot was taken, in ISO 8601. The plugin reads each
  snapshot once and ignores one no newer than the last.
- `reminders` lists every reminder in the list, done or not. The plugin
  recognises its own by the link in `notes` and ignores the rest. `done` may be
  a Boolean, `1`, or "Yes".

## Setting it up

Do this on every device that should sync. The plugin side is one switch.

### 1. Turn it on

**Settings → Schreibstube → Erinnerungen → Sync with Erinnerungen.** Choose the
list; a list of its own is best. If the list doesn't exist yet, create it in
Reminders.

### 2. The Shortcut "Schreibstube Sync"

**Get the Shortcut** in the settings opens the install link once it is
published. Until then, build it once in the Shortcuts app as follows. The
Shortcut takes no input.

1. **Get File** from the vault folder, path `.schreibstube/reminders/outbox.json`,
   with _Error If Not Found_ off. (On iOS, pick the vault folder once. The
   Shortcut keeps access to it.)
2. **If** _File_ has any value:
   1. **Get Dictionary from** the file. **Get Dictionary Value** `ops` into a
      variable _Ops_, and `seq` into _Seq_.
   2. **Repeat with Each** item in _Ops_:
      1. **Get Dictionary Value** `match`, `op`, `title`, `notes`, `due` and
         `done` from _Repeat Item_.
      2. **Find Reminders** where _List_ is your list and _Notes_ contains
         _match_, limit 1.
      3. If _op_ is `delete`: **Remove Reminders** (the found one), when one
         was found.
      4. Otherwise, if none was found: **Add New Reminder** with _title_,
         _notes_ and your list, with the due date from _due_ when it has a value.
         Then **Find Reminders** again for the new reminder.
      5. **Edit Reminder**: set title, notes and due date. If _done_ has a
         value, set _Is Completed_ to it.
3. Otherwise, set _Seq_ to `0`.
4. **Find Reminders** where _List_ is your list and _Notes_ contains
   `schreibstube?task=`, completed or not.
5. **Repeat with Each** found reminder: a **Dictionary** with `notes` (Notes),
   `done` (Is Completed) and `title` (Title).
6. A **Dictionary** with `appliedSeq` (_Seq_), `at` (**Current Date**,
   formatted ISO 8601) and `reminders` (_Repeat Results_).
7. **Save File** to `.schreibstube/reminders/inbox.json` in the vault folder,
   with _Overwrite If File Exists_ on.

If the _List_ filter won't accept a variable, pick the list directly in the
Shortcut, and keep the setting pointing to the same list.

### 3. Two automations

In **Shortcuts → Automation**, add two **App** automations for Obsidian, both
running **Schreibstube Sync**:

- **Is Closed** sends what changed in the notes.
- **Is Opened** brings back what was ticked in Reminders.

Set both to **Run Immediately** and turn **Notify When Run** off, so they run
in the background.

## When it syncs

- **In Obsidian:** a few seconds after a note changes, and immediately when
  Obsidian goes to the background. The outbox is then current when the
  "Is Closed" automation reads it. The inbox is checked every twenty seconds and
  when Obsidian comes back to the foreground.
- **In Reminders:** whenever Obsidian comes to the front or leaves it. This fits
  the usual way of working: to tick a reminder you switch to Reminders, and when
  you come back the tick is pulled in.
- **Now:** the command **Sync with Erinnerungen now**.

One gap: if you tick a reminder from a notification banner while Obsidian stays
in front, the tick arrives only the next time you switch apps.

## Limits

- Reminders' own tags can't be set from outside. `#tag` stays as text in the
  title.
- Only the due date syncs, not a time, alerts, priority or recurrence.
- If the same block id is used in two notes, only the first task is synced. The
  developer console names the second.
- The vault has to be reachable from Shortcuts. That works for vaults in iCloud
  Drive and in "On My iPhone", including Obsidian Sync vaults.

## Coming from 1.35 or earlier

Tasks sent with **Send task to Erinnerungen** had a link at the end of the line,
`[⏰](obsidian://schreibstube?task=ab12cd)`. The first sync turns it into
`#remind ^ab12cd`. The old reminder's link still opens the task. The sync creates
the reminder anew in the synced list, so delete the old one from wherever the
previous Shortcut put it. The two old Shortcuts, the report file and its
automation are no longer used.
