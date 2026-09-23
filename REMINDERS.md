# Tasks in Erinnerungen

A few tasks are worth carrying out of the vault: onto the Watch, into Siri, into
the list you check away from your desk. The day planner decides which ones. When
it puts a task into a block you can mark it **also in Erinnerungen**, and it
becomes a reminder in one list, **Schreibstube** unless you name another
(**Settings → Schreibstube → Tagesplan → Reminders list**).

Nothing is written into the note for it. The planner keeps its reminders in the
plan on your bridge, the same place it keeps the blocks.

## What a reminder says

| Reminder field | From                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| Title          | The task's words, tags included.                                          |
| Notes          | `↩ Note name`, then a link back: `obsidian://schreibstube?key=k-…`.       |
| Due date       | The task's own `📅` date if it has one, otherwise its project's deadline. |
| Completed      | The task's box.                                                           |

Following the link opens the note on the task's line, even after the note was
renamed, moved or the task reworded.

## Who wins

| Change                                     | Result                                                  |
| ------------------------------------------ | ------------------------------------------------------- |
| Task edited, ticked or dated in the note   | The reminder follows.                                   |
| Reminder ticked or reopened in Reminders   | The task's box follows, the next time the planner runs. |
| Task no longer marked, or its block gone   | The reminder is deleted.                                |
| Task not found on a pass (note not synced) | The reminder is left as it is.                          |
| A box marked otherwise (`[-]`, `[>]`)      | Left alone; only `[ ]` and `[x]` are changed.           |

Reminders added to the list by hand are never touched.

## How it reaches Reminders

Nothing on a server can write to iCloud's reminders; something on an Apple device
has to. The planner never does it itself. It puts operations in a queue inside the
plan, and a **drain** on a Mac, iPhone or iPad applies them. iCloud then carries
the result to every other device, so one drain covers all of them, and the drain
does not need Obsidian to be open.

A drain asks the bridge two things, with the plan token:

**`GET /plan/queue`** — what is still to do:

```json
{
  "acked": 6,
  "seq": 7,
  "ops": [
    {
      "seq": 7,
      "op": "upsert",
      "key": "k-3x9a2mq7tv",
      "match": "schreibstube?key=k-3x9a2mq7tv",
      "title": "Datenschutz für #projects/ea48 klären",
      "notes": "↩ Konzept\nobsidian://schreibstube?key=k-3x9a2mq7tv",
      "due": "2026-09-25",
      "done": false,
      "list": "Schreibstube"
    }
  ]
}
```

- `upsert`: find the reminder in `list` whose notes contain `match`. If there is
  none, create it. Set title, notes, due date (`null` for none) and completion.
- `delete`: remove the reminder whose notes contain `match`, if there is one.

**`POST /plan/queue/ack`** — what was done, and what the list now says:

```json
{
  "seq": 7,
  "reminders": [{ "notes": "↩ Konzept\nobsidian://schreibstube?key=k-3x9a2mq7tv", "done": true }]
}
```

`seq` is the `seq` from the queue you just applied. `reminders` is every reminder
in the list, with its notes and whether it is completed; the bridge picks out the
planner's own by the link and works out which ones someone ticked or reopened. It
answers `{"acked": 7, "completions": 1}`.

Both calls carry `Authorization: Bearer <PLAN_TOKEN>`.

## The drains

### A Shortcut, "Schreibstube Erinnerungen"

Works on iPhone, iPad and Mac, with nothing else installed. When you add it, it
asks for the bridge's address and the plan token.

1. **Get Contents of URL**: `GET <bridge>/plan/queue`, header
   `Authorization: Bearer <token>`.
2. **Get Dictionary Value** `ops` and `seq`.
3. **Repeat with Each** operation:
   1. **Find Reminders** where _List_ is the list and _Notes_ contains the
      operation's `match`.
   2. For `delete`: **Remove Reminders** for what was found.
   3. For `upsert`: if nothing was found, **Add New Reminder** with `title`,
      `notes`, the list and `due`; then set _Is Completed_ from `done`.
      Otherwise **Edit Reminder** with the same fields.
4. **Find Reminders** where _List_ is the list and _Notes_ contains
   `schreibstube?key=`, completed or not.
5. **Repeat with Each**: a **Dictionary** with `notes` (Notes) and `done`
   (Is Completed).
6. **Get Contents of URL**: `POST <bridge>/plan/queue/ack`, same header, JSON
   body `seq` and `reminders` (the repeat's results).

Run it from a personal automation — a time of day, a few times a day, is plenty:
the plan is not a stopwatch. Set it to **Run Immediately** with **Notify When
Run** off.

### The Mac helper and the app

A small helper on a Mac that is on, and the Schreibstube app when it exists, use
the same two calls. They live in their own repositories.

## Coming from 1.35 or earlier

**Send task to Erinnerungen**, its two Shortcuts and the report file are gone;
the planner's "also in Erinnerungen" replaces them. Tasks sent back then still
end in a link like `[⏰](obsidian://schreibstube?task=ab12cd)`, and the reminders
they made still carry it: following such a reminder still opens its task. Those
old reminders are no longer kept in step. Delete them from their list when you
plan the task anew, or leave them; nothing reads them.
