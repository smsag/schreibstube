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

- a **Shortcut**, run a few times a day by an automation, on iPhone, iPad or Mac;
- a small **Mac helper** using EventKit, run by a launch agent (separate repo);
- the **iOS/macOS app**, when it exists.

All of them ask the bridge the same two things — `GET /plan/queue` and
`POST /plan/queue/ack` — so none has to understand the plan's revisions.
iCloud fans out whatever any one device writes, so one drain covers every
device. Completions come back the same way: the bridge compares what the list
says with what the planner last sent, records what someone changed in
Reminders, and the plugin ticks the task in its note. [REMINDERS.md](REMINDERS.md)
has the calls and the Shortcut.

The queue holds the last operation for each task as the record of what Reminders
was told, so a queue that has caught up produces no new work however often the
planner runs. Two rules keep that record honest:

- a marked task the planner cannot find on a pass — a note not yet synced to
  this device, a rewording it could not be sure of — keeps its reminder as it
  is; only a task that is gone, or no longer marked, has its reminder deleted;
- the record of a reminder that may still exist is never pushed out of the
  bounded queue. Applied deletes make room first; when there is still none, a
  newly marked task waits.

## Settings

**Settings → Schreibstube → Tagesplan.** The bridge URL and a token (an Obsidian
secret, as with mail), the calendars to read, the tag prefix that makes a tag a
project, and what the planner assumes about a morning: when a block starts, how
long it runs, how many tasks fit in one, and whether weekends count, and the
Reminders list the marked tasks go to.

Calendars are named as your calendar app shows them. On iCloud the server
addresses a calendar by an opaque identifier; the bridge finds the one behind
each name, without regard to case. The first calendar listed is where new
blocks are created.

All-day events show at the top of the day and are not treated as busy time: a
birthday does not take the morning.

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
