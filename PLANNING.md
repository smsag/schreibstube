# The day planner

Schreibstube plans the tasks in your vault into time blocks. A block is an hour
in your calendar with a project tag on it and a list of tasks that belong to it.
The tasks stay plain Markdown: nothing is written into a note but a tick.

## What it looks like

In a note, a task and its project:

```markdown
## Konzept

- [ ] Datenschutz für #projects/ea48 klären
- [ ] Konzept für #projects/ea48 fertigstellen
```

In the planner leaf (**Open day planner**), you set a deadline for
`#projects/ea48`, take one of the blocks it proposes, tick the tasks that belong
in it, and confirm. The block appears in your calendar as **EA48**, and every
device that shows your calendar shows it.

On a start page, a block draws the same plan:

````markdown
```schreibstube-plan
day: today
tags: projects/ea48
show: both
```
````

| Option | Values                        | Meaning                                    |
| ------ | ----------------------------- | ------------------------------------------ |
| `day`  | `today` or `YYYY-MM-DD`       | Which day to show. Default `today`.        |
| `tags` | comma-separated tags          | Only these projects. Default: all of them. |
| `show` | `blocks`, `deadlines`, `both` | Default `both`.                            |

## Why a task has no due date

A task belongs to a block. That is the link, so nothing has to be faked with a
clock — and nothing disappears from a widget because a minute has passed. A task
may still carry a real deadline, `📅 2026-09-25`, and a project's deadline is
set on its tag; both are information, not scheduling.

## What lives where

| Fact                              | Where                      | Why                                                             |
| --------------------------------- | -------------------------- | --------------------------------------------------------------- |
| Task text, project tag            | The note                   | It is your writing                                              |
| Done or not                       | The note                   | The one thing the planner writes back                           |
| Tag deadlines, blocks, membership | The bridge                 | The plan changes whenever you replan, and every client needs it |
| The block itself                  | Your calendar, over CalDAV | Visible on every device with nothing running                    |
| Reminders for selected tasks      | Apple Reminders            | Only for the few tasks worth carrying out of the vault          |

## Recognising a task again

Nothing identifies a task inside the note, so the plan keeps an **anchor** for
each task it refers to: the note, a hash of the wording, that wording, and which
of the identically worded tasks in the note it is. Every pass matches the
current scan against those anchors:

1. the same note and position, by hash — almost everything, almost always;
2. the same note, same wording, wherever it moved to;
3. the same note, similar wording, for an edited task;
4. similar wording anywhere, for a task moved to another note.

A match must be clearly better than the runner-up. Where it is not — two
near-identical tasks reworded in the same pass — the planner says the task was
not found rather than binding the wrong one, and the block keeps its place in
the meantime. Renaming a note moves its anchors, because Obsidian says so.

## Reminders

A task can be marked **also in Erinnerungen** when it goes into a block. The
plugin never writes to Reminders itself: it puts operations in a queue inside
the plan, and a drain applies them on an Apple device —

- a small **Mac helper** using EventKit, run by a launch agent (separate repo);
- the **iOS/macOS app**, when it exists;
- or a **Shortcut** run by hand.

iCloud fans out whatever any one device writes, so one drain covers every
device. Completions come back the same way: a drain puts them in the plan, the
plugin ticks the task in its note.

The queue holds the last operation for each task as the record of what Reminders
was told, so a queue that has caught up produces no new work however often the
planner runs.

## Settings

**Settings → Schreibstube → Tagesplan.** The bridge URL and a token (an Obsidian
secret, as with mail), the calendars to read, the tag prefix that makes a tag a
project, and what the planner assumes about a morning: when a block starts, how
long it runs, how many tasks fit in one.

## The bridge

The planner needs the `plan` capability on your own bridge: it stores the plan
document and speaks CalDAV to your calendar. See `bridge/README.md` for its
configuration and routes, and for what it stores — the plan document is the one
thing the bridge keeps.

## Not in this repository

- The **Mac helper** that drains the reminder queue.
- The **iOS/macOS app and widget**, which read the same plan document, show the
  block with its tasks inside it, and add Pomodoro and Live Activities.

Both talk to the same routes and the same document, which is what this file and
`bridge/README.md` describe.
