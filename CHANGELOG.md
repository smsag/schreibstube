# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Changed

- **A slideshow's header stays out of the way.** The alt text and the controls in the row above a slideshow now appear only while the pointer is over the block or a control has the keyboard focus. On a phone, which has no pointer, a tap on a picture or on the row shows them and the next tap, or a swipe, hides them again. The row keeps its height, so nothing below the block moves when they come and go. This is the same in every layout, from the stage to the before-and-after.
- **A swipe on a slideshow is the slideshow's alone.** A sideways swipe across the stage or the scene in the note has turned the page since the block existed, but the note could scroll with it and, on a phone, Obsidian could answer the same swipe by sliding a sidebar in over the note. Once a finger is clearly moving sideways the block now claims the gesture: the note stays put and nothing above the block sees it. Which travel is a tap, a swipe or a scroll is one small decision module with tests.

### Fixed

- **The icon picker no longer shows blank squares after an update.** The plugin's icon font is put into the window once and was never taken out again, and Obsidian updates a plugin in place, in the same window. After an update the window kept the previous version's font, the picker listed every icon the new version knew, and each icon the old font lacked was a blank square until Obsidian was restarted. The font now leaves with the plugin on unload, and a font from another build is replaced rather than kept.
- **The tag icon draws as a tag.** Its codepoint lies above the Basic Multilingual Plane, and the generated map wrote it as four digits and a leftover, which drew as a foreign letter followed by a 6. The map now writes every codepoint in the braced form.


## 1.41.0 - 2026-09-23

A folder's pictures, as tiles. Right-click a folder in the Explorer and
choose "Images as tiles": a tab in the main area shows the folder's own
pictures as a grid — its own, not its subfolders', so an archive with a
folder per year shows one year at a time. While the tab is open it follows
the pane; press another folder and the grid shows that one, without taking
the focus from the tree, and its tab is named for the folder it is showing.
A tile opens its picture in a new tab, a right-click or long press gives the
file's menu, and pictures load as they scroll into view.

Mobile checklist: not run. What a phone would answer differently: a long
press on a tile opening the menu without also opening the picture, two
columns at phone width, and lazy loading inside the tab's own scrolling.

The bridge's protocol is unchanged; bridge 2.4.0 still pairs with this release.

### Added

- **A folder's pictures as tiles.** **Images as tiles** on a folder's menu opens a tab in the main area with the folder's own pictures as a grid — its own, not its subfolders'. While the tab is open it follows the pane: press another folder in the tree and the grid shows that one, without taking the focus from the tree; close the tab and it stops. A tile opens its picture in a new tab, never in the grid's own; a right-click or long press gives the file's menu. Up to 400 tiles, with a line saying how many more; pictures load as they scroll into view. Which files are pictures and in what order is one pure module with tests; the view only draws. A command, **Explorer: this note's folder as tiles**, offers the same for the folder of the open note.

## 1.40.0 - 2026-09-23

An icon can sit in a sentence. Type a colon and two letters of an icon's
name and a picker offers the matches; what goes into the note is `:folder:`,
which this plugin draws as the glyph in Live Preview and Reading view and
every other reader sees as a word that says what was meant. A colon after a
word never opens the picker, so prose keeps its colons, and a shortcode in
code, a link or a URL stays text. One setting switches it off for a vault
where another plugin already claims the colon.

Mobile checklist: not run. The picker is Obsidian's own suggest and the glyph
is a font the plugin already installs, so both should behave on a phone; the
cursor-adjacency rule, which turns a glyph back into its colons when the
cursor touches it, is the one thing a touch screen might answer differently.

The bridge's protocol is unchanged; bridge 2.4.0 still pairs with this release.

### Added

- **Icons in the text.** Type a colon and two letters of an icon's name — `:fo` — and a picker lists the icons that match; Enter writes `:folder: `. In Live Preview and Reading view the shortcode is drawn as the glyph, sized to the text and on its baseline, and shows its colons again under the cursor. The note holds the name, never the glyph: the icons are a font only this plugin installs, so `:folder:` reads as a word wherever the plugin is not. A colon after a word — the kind prose is full of — never opens the picker, and a shortcode inside code, a link or a URL stays text; both rules are one pure module with tests. A setting under **Icons in the text** switches all of it off, for a vault where another plugin already uses the colon.

## 1.39.0 - 2026-09-23

The file pane learns the three things a file manager is expected to know and
did not: several rows at once, an undo, and a way in from the desktop. ⌘-click
and ⇧-click gather rows, and a menu on any of them moves or deletes them all;
the notice after a move or a delete carries Undo for thirty seconds, and a
delete is undone by lifting the file out of the vault's own trash; files
dropped from Finder land in the folder under the pointer, named the way a new
note is named. Underneath, the deletion path that was reviewed for this
release gets its edges fixed — a folder refilled by a sync client within the
grace no longer stays hidden, the grace timer is owned, the name dialog refuses
what the vault refuses — and the tree can be walked by keyboard for the first
time. A note can also be summarised from a PDF it embeds, each passage followed
by a mark that opens the PDF at the page it came from. And the review card
says what its buttons do: "Show" is "Locate", and an update from a source no
longer offers a "Reject" that changed nothing.

Mobile checklist: not run — and this release has more for a phone to say than
most. The keyboard layer and the desktop drop degrade to nothing there by
nature; the undo notice's tappable word, the selection's `aria-selected` on
every row, the PDF passage picker and the review card with one button fewer
all render on a phone and none has been tried on one. All of it is covered by
the suite and was built on a desktop.

The bridge's protocol is unchanged; bridge 2.4.0 still pairs with this release.

### Added

- **A summary out of an attached PDF, with the way back into it.** **Insert: summary from the attached PDF** reads the PDF a doc embeds or links, offers its passages, and writes the ones you choose at the cursor — each followed by a mark that opens the PDF at the page the passage came from. The mark is an ordinary Obsidian link (`Bericht.pdf#page=12&selection=…`), so it needs nothing to render, survives sync, and works in Reading view. The text is read with the pdf.js Obsidian already ships, which is why the feature costs 7 KB rather than a megabyte. A scan says so instead of offering an empty list, and a document past 200 pages says how much of it was read.
- **Several rows at once.** ⌘-click adds a row to the selection, ⇧-click takes every row between the anchor and here, ⇧-arrow grows the range one row at a time, and Escape lets it go. A right click or the menu key on a selected row opens a menu for all of them: **Move … to…** offers only the folders every one of them could go to, and **Delete …** asks once. The rules — what a click does to a selection, when a menu acts on it — are one pure function, `explorer-selection`, with a test for each.
- **Undo, after a move or a delete.** The notice that says what happened now carries **Undo**, for thirty seconds; ⌘Z in the pane and **Explorer: undo the last move or delete** do the same. A move is undone by moving back, and refused with a word when something is at the old path now. A delete is undone by lifting the file out of the vault's own `.trash` — found by listing that folder before and after the trash call, since Obsidian does not say where a file went — and a vault set to use the system trash is told plainly that the pane cannot reach into it.
- **Files dragged in from the desktop.** Drop them on a folder, on any row inside it, or on the header for the root. Each file's path, or the reason it is left out, is decided by `planImport` before a byte is read: a name already taken gets the next free one, the way a new note is named; a folder dropped from the desktop is refused rather than written as an empty file; a file over 200 MB, or the fifty-first in one drop, is left out and named in the notice.

### Changed

- **The review card's "Show" is now "Locate".** It never showed the change — the card does that — it selected the card's text in the note and scrolled there, which is the look-before-you-accept step; the old word promised something else. For an update that inserts text the note does not have yet, the button reads **Locate insertion point** and selects the last words before the point, so the landing is visible rather than a bare cursor that looks as if nothing happened.
- **An update from a source no longer offers "Reject".** Rejecting only hid the card until the next check, which found the source still differing and offered the same card again, while the note stayed marked as having updates it had not taken. The choice on such a card is to accept the update or to leave the note as it is; leaving it needs no button. Proofreading cards keep theirs.

### Fixed

- **A folder deleted and refilled within ten seconds no longer stays hidden.** The pane takes a trashed row away at once and believes the vault again after a grace, but a file a sync client wrote back under that folder within the grace cleared only its own path from what was held back — the folder above it stayed trashed, and so did everything in it, until the timer gave up. A path that exists now clears every folder above it too, on a create and on a rename alike; the rename case had no handling at all.
- **The delete grace timer is owned.** It was a bare `setTimeout` nobody could cancel, so unloading the plugin within ten seconds of a delete left it to fire into a controller that was already gone. Each timer is kept by path and cleared on stop, and cleared early the moment the vault confirms the delete.
- **The name dialog refuses what the vault refuses.** Rename and create checked for `\`, `/` and `:` and approved everything else; the vault then refused `?`, `*`, a leading dot and half a dozen more, every one with the same notice. The rules are one function now, `checkFileName`, with a line under the field for each — and the same characters `sanitizeFilename` strips from a proposed name, so what one removes the other refuses. Surrounding spaces are trimmed rather than kept.
- **The tree can be walked by keyboard.** Every row said `role="treeitem"` and none could take focus. Tab reaches the tree, arrows move and fold, Enter opens, Delete and ⌘⌫ delete, F2 renames, and the menu key opens the menu a right click would. The bindings are a pure map with a test, `rowKeyAction`, so the contract is not something to verify by tabbing through a vault.
- **The delete confirmation opens on Cancel.** Enter from the keyboard that opened it now declines; confirming is one Tab away.
- **A bookmarked note deleted a moment ago leaves the Bookmarks list at once**, as it already left the tree, Latest and the pinned block. It was the one list still waiting for the vault's own event.
- **Deleting or moving a folder forgets its files from the filter's cache.** The vault reports a folder as one event, and the cache was keyed by file, so the files under it were remembered under paths that no longer existed. Forgotten by prefix now.
- **Dragging a row no longer walks the vault on every pointer move.** The paths are read once when the drag begins; the drop still checks against the vault as it is then.
- The confirmation said "the vault's trash"; which trash is the person's own setting, and it may be the system's.

## 1.38.0 - 2026-09-22

Synced notes tell the truth about what is waiting. The Explorer's "Updated
externally" list, its mark, the note badge and the background notice now all
ask one question — does the source hold text the note has not taken — so a
note listed there shows its update cards on "Quelle prüfen", and drops out once
they are accepted. Behind that, devices sharing a vault stop overwriting each
other's sync records: each save merges them note by note, so an update accepted
on one device is not reported again on the next. The Explorer also keeps its
place while you open and close folders, notes under Latest get the same menu as
the tree, and the filter field gains a visible edge and a loupe.

Mobile checklist: not run — and a phone has things to say about this one: a
long press on a Latest row opening the menu (item 7), buttons answering the
first tap on an iPhone, and the pane no longer jumping to the open note on the
first folder tapped after the drawer reopens. All of it is covered by the suite
and was built on a desktop; none of it has been tried on a phone.

The bridge's protocol is unchanged; bridge 2.4.0 still pairs with this release.

### Added
- **Latest rows have the file menu.** A right click, or a long press on a
  phone, on a note under Latest opens the same menu the tree gives it, so a
  note found there can be deleted, renamed or moved without first finding it
  in the tree below.

### Changed
- **The filter field has an edge you can see, and a loupe.** It was a filled box
  with a hairline of `--background-modifier-border` — a token meant for the seam
  between two surfaces. Measured, that edge came out at 1.23:1 in light, and in
  dark at exactly 1.00:1: Obsidian sets the form-field fill to the same colour
  that token resolves to, so fill and edge were one colour and there was no edge
  at all. WCAG asks 3:1 for the boundary of a control.

  The box is gone rather than tinted harder. The pane is already a box, and a
  second one at the top of it was the heaviest thing above a tree of
  thirteen-pixel rows. What is left is the field on the pane's own ground with
  one rule under it, mixed from `--text-normal` so it follows any theme — 54% in
  light, 44% in dark, which clears 3:1 against every background a pane can sit
  on, under Obsidian's own themes and under Klartext. It also gains the loupe it
  never had: the field said "filter" only in its placeholder, which is gone the
  moment anything is typed.

- **Focus says something.** The rule thickens to 2px in the accent, and nothing
  else moves — no ring, which this pane clips along its upper edge into
  something that reads as a rendering fault rather than as focus.

- **The task tally reads as a tally.** The pill behind the figures beside a
  note's name was a wash of the accent so faint it looked like a grey box, so
  the numbers were set in a heavier weight to be findable at all — emphasis
  arriving twice, inside a pill, on a line of plain names. The wash now carries
  the accent properly and the figures sit at the row's own weight, with a
  little more room inside the pill. Nothing about what it says has changed: it
  is still done over total, and a note with nothing left open still loses its
  fill entirely.
- The two places that show a tally — the file pane's rows and the pinned-tag
  cards — held a copy of the pill's styling each, and had drifted. They now
  share one, so a change to the pill can no longer reach one surface and miss
  the other.

### Fixed
- **Devices no longer overwrite each other's sync records.** Each device kept
  its own copy of the records in memory and wrote all of it back on every
  save, so whichever device saved last decided what every device knew: an
  update fetched and accepted on one was forgotten when the other saved, and
  checked again there as news. A save now reads the data file first and merges
  the records note by note, the later check winning; a record dropped on this
  device stays dropped unless another device checked it since. When another
  device's save arrives, its records are merged in the same way at once.
  Other settings keep the rule they had: the last save wins.

- **"Updated externally" lists only what "Quelle prüfen" will show.** The
  Latest section, its mark, the note badge and the poll's notice each asked a
  different question. The list asked whether a source had ever moved, which
  stays true after the update is in the note, and a device whose records were
  behind (another device had fetched and accepted the update, and the note
  arrived by vault sync) stamped a change the note already held. The notice
  asked whether the note differs from its source, which a note with edits of
  its own does on every poll. All of them now ask one thing: does the source
  hold text the note has not taken. A note drops out of the list once its
  update is accepted, local edits alone are no longer announced as an update,
  and a check from the menu no longer answers "up to date" for a note whose
  update cards were shown and never taken.

- **Browsing folders no longer throws the Explorer back to the open note.**
  Every redraw measured the pinned strip while the list was empty, which reset
  the scroll to the top; the reveal that follows the open note then found it
  off screen and centred it. The pane now keeps its place across a redraw, and
  opening or closing a folder drops a reveal still waiting from a note opened
  while the sidebar was shut.

- **The filter field was 30px tall, not the 32px it asked for.** Obsidian sets
  the height of a search input at a specificity a class rule loses to, so that
  line had never taken effect. The same rule repainted the field's fill and
  border on hover, which is what would have quietly undone the change above.
  Every selector for this field now names the element and out-ranks it.

- **Buttons needed two taps on an iPhone.** iOS holds the first tap back while
  it waits to see whether a second one follows, because two taps mean zoom —
  and during that wait the tap can be lost, most easily when the element
  changes underneath it, which the review panel does on every state change.
  Obsidian exempts its own controls by marking them `.is-clickable` or
  `.clickable-icon`, both of which carry `touch-action: manipulation`; a button
  this plugin builds is neither, so it now says so itself. That is why the
  plugin's buttons could feel slower to a thumb than the app's own.
- The review panel no longer redraws itself while a finger is on it. It rebuilds
  its whole tree on every state change — a glossary parse finishing, a source
  check returning, staleness recomputed as you type — and any of those landing
  mid-tap destroys the button under the finger and puts an identical one in its
  place. The redraw now waits until the tap has resolved.

## 1.37.0 - 2026-09-20

The plugin's hand-built buttons stop being shaped by whatever theme is
installed. The review panel's actions, the file chips, the icon picker's cells
and the Explorer's clear control each claimed nothing, so Obsidian's ten button
rules reached them unopposed; they now take one of nine roles that claim every
property those rules set, and the difference is visible in the review panel,
where the actions finally read as primary, secondary, quiet and destructive
rather than all alike. Along with it, the panel's glyphs each mean one thing
again, and a file row's task tally now leads with what is done instead of
announcing an untouched note as finished.

Mobile checklist: not run — and this is a release where a phone had something to
say. Item 7 is that the file pane's icons draw, and one of the fixes here is
exactly that failing: giving a control a role also gave it the role's font, and
the Explorer's clear ✕ came out as a blank box until the icon font was claimed
back. That was found and fixed on a desktop. What is checked instead is what a
desktop can check, and it is more than usual: `obsidian-cascade.test.ts` reads
the button rules out of an installed Obsidian and proves each role wins against
them, and `button-roles.test.ts` holds every hand-built button to a role. Both
are checks against the host, not against a phone.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Changed

- **Buttons take one of nine roles.** The panel's actions, the file chips, the icon picker's cells and the explorer's clear control were four hand-built looks, none of which claimed a background, a border, a radius or a colour — so Obsidian's ten button rules reached them unopposed and each ended up shaped by the host rather than by this plugin. They now carry `sb` plus one role, and each role claims every property Obsidian's own button rules set — height, padding, radius, shadow, fill, label colour and type. Their own classes keep layout and nothing else. Three things a user will see: the review actions read as primary, secondary, quiet and destructive rather than all alike; the file chips lose their 999px pill for the role set's one segment shape, with an accent tint on the chosen one; and the explorer's clear control moves from 22px in `--text-faint` to the role's 24px in `--text-muted`, because `--text-faint` on a control measures 2.3:1 on white. Obsidian's own dialog buttons — the ones `Setting.addButton` makes — are untouched: those are the host's chrome, not ours.

### Fixed
- **The task tally on a file row said the opposite of what it meant, and was too faint to read.** `7 / 7` was *seven still open*, but `x / y` is read as progress by anyone who has seen a progress figure, so a note with seven untouched tasks announced itself as finished. The numbers now lead with done — `0/7` for that same note, `9/9` only when a note really is finished — which is what the form already implied. It is drawn at the row's own size and family instead of a smaller one, so the tally is part of that line of type rather than a footnote under it, and it has moved off `--text-faint`, which measures 2.3:1 on white. Done leads in `--text-normal` at weight 500 and the total stays muted behind it; a note with nothing left open goes quiet altogether, so the rows that still want work are the only ones carrying weight in the column. Large tallies keep their full width and the name ellipses instead — a name is recognisable from its first characters and a half-drawn number is not. Behind the figures sits a soft accent tint, so the column can be found without being read; a note with nothing open has no tint, which is what makes the tint mean “there is work here”. The tint is accent rather than a neutral on purpose: a row's own hover and active fills are translucent neutral washes, and a neutral tint would be the same colour arriving twice and would vanish under the pointer. Measured in Obsidian, the tint stands 22 out of 255 clear of the row on a hovered row and on the active one alike.

- **A blank line inside a suggestion no longer gets a stub of highlight.** The diff marks are drawn with `box-decoration-break: clone` so the stroke lands and lifts on every line of a multi-line change. A blank line got a fragment of its own too — no text, but the mark's side padding on each end, painted as a small green tab floating between two paragraphs. A line with nothing on it has nothing to mark, so it is no longer marked. Measured in Obsidian: 81 painted pixels on the blank line before, 0 after, with both text lines unchanged. A lone space between two changed words keeps its mark — that one really is part of the change, and dropping it would break the stroke between them.
- **The Explorer's clear ✕ went back to being a picture.** Giving it a role also gave it the role's font, and a role's font out-ranks the bundled icon font's own rule — so the glyph was drawn from a monospace fallback that has nothing at that code point, and the control rendered as a blank box at the wrong size. The icon font and the 14px size are claimed back where the button is itself a glyph.
- **The icon picker's phone rule pointed at nothing.** The rule that stops Obsidian stretching a button inside a modal's setting row named a class that sits on the dialog's content box, not on the dialog, so it could never match. Found by looking for it in a running Obsidian rather than in the stylesheet.

- **The review panel's glyphs each mean one thing.** Two were doing two jobs: `x` was both *Abbrechen* (stop the whole run) and *Verwerfen* (dismiss one suggestion), and *Alle übernehmen* wore a double tick against the single tick on each card — a three-pixel difference at the size these actually paint. Stop is now a stop sign, *Alle übernehmen* a checklist, *Anzeigen* a locate pin rather than a rifle reticle, *Korrektur lesen* a text scan rather than a magic wand, and *Glossar prüfen* a lettered book. *Korrektur lesen* deliberately does not take the panel's own tab icon: that mark means "the proofreading panel", and the same mark on a button inside it would mean two things at once.
- The panel's buttons may now be built without a glyph at all. They all have one today, because this panel is a queue — accept, reject and show repeat once per suggestion card, so the eye lands on the glyph and the word only confirms. That is what earns them; a button whose icon does no work the word cannot should be able to say so.

### Removed

- **A dead rule that set the label glyphs to 14px.** `.schreibstube-review-icon svg` is (0,1,1) and the role base's `:is(…) .sb svg` is (0,2,1), so it never applied: the stylesheet read 14px and Obsidian painted 12px for as long as the rule existed. 12px is also the right pairing with an 11.375px label, so it is gone rather than made to win.
- **`kit/button.css`, and the test that held this stylesheet identical to it.** The role set arrived here as a file copied from another project, with a test that failed when the two drifted. That made this plugin's buttons unchangeable without a red build somewhere else, which is the opposite of what a separate plugin should be. The rules are unchanged and are now this stylesheet's own; the reasoning that was in the copied file is in the comment above them. What remains is `src/services/button-roles.test.ts` (the base claims what Obsidian sets; every hand-built button names a role) and `src/services/obsidian-cascade.test.ts` — both testing this plugin against its host, neither naming another project.

## 1.36.1 - 2026-09-19

Nine fixes, six of them for bugs 1.36.0 put in front of people. Two of those
six were costing someone their words rather than merely annoying them: an
accepted update from a source could land inside a line, and a title typed
into the editor could be overwritten by the source's. The others were quiet
— a note that stopped syncing without saying so, a panel that emptied itself
when you clicked inside it, a button that did nothing at all.

Mobile checklist: not run. This release touches the review panel, the
Explorer filter and how a marked run of text is drawn, which is three things
a phone would have had an opinion about. What was checked instead is what a
desktop can check: the filter's cost, measured directly — a two-thousand-word
paste against twenty thousand files went from forty-three seconds and more
memory than a phone has, to under a fifth of a second — and the panel and
anchor changes, which are decided in tested modules. None of that is a phone,
and the release notes should not pretend otherwise.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Changed

- **A marked run of text is drawn with the family's pen.** The diff marks were flat slabs from `--background-modifier-error` and `--background-modifier-success` — tokens a theme picks for a toast or a form field, not for a run of prose. Measured in Obsidian, they painted 312 (insert) and 277 (delete) from the page in Euclidean RGB against the theme's own highlight at 70: the loudest marks in the family by a factor of four, and theme-dependent on top, since a theme sets that token's saturation for a UI affordance. They now carry the stroke Klartext defines in its `kit/highlight.css` — a feathered landing and lift, square ends, no halo, and one stroke per line, which is where a long diff run shows it. Copied at the file level, not shared at runtime: Obsidian loads every plugin's CSS globally, so a shared class name would couple the plugins through whichever loaded last. The ink stays semantic (green for an insertion, red for a deletion and a flag) and the strikethrough stays; only the shape and the strength change, to 79 and 70, inside the family's 60–140 band. The glossary's wavy underline is untouched — it is a different signal, not a highlight.

### Fixed

- **Related notes follows the note in front of you again.** Opened from the palette the panel was supposed to follow along, and opened from a note's menu to stay on that note — which is what the README has always said. Both openings asked for the same thing, so the panel was pinned however it was opened and never moved again, not even after a restart: the flag that says which was wanted was written as "pinned" in the one place both go through. The palette now says it is starting the reader off, the menu says the reader named the note, and the panel behaves as documented. The view's second way of pinning itself, which nothing had ever called, is gone.
- **A correction offered at the start of a paragraph can be accepted.** Found reviewing the fix below: a card is anchored to the text recorded before it, and for an insertion at the very start of a paragraph that text was looked for inside the paragraph, where there is none. Such a card was unplaceable against the very note it had just been read from — it looked ordinary and Accept did nothing. The text before it is now read from the note rather than from the paragraph, and an insertion at the very start of a note, where there is genuinely nothing before it, is placed at the start, which is the one offset no edit can move.
- **An accepted update lands where it belongs.** A source that gained a block made a card with no text of its own, and the check for "is this still where I left it" reads the text at the recorded offsets — which for such a card is the empty string, and every offset in every document holds that. So the card never went stale, however far the note had moved under it: accept another card above it first and the new block landed inside a line. A card like this now remembers the text it was recorded behind, travels with it when the note moves, and goes stale when that text is gone — which costs a re-run of the check, where the old behaviour cost the note.
- **A title you just typed is no longer overwritten by the source's.** Properties are written into the open editor rather than to disk, precisely so a check on a timer cannot land behind what you are typing. The writer had two ways of saying it had made no edit — "the note already says this" and "one line cannot express this" — and said both the same way, so the first fell through to the disk writer, which puts the source's title over yours without asking. The two are now different answers.
- **A note whose check interval is not a number is now refused.** YAML reads `.inf` and `.nan` as numbers, and both slipped past the "at least one minute" check to become an interval no note is ever due on again — silently, while the panel reported the schedule as understood.
- **Switching a glossary on or off no longer empties the panel.** The panel asked Obsidian which note was open in order to redraw itself, and clicking something in the panel can leave Obsidian with no open note at all. Asked that way it answered by clearing the glossary, the matcher and the source row for the note it was still holding a queue for. It now redraws for the note it is speaking for.
- **One note's check no longer blocks every other note's.** A source can take twenty seconds to answer, and for the whole of it any note opened meanwhile had its check-on-open dropped. A check in flight is now held against the note it belongs to.
- **Check source says something when sync is off.** The button and the command returned in silence, which reads as a broken control; they now say what is switched off and where to switch it on, as the vault-wide check already did.
- **A pasted filter no longer freezes the app.** The Explorer's filter scored every word of a query against every file, holding one number per file per word — fine for the word or three anybody types, and hundreds of megabytes for a paragraph pasted into the box by accident. Against twenty thousand files a two-thousand-word paste took forty-three seconds and the memory it asked for is more than a phone has. A query is now read up to its first dozen words, which no typed filter reaches: the same paste is answered in under a fifth of a second, with the answer the first dozen words would have given.

## 1.36.0 - 2026-09-19

Mobile checklist: not run. The one thing in this release a phone would have
told us is how the divider behaves under a thumb, and that was checked in a
browser instead — against the real stylesheet, driven by the browser's own
touch input rather than by synthetic events: a touch on the divider drags it,
and a touch anywhere else on the picture leaves it alone, so the note still
scrolls past. That is a good check and it is not a phone.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Added

- **A before/after slider in a slideshow block.** `layout: compare` lays the block's first two images in one frame, the first over the second, under a divider that is dragged across them — a renovation, a retouch, a room before and after the furniture. Press anywhere on the picture to send the divider there, or use the arrow keys, with Home and End for an edge. Both pictures are cropped to the frame, which takes the proportions of the first picture the vault has, because a wipe only reads as one thing changing while the two sides line up exactly. The alt texts label the sides instead of the header, since both pictures are on screen at once and neither is the one a header would be naming. The expand control opens the usual fullscreen view, where the two step back and forth at full size.

## 1.35.2 - 2026-09-18

Mobile checklist: not run. The result list was checked in a browser at 240, 320
and 420 pixels wide against the real stylesheet, which is the width a sidebar
actually gets, but not on a device.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Fixed

- **The filter's results no longer overlap each other.** 1.35.1 drew the folder as a second line inside the result's row, and every row in the pane is one line by construction — so the folder did not make the row taller, it spilled onto the row below, and the list came out as overlapping text. The row and its folder are now two elements rather than one, so the row stays the row the tree draws and the folder sits beneath it.
- **A long file name keeps its icon.** With the row made to wrap, a name longer than the sidebar took a line of its own and left the icon stranded above it — which is every file name in a real vault. The name now stays beside its icon and is cut with an ellipsis, and the folder under it is cut the same way rather than wrapping into a paragraph.
- **Pressing the folder line opens the file** its row names, instead of doing nothing.

## 1.35.1 - 2026-09-18

What 1.35.0 was supposed to deliver. The ranking it added was real and the pane
drawing it threw the order away, so the release was invisible on a first look;
reading how a file's fields are gathered then found three ways hand-written
frontmatter emptied them. A patch rather than a feature, because nothing here is
new — it is the previous release doing what its entry claimed.

Mobile checklist: not run for this release. Not yet tried on a phone: the result
list, which is new layout, and a narrow sidebar is its hardest case.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Changed

- **A filter draws its matches as a list, best first, instead of filtering the tree.** The ranking added in 1.35.0 was thrown away by the pane that drew it: results came back in folder order, so the best match sat wherever the alphabet had put its folder and a search that worked looked exactly like one that did not. While the box has text the tree steps aside for a flat list in rank order, each row carrying the folder it came from — a tree is the right shape for browsing and the wrong one for searching. The rows are the same rows: the same icons, marks, menu and open state. Clearing the box brings the tree back as it was.
- **A filter that matches nothing now says so** rather than leaving an empty section with no explanation.

### Fixed

- **Frontmatter a person wrote by hand can no longer quietly empty a note's search fields.** `aliases` written as a bare string was ignored, where Obsidian accepts it; a list holding a number or a null threw its usable entries away with the rubbish; and a `title` that was neither text nor a number reached the tokenizer as `[object Object]`, putting the word *object* into the index of every note whose frontmatter was shaped wrongly. Each shape is now read for what it holds and has a test.

## 1.35.0 - 2026-09-18

Mobile checklist: not run for this release. Everything in it was checked by the
test suite and the build's own guards, not on a device. New and not yet tried on
a phone: the Explorer's filter, which now ranks rather than matches and so does
more work between keystrokes, and the related-notes sidebar.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Added

- **The Explorer's filter searches what a file is called, in every sense.** It matched the file name as a piece of text and nothing else, so a note called `Objekt 12.md` whose `title` reads *Villa Seeblick* could not be found by its title, and *Vertrag* never offered *Mietvertrag* — a German compound is searched for by the word at its end. The filter now reads a file's name, its `title`, its aliases, its tags and the folders above it, each weighted by how much of a claim a hit there is, and weighs every word typed by how rare it is in the vault: a word every file shares barely moves a result, a word one file holds decides it. Typing `tag:`, `pfad:` or `name:` (and their English spellings) narrows to that one dimension. It is still not a content search — Obsidian's own search reads note bodies and has the operators for it.
- **A capped result list keeps the best matches rather than the first two hundred.** The list stopped at two hundred rows in tree order, so what survived depended on where in the alphabet a folder sat. It now ranks first and cuts second, and a pinned row or a note in Latest that matched is shown whether or not the tree had room for it.
- **Related notes.** A sidebar listing the notes that belong with the one that is open: those it links or is linked by, those pointing at the same third note, those the same note lists, those sharing its tags, and — only as a tiebreak — those in its folder. Every shared thing is weighted by how rare it is, so an index note linking to four hundred others does not make all four hundred related to each other. Each card says why it is there. Open it with **Related notes** in the palette or from a note's menu in the Explorer; from the palette it follows whatever note is open, from the menu it stays on the note it was asked about. Nothing is downloaded, nothing is sent anywhere, and it works the same on a phone: the link graph is the one Obsidian has already resolved, so asking costs no file reads.

## 1.34.1 - 2026-09-18

Mobile checklist: not run for this release. The feature layout was measured in
a browser at desktop and phone width with the plugin's own stylesheet; the
slideshow fixes have not been tried on a device.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Fixed

- **The feature slideshow keeps its details beside the scene.** The two pictures beside the large one were sized by their own proportions, so a tall one stretched the row far below the main picture and pushed the second detail out of the scene. The column is now exactly as tall as the main picture, and the details share it. A feature now uses the block's first three images and leaves any further ones out, rather than rotating a fourth into the scene.
- **Images whose path is written with `%20` are shown.** A Markdown link spells a space as `%20` (`![](my%20photo.png)`), and the slideshow looked the path up as written, so the file was not found. It now also tries the decoded path, and a path in angle brackets (`![](<my photo.png>)`).
- **The slideshow's controls no longer sit under Obsidian's "edit this block" button.** In live preview Obsidian shows its own `</>` in the top-right corner of a rendered block when the pointer is over it, which covered the "next" arrow. The header now leaves that corner free in live preview; the reading view is unchanged.

## 1.34.0 - 2026-09-18

Mobile checklist: not run for this release. Everything in it was checked by the
test suite and the build's own guards, not on a device. New and not yet tried on
a phone: the file pane following the open note and its new icons and short
names, the five slideshow layouts, the property menu's two entries, and both
ways of turning a selection into a table.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Added

- **The explorer follows the open note.** Opening a note by any route — a link, the quick switcher, a search — opens the folders above it in Schreibstube Explorer and brings its row into view, scrolling only when it is off screen. A collapsed sidebar stays collapsed and the row is in view the next time it opens.
- **PDFs, Excalidraw drawings and bases get their own icons** in Schreibstube Explorer, where they were a blank sheet or a text note. An icon chosen for a file still wins.
- **SVG pictures, Excalidraw drawings and bases are shown without their extension** in Schreibstube Explorer, as notes are: `Plan.excalidraw.md`, `Plan.excalidraw.svg` and `Plan.base` all read **Plan**, told apart by their icons. Renaming edits the visible name and keeps the suffix.
- **Table from the selection.** Selected lines become a Markdown table, from the editor's context menu (**In Tabelle umwandeln**) or the palette (**Einfügen: Tabelle aus der Auswahl**). Tab-, semicolon- and comma-separated lines and `Schlüssel: Wert` lists are converted locally; colour lists get separate RGB and Hex columns.
- **An icon per property.** A property's menu in live preview (click its icon) has **Icon wählen …**, which replaces the type icon for that key in every note — in live preview, the reading view and the properties sidebar.
- **Today's date in properties.** **Heute eintragen** in the same menu sets the property to today: ISO for date properties, one more entry for lists, the configured **Datumsformat** for text. **Einfügen: heutiges Datum** puts the date at the cursor, in a property field or in the note, and can be given a hotkey.
- **Slideshow layouts.** A ```` ```schreibstube-slideshow``` ```` block takes a `layout:` line. `filmstrip` puts every image as a thumbnail under the stage, to jump straight to one. `feature` sets one image large with the next two beside it as tiles that come forward when pressed. `strip` sets every image at once in a row of equal tiles, wrapping to rows of three past four. `masonry` shows every image at once at its own proportions, packed into columns. Without the line the block is the stage it has always been. In every layout the only text is an image's alt text in the header; in `strip` and `masonry` it names the image under the pointer or focus.
- **AI table from the selection.** For text without clear separators, **Mit KI in Tabelle umwandeln** / **Einfügen: KI-Tabelle aus der Auswahl** sends the selection to the shared AI model, validates the reply before anything in the note changes, and replaces nothing if the text was edited while the request ran.

### Changed

- **The slideshow's controls stand on the page without a chip behind them.** They were buttons, and in the reading view a button wears the theme's fill and shadow, so three grey boxes sat over every picture. They are now drawn the way the file pane draws its own: the plugin's icon font, no fill in any state, the icon darkening on hover and only where hovering is a thing that happens. The fullscreen view's arrows and its ✕ use the same glyphs, where they were typed characters.

## 1.33.0 - 2026-09-17

Mobile checklist: not run for this release. Everything in it was checked by the
test suite and the build's own guards, not on a device. The checklist now uses
the new command names. A click on the link-mode indicator in the status bar and
the two new buttons under Drucken and Veröffentlichen are new and have not been
tried on a phone.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Changed

- **The command palette is shorter and sorts by what a command acts on.** Commands are named after their object, so related ones sit together: `Doc …` for the note in front of you (Neues Doc, Doc aktualisieren, Doc korrigieren, Doc drucken, Doc als Mail senden, Doc mit KI umbenennen, Antworten ins Doc holen), `Einfügen: …` for what goes into it (Aufgaben-Zusammenfassung, Diaschau, KI-Zusammenfassung der Auswahl), and `Fokus: …`, `Explorer: …` and `Links: …` for the view. The English names follow the same pattern ("Proof-read doc", "Insert: slideshow"). Thirty-two commands are twenty-three.
- **Commands that were one choice asked three ways are one command.** The two AI renames are **Doc mit KI umbenennen**, which renames a picture when a picture is open and a note otherwise. The three link modes are **Links: Seite wechseln**, which moves from normal to left to right and back, as a click on the status bar indicator now does too. The two comparisons with Reminders are **Erinnerungen abgleichen**, which asks about the open note when it has sent tasks and about the whole list otherwise. **Fokus: Satz** and **Fokus: Absatz** turn focus mode off when their mode is already on, which replaces "Fokus: aus".
- **What is done once is a button, not a command.** Adding a print template is **Vorlage anlegen** in the print settings, and opening the published site is **Website öffnen** in the publishing settings.

### Removed

- **"Check this note against the glossary"** as a command. The review sidebar's button does the same, and proof-reading a doc checks the glossary first anyway.
- **"Preview the publication"**. Publishing a folder already shows the plan and waits for confirmation before anything is uploaded.

Hotkeys follow a command's id. The merged rename and Reminders commands keep an old id (`rename-from-content`, `fetch-done-from-reminders`), and every renamed command keeps its own, so those hotkeys still work. A hotkey bound to the image rename, the note-only Reminders check, "Focus: off", any of the three link modes, the glossary check, the print template, the preview or the website has to be bound again; the link modes are now `switch-link-side`.

## 1.32.0 - 2026-09-17

Mobile checklist: not run for this release. Everything in it was checked by the
test suite and the build's own guards, not on a device. Nothing here changes the
file pane, the overlay or printing; the sync fix writes a note's properties
through its editor, which a phone does the same way a laptop does.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Fixed

- **Focus mode's sentence dimming is now visible on a light page, and follows the dim strength setting.** Sentence mode cannot dim with opacity — the focused sentence sits inside the dimmed line, and opacity on an ancestor is a ceiling its children cannot rise above — so it dimmed by colour, to a fixed `--text-muted`. That ignored the dim strength setting entirely, which only ever reached paragraph mode. It also read very differently by page mode: measured in Obsidian, the contrast ratios barely differ (12.6:1 to 7.23:1 on a light page, 11.7:1 to 7.11:1 on a dark one) and neither does the lightness step, but the luminance change the eye judges — taken against whichever of the text or the page is brighter — was 6.2% on white against 42.2% on black. On a light page the page is the bright reference, so two dark greys on it hardly separate. The dimmed text now mixes toward the page by the setting's own fraction, which is exactly the colour paragraph mode composites to: one setting drives both modes, and the change becomes 38.5% on light and 80.6% on dark. Obsidian's own light theme showed the same shape, so this was never one theme's palette.

- **The plugin's icon no longer reads darker than the icons beside it.** In a sidebar tab row it carried a heavier stroke than Obsidian's own: the registered icon pinned its stroke width, where a Lucide icon has none and inherits the one Obsidian sets for the context — thinner in a tab, thicker in the ribbon. The pin also sat in the wrong units, since the icon's group scales its stroke along with its geometry, so it drew at 8.33% of the icon's width against every neighbour's 7.29%. The attribute is gone and the icon now follows Obsidian at every size. The colour was never different. `assets/logo.svg` is unchanged: a standalone file has no stylesheet to inherit from.
- **Accepting a first sync no longer leaves the note empty.** A check wrote the note's `title` and `updatedAt` to the file on disk and then offered the document as cards; accepting them filled the editor, and Obsidian, merging the file it had just been told about into the editor, could not place a whole document against frontmatter that had changed underneath it and kept the file's version without a word. The note ended up with its properties and nothing else, while the plugin recorded it as matching its source. A note that is open now gets its properties through its editor, before the cards are measured, so there is one copy of it and the editor saves it.
- **A manual check gives a note back the document it lost.** A note recorded as matching its source answered "unchanged" to every check while the source stood still, so the text that went missing above could not be fetched again. Checking by hand now fetches the whole document whenever the note no longer holds what the source last sent.
- **A README's logo is no longer part of its title.** The title is taken from the first heading, and a GitHub README often puts an `<img>` there; the tag was written into `title` as it stood. HTML is left out now, and a heading that is only a picture gives no title.

## 1.31.0 - 2026-09-16

Mobile checklist: not run for this release. Everything in it was checked by the
test suite and the build's own guards, not on a device. A pinned tag is new
on the file pane and adds a sidebar of note cards; step 7 of the checklist is
where a phone would show it, and a long press on a pinned tag should open its
menu the way it does on a pinned file.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Added

- **A tag can be pinned, and its row counts the tasks of every note carrying it.** Pinned files are places to go; a pinned tag is a question kept on screen: how much is still open across everything tagged `#projekt`. The row shows open over total, added up across every note that carries the tag in its frontmatter or its text, nested tags included and case ignored, the way Obsidian's own tag search finds them. Each note counts once per row, and a note with two pinned tags counts in both, because it belongs to both. Pin a tag with **Explorer: pin a tag**, or from a note's menu with **Pin a tag of this note…** — Obsidian's tag list has no menu a plugin can add to, and a note's long press is the one gesture a phone has. Pressing the row lists the tagged notes as cards in the right sidebar, open work first, and a press on a card opens the note. The pin lives in `explorer.json` with the others, so it reaches every device and can be dragged into order among them.

### Fixed

- **A note unbound on one device is unbound on the others, record and all.** The binding already travelled with the note, but the sync record beside it stayed on every device that had checked it, and binding the note again later compared the new source against the old baseline — a note nobody had touched came back as edited locally. A record whose note no longer names its source, or names a different one, is now dropped the moment the note's frontmatter says so, and before every poll. Changing a note's source in the bind dialogue is covered by the same rule; it used to keep the old baseline too.
- **A note moved on another device keeps its sync record.** A sync client may deliver a rename as a delete and a create, and a device that was closed sees only a note at a new path, so the next check there was a first sync, with an `updatedAt` the document had not earned. A record now names the source it was made against and is kept for thirty days after its note disappears; a bound note with no record takes it over when it names the same source and still holds exactly the text the record was made against. A note written afresh is never handed someone else's baseline.

## 1.30.0 - 2026-09-16

Mobile checklist: not run for this release. The one change is the plugin's
icon, which the ribbon, the pane's tab and the command draw from the same
registered SVG on every platform; the test suite pins its geometry and its
rules. Step 7 of the checklist, the file pane's icons drawing, is the one a
phone would show.

Bridge 2.4.0 is unchanged and still pairs with this release.

### Changed

- **The plugin has a new icon.** A speech bubble holding a small branch graph, drawn to the same rules as Obsidian's own icons, so it reads as one of them in the ribbon, the tab and the command palette. It replaces the house with a quill on the ribbon button, on the file pane's tab and, new, on the "Open file pane" command. Registered under a new name, so a workspace restored from before this release draws the new icon on the pane's tab as soon as the plugin loads. The same mark ships as `assets/logo.svg`.

## 1.29.0 - 2026-09-14

Mobile checklist: not run for this release. Everything in it was checked by the
test suite and the build's own guards, not on a device. Three things here are
the ones a phone would show first: a pinned row now opens its menu on a long
press, where it answered only a click before; a slideshow no longer turns the
page when a scrolling thumb drifts sideways; and the file pane's folder menu
no longer reads the whole vault to open. Steps 3, 5 and 7 of the checklist
cover them.

Bridge 2.4.0 accompanies this release. The protocol is unchanged, so an older
bridge still serves this plugin, but the byte bounds and the validated search
body are worth deploying.

### Fixed

- **A private repository now syncs from the link GitHub's Raw button gives you.** That button has written `raw.githubusercontent.com/owner/repo/refs/heads/main/…` for some time, and the bind dialogue's placeholder invites exactly that link. Without a token the raw host resolved it and the note synced; with a token the fetch goes through GitHub's contents API instead, and the plugin read `refs` as the branch and `heads/main/…` as the file, so the API answered 404 for every check. The `refs/heads/` and `refs/tags/` forms are now read as the ref they name, on raw and page links alike.
- **A private repository now syncs a file whose name has a space or an umlaut in it.** The URL spells `Mein Dokument/Über.md` as `Mein%20Dokument/%C3%9Cber.md`, and the contents API request encoded that spelling a second time, asking GitHub for a file no repository has. The raw host, which serves a public repository, was handed the URL unchanged and found the file. The API is now asked for the name as the repository has it.
- **A check that fails says why.** A check from the file pane counted a failure and reported "The source cannot be fetched", and nothing anywhere said what the source had answered. A note bound to a private repository whose token was not granted that repository therefore looked, from the notice, like a note that was fine. The notice for a single note now carries the reason, every failed note is named in the console, and a GitHub 404 with a token says the token may not be able to see the repository, since GitHub answers a token without access exactly as it answers no token at all.
- **A token pasted with a stray newline is sent as the token.** It was sent with the newline, which the platform refuses as a header value, and the refusal named nothing.
- **A check that threw before it began no longer wedges every later one.** The token was looked up after the "check running" flag was set and before the guard that clears it, so a lookup that threw left the plugin answering "a check is already running" until Obsidian restarted.
- **A poll that could not run is no longer recorded as having run.** A scheduled poll that met a check already in progress, or one that fired with sync switched off, still stamped the clock, so the catch-up on the next start saw nothing owed and that round never happened.
- **A check that a note could not be read no longer throws away every other note's result.** One note taken away by a sync client between the listing and the read rejected the whole poll, and every record already computed — validators, timestamps, counts — was discarded with it.
- **Two checks of the same note can no longer run at once.** The guard was set after the note was read, so the check on open and a press of the button in the same moment both fetched, and the second wrote a record built before either had landed.
- **The glossary of the note you left no longer arrives for the note you opened.** Two notes opened in quick succession loaded their glossaries side by side, and whichever finished last was applied — under the other note's name.
- **A summary no longer replaces the wrong words.** The range was taken before the request and written afterwards without looking: an edit above the selection moved the text out from under it. The text is checked before it is replaced, and left alone with a notice when it has moved.
- **A picture that vanished mid-rename says so.** The read of its bytes sat outside every guard, so it failed past all of them and left "renaming…" as the last word on screen.
- **A failed rename no longer always blames a name collision.** Any failure said a file of that name may exist, including one that had just been moved or deleted, which sent people looking for a file that was not there.
- **The heading overlay no longer comes back after the plugin is switched off.** A scroll queues a frame, and disabling the plugin does not cancel it: the frame arrived after the teardown and drew a fresh overlay into a live note, with nothing left to take it down.
- **A reading view stops reporting to a plugin that is gone.** Obsidian takes back the post-processor on unload but not the listeners it attached, so every reading view still open kept watching its scroll position for a controller that no longer existed.
- **A pinned row answers a long press.** It was wired to a click and a right click only, which on a phone is no way to its menu at all — the same row one section below has had one for months.
- **A slideshow no longer turns the page when you scroll past it.** The swipe was measured on width alone, so a thumb scrolling the note with a little sideways drift counted as a swipe.
- **A typesetter that failed to start no longer leaves its thread behind.** Each retry started another and let go of the last, worker and blob URL both.
- **A glossary can name its language without taking the review down.** The language comes out of frontmatter and was looked up on a plain object, so `constructor` resolved to a function and the run ended in "suffixes.map is not a function".
- **A glossary linked with an alias or a heading resolves.** `[[Glossar|G]]` was read as a file called "Glossar|G" — offered by the picker, reported missing by the note.
- **A second table in a glossary note is no longer read as terms.** Every line starting with a pipe was, fenced blocks included, so a changelog below the terms became broken rows to complain about. A skipped row now names the line it is on, rather than a row number that counted the separator.
- **Bold italic no longer refuses to print.** `***so***` emitted one closing bracket where Typst wanted two, and Typst rejects the whole document for it.
- **A link in angle brackets prints as a link.** It starts with a letter, so the rule that drops HTML swallowed every one of them and reported them as HTML that had been dropped.
- **A URL in prose no longer takes the rest of its line off the page.** `//` opens a comment in Typst, and nothing was escaping it.
- **`%%` inside a code block stays on the page.** Comments were stripped before fences were known, so two markers in a SQL sample deleted the code between them.
- **A list indented with a tab nests.** A tab counted as one column where two are needed, so every level of an Obsidian-indented list came out flat.
- **An underscore inside a word stays inside the word.** Only the closing side was checked, so `my_var` opened emphasis and ran to the next underscore in the sentence.
- **A four-backtick fence holds the code in it back from the review.** The proof-read segmenter kept its own fence rule, which ended at the first inner fence and sent the rest to the model as prose.
- **Two prices are no longer read as a formula.** "$5 bis $10" masked the words between them out of the review entirely.
- **A shell comment is no longer printed as the document's title.** The first `#` in the note was taken, fenced blocks included.
- **A Markdown image embed in an email is escaped, as the wikilink form already was.** They do the same thing: `![](Privat/Gehalt.png)` renders the vault file it names, and a remote one reports when the note is read.
- **A rename limit that cannot be satisfied is no longer saved.** A minimum above the maximum refused every note for being too short and truncated the rest below that same floor; the two are now bounded and kept in order, and the fields say so.
- **A nulled key in the data file no longer reads as the number zero.** `proofreadConcurrency: null` became one request in flight and `summarizeMaxTokens: ""` became sixty-four tokens, from a file that said neither.
- **The bridge answers a malformed search as the caller's mistake.** A wrongly typed field reached the IMAP call, threw there, and came back as a bad gateway quoting the bridge's own source.
- **A publish no longer orphans pages when the manifest cannot be read.** A permission error or a dropped connection read as "no manifest", and the commit then wrote a fresh one naming only that build — every page an earlier publish had put up became a file nothing knew about.
- **An SFTP failure no longer tells the vault where the web root is.** The summary the code promised was never applied; the detail now goes to the bridge's log with the request id, where it belongs.
- **The bridge refuses to boot on a variable it cannot read.** `PORT=808O` and `AUTH_FAILURE_LIMIT=0` were silently replaced by defaults, and `TRUST_PROXY=flase` read as true — in a module whose whole promise is that a misconfigured deployment does not start.

### Changed

- **A folder's menu no longer reads the whole vault.** Asking whether a folder holds a bound note listed every Markdown file in the vault and filtered by path; it now walks the folder and stops at the first one.
- **A Reminders report no longer reads every note to find one task.** The note each sent task came from was already remembered and never consulted.
- **An image upload is held to the image limit before its bytes are in memory,** rather than to the video limit it shares a route with and the image one afterwards.
- **A mailbox search bounds what it downloads.** Fifty messages with attachments were pulled down and parsed in full before anything trimmed them.
- **The throttle forgets addresses whose failures have aged out,** instead of remembering every address that ever failed for as long as the process runs.
- **The release workflow reads its version from the environment,** rather than expanding a person's typing into a shell line and an `awk` program before any check has run.
- **The bundle guard measures bytes and knows every Node built-in,** where it counted UTF-16 units and looked only for the `node:` prefix.
- **One rule for where a fenced block starts and stops,** now used by the segmenter, the glossary parser, the Typst converter and the title reader, each of which had its own.
- **One wording for what a check of several notes found,** where the vault command, the folder menu and the note menu each had their own and had already drifted.
- **One decision for whether a source is due and which validator to send,** shared by the poll and the panel, which had answered it separately and disagreed about what to keep.

## 1.28.0 - 2026-09-14

### Added

- **An image slideshow you can drop into a note.** Write a ` ```schreibstube-slideshow ` block with one Markdown image per line (`![caption](path.png)`), at least two, and the note shows them one at a time with a caption, prev/next buttons, arrow keys, swipe on mobile, and a fullscreen view (the expand button, dismissed with ✕, Escape, or a swipe). Blank lines and `//` comments inside the block are ignored. **Slideshow: insert an image slideshow** in the command palette drops an empty block at the cursor. Moved here from Vizardry, where it was the `type: carousel` canvas.

## 1.27.0 - 2026-09-14

Mobile checklist: not run for this release. Everything in it was checked by
the test suite and the build's own guards, not on a device. Three things in
this release are the ones a phone would show first: the file pane's rows with
the menu button gone, so a long press has to be the way to the menu; the
filter field's lighter fill and its hairline; and the redrawn icon in the
drawer's tab strip. Step 7 of the checklist covers all three.

### Added

- **A note's task count in the file pane.** With **Task counts** on under Settings → Schreibstube → Schreibstube Explorer, a note that holds tasks shows `1 / 7` after its name — open over total — at the row's right edge, in the tree, on the pinned strip and in the latest lists. A note without tasks shows nothing. Read from Obsidian's metadata, so a thousand rows cost no file reads. Off until switched on.

### Changed

- **The menu button on a row is gone.** Every row carried a three-dot button, shown on hover and always on a phone, that opened the same menu a right-click or a long press opens. It was one more thing lighting up on the pane for nothing the pointer could not already do, and its place at the right edge is where the task count now sits.
- **The file pane's filter field says it is a field.** A hairline now runs round it, so a bare tint on a tinted pane no longer has to carry the whole meaning of "type here". On a phone the tint steps back to half strength: at full strength it was a grey block on a pane that is itself grey.
- **The plugin's icon is drawn to the rules of the icons beside it.** It sits in a row of Lucide icons in the sidebar's tab strip, and was scaled to a folder's width with a heavier stroke, which made it a stranger among the three beside it and put it closer to the window's edge than they stand. It is now Lucide's own house outline, on Lucide's grid, stroke and margins, with the quill in the doorway.

### Fixed

- **The plugin now speaks the language Obsidian speaks, even when nobody chose one.** Obsidian records an explicit language choice and otherwise follows the system. The plugin read only the recorded choice, so on a Mac set to German where the Obsidian language was never touched, Obsidian's palette was German and every Schreibstube command was named in English: typing "Aufgaben" found nothing, and the file pane's headers read PINNED and LATEST. The plugin now falls back to the system language the way Obsidian does. An explicit choice under Settings → Schreibstube → Language still wins.

## 1.26.0 - 2026-09-14

Mobile checklist: not run for this release. Everything in it was checked by
the test suite and the build's own guards, not on a device. Four things in
this release are the ones a phone would tell you about first: a ticked task
folding its body away, the Reminders mark at the end of a sent task, the
hand-off to Shortcuts when a task is sent and when the note is checked, and
the file pane's section headers after a switch between light and dark. Step 7
of the checklist covers the pane; the rest are new and not on the list yet.

### Added

- **A blank note in a window of its own, in front of everything.** **Focus: new note in its own window** makes a new empty note where Obsidian's default location says, named Untitled, Untitled 1 and so on as Obsidian would name it, opens it in a new window that takes the focus whatever else is open, and puts the cursor in the editor. A pop-out has no sidebars, so the screen holds the note and nothing else; a phone has no windows, so there the note opens in a new tab and both drawers close. Three moves became one; the vault sees nothing it would not see from a note made by hand.
- **A note with checkboxes can carry a progress line.** **Tasks: insert the summary ribbon** puts a ```` ```schreibstube-tasks ```` block wherever the cursor is, and the block renders as one line — "20 open of 21" — counting every task in the note. It updates the moment a checkbox is toggled, in Live Preview and in Reading view, and it reads the editor's buffer rather than the saved file so an unsaved tick counts too.
- **A ticked task folds its body away.** A task can carry more than its first line — a paragraph typed with Shift+Enter, a note under it, sub-items — and while the task is open that text is the work. Tick it and the body folds, leaving the first line; untick it and the body returns. The fold is an ordinary editor fold, attached to the same edit as the tick so the two undo together, and the fold indicator opens a done task by hand for as long as its state stays the same. Tasks already done when a note opens start folded. Reading view has no folds, so there the body is hidden. Works in every note, with or without the ribbon.
- **A task can be sent to Apple's Erinnerungen.** On macOS and iOS, **Tasks: send to Erinnerungen** — also in the editor's context menu — hands the task under the cursor to a Shortcut you build once, which creates the reminder: the task's line as the title, tags and all, the text indented under it as the note. The command puts an `obsidian://schreibstube?task=…` link into the reminder's note and the same link onto the task's line, where Obsidian draws it as a small Reminders-style mark, so the note shows what was sent and the reminder opens the note at the task whatever the note is called by then. Off until switched on under Settings → Schreibstube → Erinnerungen. Reminders' own tags cannot be set from outside, so a `#tag` arrives as text.
- **A reminder completed on the phone ticks its task in the note.** A second Shortcut reports which reminders are done. **Tasks: check this note against Erinnerungen** asks about the open note's sent tasks, **Tasks: fetch done tasks from Erinnerungen** about the whole list; either way the answer comes back into the plugin through a callback and every open task it names is ticked, wherever it lives. For notes that stay current on their own, the same Shortcut can write its report into a file in the vault from an automation, and the plugin reads that file whenever it changes.
- **While the ribbon is there, every heading says how much is left beneath it.** A muted "3 of 3 open" after the heading, in the theme's body font and small, counting only the tasks directly under it up to the next heading of any level: a sub-heading's tasks are the sub-heading's. The badge is painted as an attribute on the heading's line rather than as a widget, which is what keeps it visible when the heading is folded. Only `[ ]` counts as open; every other marker counts as done, and a task inside a code fence is not a task.

### Fixed

- **A section header in the file pane no longer keeps the light it was measured in.** The header paints the colour found behind the pane so rows slide under it cleanly, and that colour was read once, when the pane opened, and again only when Obsidian announced a CSS change. Switching between light and dark does not always announce itself, so a pane opened in the light kept pale headers, with a pale line under each, on a dark ground. The pane now watches the body's theme class and reads the colour again a frame after any change, and when a theme paints its sidebar as a translucent tint the layers are composited into the colour the eye sees rather than the tint painted solid.

### Changed

- **A diagram with no heading over it can be captioned by the drawing itself.** A canvas usually has a title, and a fence with no heading above it had nothing under the picture. The note still wins: a heading is what the person writing chose to call it, in the words of the document; the drawing's own name is better than nothing and worse than that. Neither, and the picture stands unlabelled rather than carrying a caption nobody wrote.
- **A canvas from a pop-out window is no longer refused.** Obsidian can put a note in a window of its own, and an element from there fails `instanceof` against the main window while being a perfectly good element. The check now asks what it can do rather than which document made it, matching the plugin on the other side of the contract.

## 1.25.0 - 2026-09-13

Mobile checklist: steps 1 to 7 confirmed on a phone for 1.24.0 and untouched
since. Steps 8 and 9 — printing itself and a diagram from another plugin — have
still not been run on a device, and this release changes printing, so they are
the two to run before relying on it.

### Added

- **A template is found wherever you keep it.** Only the configured folder was searched, so a template kept beside the notes that use it was invisible and printing said there were none. What makes a folder a template is the flag in its descriptor, which somebody set on purpose; the setting now says where a new one is suggested, not where one is allowed to be.
- **A template can be added from inside the app.** Until now the only way to get one was to copy a folder out of the repository, which is a drag on a laptop and not possible at all on a phone — the platform the whole feature was built for. **Drucken: Vorlage anlegen** asks which of the two examples you want and which folder to put it in, writes it, and opens its descriptor so the instructions are the first thing you read. Any folder in the vault is offered, not only the templates folder, because keeping a template beside the notes that use it is not wrong.

### Changed

- **Printing is off until you switch it on, and switching it on is what downloads the typesetter.** It is 28 MB, and nobody should spend that on a feature they have not asked for, least of all over mobile data. The settings now show whether the typesetter is on this device, with a button to fetch it in advance so a first print is not also a download, or to remove it again and take the space back. Running the print command while printing is off explains this and offers to turn it on, rather than the command quietly not being there.
- **Printing says plainly when a device cannot run it.** It needs WebAssembly, a worker and a digest, which every platform Obsidian supports has. Asked as three questions rather than as "which device is this", because a browser engine moves and a platform test goes stale.

### Documentation

- **The README explains printing properly, including how to write a template.** What a template is, the layout function and what it is given, the four helpers a template may override, where each word on the page comes from, what carries over from the note and what does not, and what happens to a diagram. It had a summary; a feature this size needs the walkthrough.

## 1.24.0 - 2026-09-13

Mobile checklist: steps 1 to 7 confirmed on a phone. Steps 8 and 9 — printing
itself — were not, and they are the two that matter for this release: the first
fetch of the 28 MB typesetter, and a diagram drawn by another plugin coming out
light and complete. So the rest of the plugin is checked on a device and
printing is not.

### Added

- **A note can be printed as a PDF, through a template you keep in the vault.** Not Obsidian's print, which gives you whatever the screen had: a template is a folder with a layout, its fonts and a descriptor, and the page comes out set rather than screenshotted. It works the same on a phone as on a laptop and needs nothing running anywhere — Typst is compiled to WebAssembly and typesets on the device, so a letter written on a train becomes a PDF on that train. The typesetter is 28 MB and is fetched once per device from this plugin's own release, checked against a hash committed in the source, and kept beside the plugin; everything after that is offline.

  What goes on the page that is not prose — a sender, a recipient, a subject, a date — is frontmatter. The template says what is always the same and the note says what is not, so an address is typed once and a recipient once. A note that names its template prints without being asked anything; one that does not is asked which.

  Diagrams are the one thing a typesetter cannot do: Mermaid and the canvas plugins draw into a document, not onto a page. Each is drawn off-screen in a light theme and captured as a picture — paper is white whatever the vault is set to — and one that cannot be drawn prints as its own source with a warning, because a diagram that silently vanished is a page that lies about what the note says. A fence that drew several and captured only some keeps what it got and says how many are missing, for the same reason. A plugin that offers its own export is asked to do the drawing rather than guessed at from outside, and asked for every canvas in the fence rather than the first — a carousel shows one panel at a time and a page has no carousel, so all of them print. It is also told the drawing is for paper, which asks it not to go to the network for anything: a print stays offline however it is made.

  Two templates to copy are in `examples/print/`: a German business letter and a CV. Neither ships a typeface, since fonts are licensed; put your own in the template's `fonts/` folder. `PRINTING.md` is the whole contract.

## 1.23.0 - 2026-09-13

Mobile checklist: not run for this release. The file pane's view was split
into modules with every function moved verbatim, which is a claim about the
code; ten minutes on a phone before relying on it is still worth having.

### Changed

- **One Node everywhere.** The bridge's image, CI, the release workflow and both `engines` fields say Node 24, the current long-term-support line; `.nvmrc` at the root says it once for everyone's machine. The bridge had claimed 20, run 22 and been tested on both.
- **The bridge's image is a tenth of its size.** Mermaid is one prebuilt file the bridge copies into a published site and never runs, and the package brought 205 MB of parser dependencies for it. The image now keeps the one file and drops the tree; CI checks that both halves of that happened. `imapflow` is on 2.x, whose only breaking change is the Node floor the image already had.
- **The file pane's view is four modules and a decision.** Its 2,100 lines held the drag gesture, the long-press menu, where a drag may land, how a section header is drawn, what the pane remembers, and which icon a file gets, each entangled with the rest. Those are their own modules now, the icon decision is a service with tests, and the view draws. Nothing a person can see or do changed.
- **`main.js` is a fifth of its size.** The production bundle carried its own source map inline — 1.6 MB parsed by Obsidian on every start, on every phone, so that a stack trace would name a TypeScript line. The map now travels with the GitHub release instead, where it is used to read a reported trace, and the file every vault loads is 277 KB. The build refuses to ship anything over 400 KB.
- **The plugin's one-line description says what it is.** It still called itself a heading overlay.

### Security

- **Releases carry a provenance attestation, and actions are pinned by commit.** A vault owner can check that the `main.js` on a release was built by this repository's workflow from the tagged commit, and a tag moved on an action's repository no longer changes what CI runs. Dependabot keeps the pins current.
- **The bridge can tell callers apart behind a proxy.** Hosted behind a platform's TLS proxy, every request arrived from the proxy's own address, and the throttle that slows repeated bad tokens keyed on exactly that: five wrong guesses from a stranger locked the plugin's owner out for a minute. With `TRUST_PROXY=true` the bridge reads the address the proxy appended, which a client cannot forge. Off by default, since without a proxy the header is the client's to choose.
- **Both dependency trees audit clean.** Vitest 5 and esbuild 0.28 in the plugin's tooling, a patched `lodash-es` under Mermaid in the bridge; CI audits the bridge's runtime tree on every change and Dependabot keeps both moving. The bridge now requires Node 22.12, which is what its image has always run.

### Fixed

- **The bridge README named a variable that has not existed since 2.0.** `BRIDGE_TOKEN` is `MAIL_TOKEN` and `PUBLISH_TOKEN`, and the SSH key and password are secrets too.

## 1.22.0 - 2026-09-13

### Changed

- **The pinned block's chevron moved to the end of its band, and only appears when it has something to show.** It sat on the left in the slot every icon in the pane lines up on, which is where a chevron that opens and closes a list belongs — and this one does not do that. Three pinned rows are on screen whatever it says; what it controls is whether the rest of the shortlist comes out past them. So it sits at the far end now, where the tree's own control is, and it points the way the list will move: down to bring the rest out, up to put them away again. With three pins or fewer there is nothing behind it and it is not drawn at all. The band itself still opens and closes the block wherever it is pressed, because a finger should not have to find a chevron, and the count on the pin icon still says how many there are in total while the block is closed.

### Fixed

- **The filter field says it has focus on the inside.** It sits at the very top of a pane that clips what leaves it, and the ring a focused input draws around itself lost its upper edge to that clip — half a rectangle, which reads as something rendering wrongly rather than as focus. The line is drawn within the field now: the same box, nothing to crop, and a field that stays where it was instead of growing a border when a cursor lands in it.
- **The mark on "Zuletzt" is a dot, and the headline takes the press.** A character in a badge was answering a question nobody asked of a mark that size; a dot in the interface's own accent says the one thing it has to say, and the list under the header says which notes. Taking it down no longer means finding it: the whole headline is the target, the chevron excepted, which goes on opening and closing the section. The dot can still be tabbed to and pressed, for anyone not using a finger.
- **A note whose source never moved is no longer reported as updated.** The plugin started keeping a hash of each source in 1.20.0, to tell a document that changed from a check that merely ran. Every note bound before that has a record with no hash in it — and no hash was being read as "this source has never been seen", which is the case that counts as a change. So the first check after updating stamped every mirrored note in the vault with today's date, put them all at the top of "Zuletzt" under "Extern aktualisiert", and raised the mark on the section saying something had come in when nothing had. A missing hash is a fact about the bookkeeping, not about the document: it is adopted quietly now, and the check after it has a baseline to compare against. A source genuinely fetched for the first time still counts, as it did. Notes already stamped keep the date they were given — nothing can now recover what it should have been — but they will not be stamped again, and the mark comes down for good the next time it is tapped.
- **Every section header draws the same line.** "Dateien und Ordner" had a firmer one, meant to mark it as the break between the curated lists and the vault itself. Four lines down one pane at two weights is not a hierarchy — it is one line looking like a mistake, and the eye reads the difference well before it works out what it was for. The darker label and the space above it say the same thing quietly enough.
- **A long press on a section header selects nothing and highlights nothing.** A header stopped being a button in this release, and a div is prose as far as a phone is concerned: a long press on one raises the magnifier, the selection handles and the "Copy" callout, on a band whose press belongs to the section it opens. It is a control again in the way that matters — no selection, no callout, and none of the grey rectangle a mobile browser paints over whatever was last tapped. The same for the control at the end of it and the mark on "Zuletzt".
- **A section header stopped claiming to be a button, so the things standing on it can be read.** A button's children are not read out — that is what the role means — and a header calling itself one took the chevron beside it and the mark on its icon down with it, which is the same silence one level up. The chevron carries the role now, which is the thing on the band that says what the band does; a pointer still has the whole band, as it always had.
- **A pinned block under a filter is no longer a control that does nothing visible.** Its chevron is not drawn while a filter is set — the filter opens the block for as long as it lasts — but the band went on answering a press, storing a collapse that only took effect once the filter was cleared, at which point the shortlist silently shrank to three. The band is a control exactly when its chevron is there to be seen.
- **Dragging a file onto "Dateien und Ordner" shows the drop target again.** Stating the header's background for every state it can be in outspecified the fill that says a dragged row would land there, and a pointer dragged across the band holds it in `:hover` the whole way. Only the outline was left. The drop target is named the way the rest of the pane's headers are, and wins again.
- **The control at the end of a header can be read by a screen reader again.** Drawing an icon marks what it is drawn on as decoration, and the icon was drawn straight onto the labelled, focusable control — so the one thing on that band with a name announced nothing at all. The icon sits in a child of the control now, decoration inside a control rather than instead of it.
- **A section that hides nothing is a label, not a button.** "Zuletzt" and "Dateien und Ordner" always have something behind them; a pinned block of three or fewer does not, and it was still offering a keyboard a stop to press with nothing to press. It no longer claims to be a control it is not.
- **A section header no longer keeps the grey it lit up with.** The headers were buttons, and a button wears whatever a theme thinks a button looks like: a fill under the pointer, and on a phone a fill that stays, because a finger that taps leaves the hover state behind it and nothing takes it away. "Dateien und Ordner" sat there afterwards as a grey band across the pane. A header is drawn by the pane now rather than being a button dressed down, and no state it can be in paints anything but the colour behind the pane — which it paints only because it is sticky and rows slide under it.
- **The control that opens and closes the tree shows its icon, and stands on nothing.** It had a hover fill of its own, which on a phone was the same one-way state: a grey chip at the end of the header with a faint glyph inside it that could not be read against it. The fill is gone in every state, the icon carries the tone a row's own chevron has, and if the bundled icon set were ever without the glyph, Obsidian's own is drawn instead — an empty box and a broken control look the same from the outside.

## 1.21.0 - 2026-09-13

### Added

- **A file can be named from what is inside it without leaving the pane.** The two AI renames were commands, which means they acted on whatever was open — and the file you want named is usually a row you are looking at in the tree, not the note in front of you. The context menu now carries one entry that follows the file: "Aus dem Text benennen …" on a note, "Aus dem Bild benennen …" on an image, and nothing at all on a file neither path can read, since an entry that answers a tap with a refusal is worse than one that was never there. From the menu the proposal is not applied outright: it opens the pane's own rename dialog with the suggested name in the field, to be read, corrected or cancelled. The commands stay as they are, hotkeys included.
- **A note can say how often its own source is worth asking about.** `schreibstubeSyncEvery` in a note's frontmatter replaces the vault-wide minimum interval for that one note: a press release and a contract are not worth the same traffic, and until now the poll had one schedule for every source in the vault. It is written in words, in German or English — `Alle 2 Tage`, `Every 2 days`, `jede Woche`, `weekly`, `täglich`, `every 6 hours` — and words mean *at most that often*, counted from the note's last check rather than from the clock: a phone that was asleep at the hour catches up at the next poll instead of waiting out another round, and two days stays two days across the end of a month, which a cron step on the day field does not. The review panel says the interval back as cron (`0 0 */2 * *`), so a phrase can be checked against what was understood. A five-field cron expression is taken as itself, for the schedules words cannot reach — `0 9 * * 1-5` — and such a note is due once a minute it named has gone by unchecked. A value that cannot be read is reported rather than guessed at, and that note keeps the vault-wide interval until it is fixed.
- **"Zuletzt" says when a source changed while you were not looking.** A poll runs in the background and, until now, said so once in a notice that is gone by the time you come back to the vault. The section's clock icon now wears a mark — where a closed folder wears its count, and a mark rather than a figure, because how many sources moved is not what a corner of an icon is for; the list underneath says exactly which. It comes down when you tap it, and at no other time: a pane left open on a desk all day must not clear its own news. The tap opens the section with it, so one press both answers the mark and shows what it was about. Which changes count as seen is remembered per device, since having looked is a fact about a person at a screen: a change noticed on the laptop is still news on the phone.
- **One control opens or closes the whole tree, on the tree's own header.** "Files and folders" carries it at the far end of its band, where the row menus line up. It is one button and not two: while any folder is open it offers to close them all, and only a tree that is shut all the way offers to open — so pressing it twice puts the tree back where it was. Opening everything opens the section too, since folders opened inside a closed section are a button that visibly does nothing, and while a filter is set the control is not drawn at all, because the filter already opens every folder holding a match. The pane's title bar keeps its own collapse-all; this one sits on the list it acts on, and opens as well as closes.

### Changed

- **Every command says which part of the plugin it belongs to.** Two dozen entries had grown into one flat alphabetical list where "Notiz korrigieren", "Veröffentlichen" and "Postfach durchsuchen" sat side by side with nothing to say they came from different halves of the plugin. Each is now prefixed with its area — `Fokus:`, `KI:`, `Explorer:`, `Korrektur:`, `Sync:`, `Mail:`, `Veröffentlichen:`, `Links:` — so typing the area into the palette narrows the list to three. Hotkeys are unaffected: they are bound to a command's id, and no id changed.
- **A command that cannot do anything is not offered.** The palette listed everything always: renaming an image with no picture open, checking the source of a note bound to nothing, summarizing with nothing selected, closing the folders of a pane that is not open. Seven commands now appear only where they apply, which is roughly half the list gone on an ordinary note. Only what can be seen on screen hides anything — a command that needs a setting filled in stays listed and says what it needs when it is run, because a command missing for a reason three tabs away reads as a plugin that broke rather than as a plugin being tidy.
- **Each settings section lists the commands its feature brings.** The palette is alphabetical and knows nothing about which entries belong together; the settings tab already groups the plugin by what it does. Switching something on and finding out what to type is now one page rather than two.
- **"Aus der Quelle aktualisiert" is now "Extern aktualisiert"** — "Updated externally" in English. Shorter, and it says the thing that matters about those notes: the change came from outside the vault.

## 1.20.0 - 2026-09-13

### Security

- **A fetched reply cannot write Markdown of its own into your note.** Everything an email brings is written by whoever sent it, and the body was quoted so that a line beginning with `#` could not become a heading. Quoting does not stop an embed: `![[…]]` renders inside a quote as happily as anywhere else, and it renders whatever it names — a private note, a scan, a contract. Merge such a reply and publish that note, which are two things this plugin is for, and a stranger has chosen a file from your vault to put on your website. The sequences that make a link or an embed are now escaped wherever mail text is written, subject, sender and body alike, so what the sender wrote is shown rather than obeyed. A subject is also kept to one line: one with newlines in it used to carry the rest of the note's structure away with it.

### Changed

- **A source fetched for the first time counts as a change.** Not stamping one was a reading of "after the first change" that left a mirrored note with no `updatedAt` at all until its source happened to move, which for a document that is finished may be never. A document arriving is the version the note starts from, and that is worth a date.

### Fixed

- **A deleted file leaves the list at once.** It went when it was deleted; the row did not. The pane draws what the vault says it holds, and the vault says a file is gone when its own watcher has noticed — which on a phone, behind a sync client, is seconds after the file went, and seconds of a row sitting there is a delete that looks as though it failed. The row is now taken away the moment the trash call returns, and the vault's event, when it arrives, only confirms it. If no event ever arrives the row comes back within ten seconds rather than a file being hidden by a plugin that was only guessing, and a path written again is visible again immediately, whatever was trashed there before.
- **Binding a note to a source no longer fails on the spot.** The check that runs the moment a URL is confirmed asked Obsidian's metadata cache what source the note names — and that cache is updated after a write, not during one, so it answered that the note names none. The check reported the source as unfetchable, seconds after the binding it had just written, and the note was only ever fetched by asking again later. The binding is now read from the note itself when the cache has nothing to say, which is exactly the moment this happens.
- **A note checked from the review panel gets its properties and its place in "Zuletzt".** There are two ways a source is fetched — a poll across the vault, and a check on the note in front of you — and only the first wrote the note's `title` and `updatedAt` or recorded what the source's text was. Checking from the panel, which is what a person does with a note they have just bound, wrote none of it: no properties, and nothing to put the note in the pane's list of what a source has changed. Both ways now leave the same record behind, written in one place instead of two.
- **The context menu stays open again, so a file can be deleted.** 1.19.0 let a finger drag a row, and the press that arms that drag is the same press that opens the menu. What it inherited was the mouse's idea of when a press becomes a drag: four pixels. A finger resting on glass moves further than that, and rolls further still as it lifts — so the menu opened and was taken away again by the drag starting, before anything on it could be tapped. Deleting, renaming, moving and every other action behind that menu became unreachable on a phone. A finger now has to travel sixteen pixels, more than half a row, before the drag takes over: a hand on its way somewhere rather than a hand staying put. A mouse is unchanged at four.
- **A redraw held back by a drag cannot be held for ever.** Redraws wait for a drag to finish so the row being carried is not thrown away mid-gesture. If the flag that says a drag is in progress were ever left standing, every later redraw waited on it and the pane stopped answering. It is now held for at most five seconds — longer than any gesture, shorter than anything worth calling a freeze.
- **A deleted note leaves "Zuletzt" and the folder counts with it.** The tree stopped drawing it at once and the lists two sections above did not, which is the same lag in a second place. Every list the pane draws now agrees about a file that has just gone, the badge on a closed folder included.
- **A fetched reply lands in the right place in a note that contains code.** The section a reply is appended to ended at the next `##`, including one inside a fenced code block — so the reply was written into the middle of somebody's code sample. Fences are now followed, by the same rule the heading stack uses, which is now one rule in one place rather than two.
- **An AI rename works on a GIF.** The canvas was asked to encode one and cannot: it quietly writes PNG for any type it does not know, so the picture went to the model declared as a GIF, and the request was refused for a mismatch that had nothing to do with the picture. What comes back is now declared as what it is — re-encoded as PNG, and called PNG.
- **The review cards speak the set language.** The two lines a sync card carries — that a note was edited locally, and that this is its first comparison with a source — were German in the code, the last of them to be.

## 1.19.0 - 2026-09-13

### Added

- **A row in the tree can be dragged with a finger.** Dragging to move was mouse-only, because the tree's long press already belonged to the context menu — which meant that on the device the pane was built for, the one gesture everybody tries did nothing at all. The same press now serves both: it arms the drag and opens the menu at half a second, so holding still and letting go gives you the menu, holding and then moving gives you the drag, and the menu steps aside the moment the row starts moving. The list scrolls while a drag rests near its top or bottom edge, so a folder off screen is still reachable — on a mouse as well, where it was just as unreachable. **Move to…** stays on the menu for a target nowhere near the row.
- **A mirrored note keeps its own `title` and `updatedAt` in its frontmatter.** The two things a synced document has — what it is called and when it last changed — now sit in the note's own properties, where Obsidian's search, a Base and anything else can read them, and where they stay if the plugin ever goes. The title is taken from the document's first level-one heading, read through the same index the heading stack uses, so a `#` inside a code fence is not mistaken for one and the markup around a real one is stripped. It is written once and never again: a title already in the file belongs to whoever put it there, and a check on a timer must not undo somebody renaming their own note. `updatedAt` is the opposite — it follows the source rather than an opinion, so it is stamped whenever the document at the other end has actually changed, and not on a check that found it unchanged, nor on the first fetch, since arriving is not changing. Whether the source moved is decided against a hash of what the last check received, because once changes are waiting the fetch is unconditional and the validator would call every poll a change. This is the first time a check writes to a note at all; it writes properties only, never the body, and the frontmatter is not part of the diff, so it cannot turn into a change the next check reports.
- **"Zuletzt" leads with what a source changed.** A third list sits above the other two: the notes whose source moved most recently, newest first, as many rows as the other lists show. It is the most specific thing that can be said about why a note is recent, so it says it first and claims those notes outright — a note in it is not repeated under "Erstellt" or "Geändert", the way "Erstellt" already suppresses "Geändert". What counts is the source having changed, not the note having been checked and not the changes having been accepted, so a note appears here the moment a check finds its source different. Each row carries the same sync mark the tree does, which is how the list doubles as what still needs looking at: how many changes are waiting, or none because they are already in the note. The list fills as sources change; nothing mirrored before this version appears in it until its source next moves.
- **A closed folder says how much it is holding.** A folder that is shut is a name and an arrow: whether it holds two notes or two hundred was only ever learned by opening it. Its icon now carries a small figure counting every file underneath it, subfolders included — the folders themselves are not counted, since a folder is not a thing the vault holds but where it holds things. It is drawn only while the folder is closed, because once it is open the answer is on screen; an empty folder carries nothing, a nought being something a folder opening on nothing already says; and past ninety-nine it says `99+` rather than shrinking the digits until they cannot be read on a phone. The counting walks the vault once per draw however many folders ask, because a folder's count is its children's counts.

### Changed

- **Closing the pinned block keeps its first three rows.** Closing it used to take the whole thing away, which made the chevron an all-or-nothing switch on the one section that is a shortlist — and a shortlist with nothing showing is not one. The three rows that sit on the sticky strip stay whatever the chevron says, because they are on screen anyway, and what the chevron now holds is the rest: the rows that continue into the scrolling list below. While closed, the section's own icon carries the number of pins there are — the same badge a closed folder carries, in the same place, because it answers the same question: how much of this is not on screen. The three on the strip are not the block, and the total says how much is behind the chevron without anyone doing arithmetic. With three pins or fewer there is no chevron and no number at all. A filter opens the block for as long as it is set, so a row that matches what was typed is never the row being held back. **The block now opens closed**, which on this device is three pinned rows and then the vault — applied once, after which the chevron is yours; a pane you had already arranged keeps the arrangement.
- **An open pinned block keeps every row it can on the strip.** Three rows were sticky and everything past them scrolled away with the vault, which made the block two different things depending on how far down it went. Opened, the strip now holds as many pinned rows as fit — up to half the pane, so there is always as much vault as shortlist — and only what will not fit continues in the scrolling list below, as before. The share is measured against the pane rather than fixed as a count, and measured again when the workspace resizes, so a phone turned on its side or a sidebar dragged wider answers for itself.

## 1.18.0 - 2026-09-13

### Added

- **A pinned note is drawn by the `title` in its frontmatter.** A filename is a handle — short, unique, often a slug — and renaming a file to read well moves it and rewrites every link into it. The pinned block is a shortlist built by hand, where a row is there to be recognised rather than located, so it now draws the note's own `title` when the note names one and the filename when it does not. Nothing is written: the file keeps its name, the tree below keeps showing it, and the row's tooltip still carries the full path. The filter matches both, so typing what is on screen cannot hide the row showing it. A title that wrapped across lines in the frontmatter is folded onto one; a `title` that YAML turned into a list, a date or a boolean is not a title and the filename is drawn instead.

### Changed

- **A pin and the top of a folder are now two separate marks.** One flag meant both: marking a file as the one that matters inside its folder also put a row in the **Pinned** block above the tree, whether or not it belonged there — and a vault where a dozen folders each have a first file ended up with a pinned block naming all twelve. **Keep at top of folder** is now its own entry on the context menu and is the mark the tree draws, because it is the one that explains why a row sits where it does. **Add to Pinned** stays what it always was: wherever I am, I want this row. A file can carry both, either, or neither, and removing one leaves the other alone. Everything pinned before this version keeps both, which is what a pin did when it was set, so nothing moves on upgrade.

### Fixed

- **A bound note keeps its sync actions while document sync is switched off.** The menu decided what to offer from the sync mark, and that mark is deliberately hidden while sync is off — so a note that had just been bound was offered "Bind source" again and nothing else: no way to check it by hand, no way to unbind it. Which is exactly the state anyone is in the first time they bind a note, since document sync is off by default. The menu now goes by the binding in the note's own frontmatter. The mark stays hidden while sync is off, because a mark for something that is not running would say nothing true.
- **A check that never ran says so, instead of blaming the note.** With document sync off, checking a source returned an empty result, and an empty result reads as "this note is bound to no source" — the one thing that was certainly not true, said immediately after binding it. The summary now carries why nothing was checked, and the notice names the setting to turn on. The same answer is given for a folder check and for "Check all sources".
- **The notice for waiting changes says where to apply them.** It reported that notes have updates from their source and left it there, although a check never writes to a note: changes wait in the review panel until they are accepted. It now says so.
- **"Never show these" now excludes a folder, not only a file named outright.** It compared whole paths, so naming a folder — which is what anyone types into a field asking which paths to never show — excluded nothing at all, and said nothing about it. The one setting whose failure leaves a private note on screen was the one that failed silently. A folder now stands for everything under it, a separator is required so `Familie` cannot take `Familienrecht` with it, case is ignored as it is by the filesystems this runs on, and a stray leading or trailing slash is forgiven.
- **Filtering no longer rebuilds the whole vault on every keystroke.** Three things compounded: a filter counts every folder as open, so the draw walked the entire tree rather than the part you had opened; each folder then asked whether anything under it matched, and that question walked the folder's whole subtree, so a subtree was walked again for every folder above it; and the answer was redrawn per character, with every row of it rebuilt from nothing — thirteen event listeners apiece. The matches are now worked out in one pass over the vault, once per draw; the draw waits for a pause in the typing rather than following each letter; and a filter that matches most of a vault stops at two hundred rows and says how many more it is holding back, which is a narrower filter's job to reveal.
- **One image filename no longer stops the whole publish.** Every Markdown image target was run through `decodeURI`, which refuses a percent that escapes nothing — and `100%-Finanzierung.png` is a file somebody has. The refusal was thrown out of the plan being built for the entire publish, so one such name meant nothing was published at all, with no mention of which file was at fault. A target that cannot be decoded is now taken as written, and a valid escape is still resolved.
- **The heading stack no longer reads code comments as headings.** Every line starting with a `#` was indexed, fenced blocks included, so a shell block's `# Abhängigkeiten installieren` became a level-one heading and the stack above the note claimed it as the section being read — for the rest of the note. Fences are now followed: backticks or tildes, closing only on the same character and at least as many of them, and an unclosed fence stays open to the end rather than guessing where it stopped.
- **Sentence focus holds the sentence you are writing.** The caret at the end of a line — where it is while a line is being written — matched no sentence at all, so focus quietly widened to the whole line and snapped back when the caret moved left. It now belongs to the sentence it is finishing, as does the caret resting on a full stop, and the gap between two sentences belongs to the one about to be written. Every column of a line now belongs to exactly one sentence.
- **A full stop that ends no sentence no longer splits one.** "Das gilt z. B. für Objekte" was three sentences, and focus fell on the last fragment of it. A stop followed by a lowercase word continues the sentence, and so does one after a single letter, a bare number — every ordinal date — or a short list of German abbreviations.
- **An AI rename no longer produces `Bericht.md.md`.** "Filename only" is in the prompt and a model answers "Quartalsbericht.md" regardless, on top of which the plugin added the extension itself — and for an image, a guessed `.jpeg` became `foto.jpeg.png`. An extension of the same kind as the one the file is getting is now dropped, while an ending that is part of the name, such as `Version-1.2`, is left alone. Cutting an over-long name to length also counts characters rather than the units a string is stored in, so it can no longer leave half an emoji behind — which a filesystem refuses for reasons it does not explain, and which arrived as "a file with that name may already exist".
- **The review panel speaks the language the rest of the plugin does.** Nineteen of its lines were written straight into the code in German: the buttons that start a correction, check the glossary and fetch a source, and every status line the panel shows while doing it — what was applied, what could no longer be placed, whether the note still matches its source. Everything around them was translated, so an English install asked a person to accept changes to their own writing using buttons they could not read. The strings now sit in the same place as the rest, in both languages.
- **The schedule and the source refusals speak the set language too.** The cron field names, both validation messages and the four schedule examples in the sync settings were German in the code, as was every reason a source URL can be refused — the lines that tell you why a binding was not accepted. They now sit with the rest of the translations. One thing fell out of it: the month field was recognised by comparing its display name against "Monat", so translating that name would have turned `jan` into month zero; it goes by a key now.

## 1.17.0 - 2026-09-13

### Added

- **"Move to…" on the context menu.** Dragging a row onto a folder needs a mouse, and on a phone the long press belongs to the menu, so until now nothing in the vault could be moved from this pane at all on the device the pane was built for. The entry offers the folders the item may actually go into — the vault root first, then the rest in order — and leaves out the folder it already sits in, its own subtree, and anything already holding a file of that name, so a choice is never answered with a refusal. The move goes through Obsidian's own rename, so links follow it.

### Fixed

- **A folder takes a drop anywhere in its block, not only on the row naming it.** Aiming at a file inside a folder is how a person says "in there", and until now it was the one aim that did nothing at all: a file is not a destination, so the drop was discarded without a word. A file row now answers with the folder holding it, and a file at the vault root with the root. The mark stays on the folder that will actually receive the item — its own row, or the "Files and folders" header when that folder is the root — so what lights up is still the destination rather than whatever the pointer happens to be over. Only the tree counts: the pinned, bookmark and recent lists above it are not places in the vault.
- **A drag no longer dies when the pane redraws under it.** The pane redraws on any vault event, and a vault raises them throughout a drag — the note you are editing saving itself is enough. The redraw threw away the row the pointer was holding, the capture went with it, and the drop never arrived: the file simply stayed where it was, with nothing to say why. A redraw now waits for the button to come up. A release anywhere ends the drag, so a row that does go missing cannot leave the pane holding redraws back for ever.
- **A row no longer opens itself at the end of a drag.** The click that follows the release landed on the row the drag had just moved, so a file opened on arrival and a folder closed itself. The pinned strip had guarded against this since the drag was pinned-only; the tree never did.
- **A name can no longer be selected out of a row mid-drag.** Dragging across the list selected the text in it, which looks like a mistake and is one: a selection dragged across a page is a drag the browser thinks it owns, and it cancels the pointer that the move was riding on.
- **The context menu a long press opens can now be used.** The menu appeared while the finger was still down, and the lift that ended the press raised a click on the row underneath it — so the browser opened the file, Obsidian closed the menu over it as a press outside, and on a phone opening a file closes the sidebar as well. The menu was gone before an item could be tapped, which made every action behind it, deleting above all, look as if it did nothing. The row that owns the gesture now swallows what its own lift raises: the press it answered ends there instead of reaching the file.
- **A long press survives a finger that is not perfectly still.** Any movement at all cancelled it, down to a single pixel of tremor, so the menu often never appeared and the press read as a tap. A press now tolerates ten pixels, past which the list is being scrolled and the press is not a long one.
- **A delete that fails says so.** It was written to the console and nowhere else, so a refused delete was indistinguishable from a pane that had missed the change: the dialogue closed, the row stayed, and nothing explained why. Moving to the system trash is the case that can fail on a phone, where there is no system trash to move to.

## 1.16.0 - 2026-09-12

### Added

- **Opening the pane shows the file you are editing.** A note is usually reached some other way — the quick switcher, a link, a search hit — and the pane would open on whatever folders happened to be left open, with no sign of the note in front of you. It now opens the folders above that file and scrolls to it, both when the pane is first opened and when an already open one is brought forward. What a reveal opens is held apart from what you opened by hand and never written to storage, so being shown where a file lives does not quietly rearrange the pane for every session to come. Clicking such a folder closes it, as it would any other.
- **Collapse all, on the pane's own header.** The same button Obsidian's explorer carries, in the same place and with the same icon. It could not simply follow Obsidian's: that one is a header button and nothing else, raising no event and registering no command, so there is nothing for a plugin to hear. This one is also a command, so unlike Obsidian's it can take a hotkey. It closes what you opened by hand and what a reveal opened for you, and leaves the sections alone, since a section is not a folder.
- **The filter field can be emptied with one click.** A small cross appears inside the field once there is something in it, and clearing puts the cursor back in the field, since the reason to clear it is usually to type something else. It is not there while the field is empty, because there would be nothing for it to do.

### Fixed

- **Focus mode dims callouts, tables and embeds.** It dimmed by marking lines, and a rendered block is not a line: Obsidian replaces the source with a widget, so the mark had nothing to attach to and the block stayed at full strength while the prose around it faded — which is the opposite of what focus mode is for, since the brightest thing on screen was the thing not being written. Every rendered block is dimmed directly now, in both modes, except the one holding the cursor. A callout or a code preview un-renders when entered, but a table stays a widget while being edited, carrying its own editor inside, and dimming it would dim the cell being typed into with no way back.
- **A long press no longer opens the context menu twice.** A press on a touch screen asks for the menu twice over: once when the pane's own timer elapses at half a second, and again when the browser passes its own threshold and raises a context menu of its own. A short press only ever reached the first, which is why this showed up on a long one. Both mean the same press, so the row that owns the gesture turns the second away, whichever of the two arrives first. Nothing else is affected: a second right click on the same row opens again at once, because a right click is never the echo of anything.

## 1.15.1 - 2026-09-12

### Fixed

- **A section header no longer sits on a grey block.** Holding a header at the top of the list means it has to paint something, or rows show through where it sits, and 1.15.0 named a colour for that: Obsidian's sidebar tone in a sidebar, its main tone elsewhere. Which one is right depends on the theme as much as the placement, and a theme that paints its sidebar anything else left every header on a visible rectangle. The pane reads the colour actually behind it instead, off the first ancestor that paints at all, and re-reads it when the theme changes. The header can then only be the colour it is sitting on.

## 1.15.0 - 2026-09-12

### Changed

- **The pane is called Schreibstube Explorer everywhere, in both languages.** 1.13.0 renamed the tab and left the rest: the command, the ribbon's tooltip and the settings section still said "file pane", or "Dateibereich" in German, so the thing had two names depending on where you met it.
- **A section header holds the top of the list while you are inside that section.** Holding the pinned block permanently at the top had a cost that only showed once you scrolled: whatever came next sat directly under it with nothing to say which section it belonged to, so bookmarks and folders read as pinned. Each header below the strip now stays at the top of the list until the next one pushes it out, so the list always says where you are. The pinned block is unaffected and stays where it was.
- **A row fades into the background as it slides under a held header**, rather than meeting a rule. The fall is the pane's own ground, so the row dissolves into the page the way the bottom of Obsidian's own sidebar does. It is drawn only while something is actually scrolled underneath, so a header sitting in its natural place in the list casts nothing.
- **The pane states its own background.** A header that holds position has to paint something or rows show through it. The pane now names its ground, following the same sidebar-and-main-area split Obsidian uses for every other view, and the header borrows it — so at rest the header looks like nothing at all.

## 1.14.0 - 2026-09-12

### Added

- **A file or folder can be dragged onto a folder to move it.** Dropping on the "Files and folders" header moves the item to the vault root, which is the only way to drag something out of every folder it sits in. Whether a move is allowed is decided away from the pointer: a folder cannot be dropped into itself or into its own subtree, a name already taken is refused rather than overwritten, and a refusal says which it was. The move goes through Obsidian's own rename, so links follow. Mouse only — the tree's long press opens the context menu, and on a phone that is the only way to reach a row's actions, so it is not a gesture to take.

### Changed

- **The pinned strip stops looking like a panel.** It painted a background of its own and carried a permanent shadow, which made the top of the pane read as a separate box sitting on it. It paints nothing now: the list scrolls inside its own box below, so nothing ever passes under the strip and it needed no background in the first place. The rule under it appears only once something has actually scrolled past, which is the moment the strip starts holding rows back rather than simply being first, and is drawn as a shadow so its arrival costs no layout.

### Fixed

- **A press that ended outside its row left that row armed.** The pointer was captured only once a drag had begun, so a release delivered elsewhere never reached the row that started it. The next pointer merely passing over that row began a drag with nothing held down. The pointer is captured on the press now, and a mouse with no button held is treated as hovering.
- **A redraw during a drag left the pane unable to open anything.** The row being dragged was destroyed, its release never arrived, and the flag that suppresses the click after a drag stayed set, so every later click on a pinned row was swallowed. Losing the capture now ends the drag, and a redraw clears the flag.
- **Dragging a pinned row on a phone could not work.** The list took the gesture as a scroll and the browser cancelled the drag. The hold now takes the gesture from the scroller, and only after the hold, so an ordinary swipe still scrolls.

## 1.13.0 - 2026-09-12

### Added

- **The pinned block stays on screen.** The filter and the first three pinned rows now sit on a strip above the list rather than inside it, so what you pinned is there whatever you have scrolled to — which is the point of having pinned it. A fourth pin and beyond continue at the top of the scrolling list, directly beneath, so the strip reads as one block with them and can never grow to eat the pane.
- **A file open in another tab carries a faded accent.** The same bar as the row in front of you, at a little over a third of its strength, so the two read as one scale rather than two signals: this is open, that is the one you are looking at. It counts notes, images, PDFs and canvases alike, and a file open in a sidebar counts too, since it is on screen. The marks follow tabs opening and closing, not only the file you switch to.
- **Pinned rows can be dragged into any order.** A mouse starts the drag as soon as the pointer leaves the row it pressed. A finger has to hold first, because on a touch surface a short drag down a list is how a person scrolls, and taking that gesture would make the pane impossible to move. A line marks the edge the row would join rather than shuffling every other row under the finger, and nothing is written until the button or finger comes up.

### Changed

- **The accent bar means the open file, and nothing else.** 1.12.0 gave the active row a bar down its left edge without noticing the tree had used one since 1.9.0 to mark a pinned row. Two meanings, 2px against 2.5px, in two accent colours a theme usually makes identical: a vault with a few pins looked like several files were open at once. A pin is marked by its glyph, which is what the glyph is for.
- **The pane is called Schreibstube Explorer** in both languages. It was "Schreibstube files" and "Schreibstube-Dateien", which named the contents rather than the thing, and read as a folder on the tab and in a phone's pane switcher.
- **The strip is separated by a soft shadow rather than a rule**, so the list appears to pass beneath it instead of stopping at a border.

### Fixed

- **A drag in the Pinned section cannot drop onto a row in the tree.** Both carried the same marker, so a pinned row further down the vault counted as a place to drop and reordered the block against a row that was not part of it. Rows of the section now have a name of their own.

## 1.12.2 - 2026-09-12

### Changed

- **The pane owns its leaf's scrolling, not just its padding.** 1.12.1 took over the leaf's content padding so a rule could reach the edges, but left Obsidian's `overflow: auto` on it. In a side pane, which is where this one lives, that is a second scroller wrapped around the one the pane already runs. It now takes both, the way Obsidian's own markdown, pdf and sync views do, and carries the bottom safe-area inset on its scrolling list so the last row still clears a phone's home indicator.
- **A section header is now a label and a rule.** The rule runs from the label to the right edge, so a header reads as the start of a section rather than a word floating above one. The filled band that marked "Files and folders" is gone: it sets itself apart with a darker label and a firmer rule instead, which leaves the pane quiet and still says where the curated lists end and the vault begins.
- **The pin and the sync mark sit against the name.** The name stretched across the row, which pushed both marks to the far right where they read as belonging to the row rather than to the file they describe. They now follow the last character with a hair of space, and the menu button takes the slack instead.
- **The plugin's icon is drawn to the size the others are.** It covered 16 of its 24 units where Lucide, which every icon beside it in the ribbon comes from, covers about 20: Obsidian's own `folder` measures 91.7% of its box once the stroke counts, against 73.8% for the house. Among them it read as a smaller, lighter icon. The artwork is unchanged and the transform now carries the difference.
- **A picture or a recording is drawn as one.** Every attachment shared the blank-sheet icon, so a folder of screenshots was a column of identical rows. The common image, video and audio extensions get the photo icon; everything else keeps the sheet.
- **The Latest header shows a clock**, which is the icon the design names. It was drawing a history arrow.
- **Created and Modified sit over the lists they name.** Both labels started at the row inset, a chevron's width to the left of every filename under them, so neither read as belonging to its list. They now begin in the icon column.
- **The row's menu button lost its chip.** A filled background on a control that appears on hover is louder than the row it belongs to.

### Removed

- **The trash button on each row.** Delete stays on the context menu behind the same confirmation. A destructive action does not need to be one pixel from the name of every file in the vault.
- **The footer.** Obsidian already shows the vault name and a settings gear directly beneath the pane, so it said the same thing twice.

## 1.12.1 - 2026-09-12

### Fixed

- **The pane's own styling reaches the screen.** Almost none of 1.12.0's design was visible, because every control in the pane is a `<button>` and Obsidian styles those with `button:not(.clickable-icon)` — one class and one element, which outranks a rule carrying a single class of ours. Obsidian's chip background and shadow therefore won on all four section headers, on the row menu and trash buttons, and on both footer buttons, and `button { justify-content: center }` centred every section header's label in the middle of the pane. Every rule that dresses a button is now scoped under the pane so it outranks Obsidian's, and each states the properties that rule sets rather than assuming a default.
- **The band above the tree reaches both edges, and the footer sits on the floor.** Obsidian pads a leaf's content box by 12px at the sides and 32px at the foot. That inset held the "Files and folders" band away from the edges and stranded the footer above a gap. The view takes that padding over and spends it on its own grid instead.

## 1.12.0 - 2026-09-12

### Added

- **The plugin has an icon of its own** — a house with a quill, for "Stube" — registered by the plugin and used for the ribbon button and the pane's tab. It replaces a name borrowed from Obsidian's own set, and with it the fallback that existed because a borrowed name can be missing: an icon the plugin registers itself cannot be.
- **A trash button on every row**, next to the menu button, shown on hover and always on a phone. It opens the same confirmation the menu entry does. Delete was reachable only by opening a menu first, which is a lot of taps for the one action a file list is asked for most.
- **A footer** naming the vault, with help and the plugin's settings beside it.
- **Copy path for Schreibstube sits on the folder's own menu**, in the create block, rather than only on the menu Obsidian builds — where the pane's own rules put it behind "More actions", which is the opposite of what it is for.

### Changed

- **The pane is drawn on one grid.** Every row is a 12px chevron slot, a 7px gap and then its content, indented 15px per level from a 12px base, at a fixed 27px height. Rows without a chevron render the slot empty rather than swallowing it, so an icon at a given depth lines up with every other icon at that depth — across sections, not only inside the tree. Latest used to sit on a hardcoded inset of its own and the tree stepped 17px from a 4px base, so nothing quite lined up with anything.
- **"Files and folders" is drawn as a band** across the pane with a rule above and below. It is the one header that separates two kinds of thing, the curated lists above and the vault below, and it used to look like the other three.
- **An active row carries an accent bar** down its left edge rather than a background tint alone, which a theme whose hover and active colours are close together made nearly invisible.
- **The filter says what it filters.** Its placeholder named files; it has always searched all four sections.
- **Rows take their colours from Obsidian's navigation variables** rather than the generic background ones, so the pane matches the file explorer beside it in any theme.

## 1.11.0 - 2026-09-12

### Added

- **A Pinned section at the top of the pane.** Pinning moved an item to the top of its own folder and nowhere else, which is invisible from the rest of the tree: a note pinned four folders down sat at the top of a folder nobody had open, and the pin read as having done nothing. Everything pinned now has a place of its own, in the order it was pinned, drawn only when something is pinned. A pinned folder in that section reveals itself in the tree rather than opening a second copy of it.
- **A pinned row is marked in the tree**, so a pin is visible on a row that would have sorted near the top anyway.
- **A ribbon icon opens the file pane.** It was reachable only through the command palette, so enabling the plugin changed nothing anyone could see until they went looking for a command they had to already know about. The icon name is checked against the set Obsidian actually ships and steps down to a plain folder when it is missing, because an unknown name draws an empty button with no error anywhere to say so.

### Fixed

- **A one-line `$$x$$` no longer swallows the rest of the note.** It opened a maths block that only a later `$$` closed, so every paragraph after it was dropped from the proof-read pass, to the end of the note when no later one came.
- **A glossary card is identified by its span, not by a counter.** A re-scan renumbered from zero, so a card kept from the previous run could share an id with a new card somewhere else: Accept reached whichever came first and Reject took both.
- **`explorer.json` stops growing.** Its thirty-day pruning ran only at load, against data the very next write merged back in from the file, so nothing was ever actually collected. Pruning now happens where it reaches disk.
- **A failed chunk reports its progress**, so a run whose last chunk fails no longer leaves the review panel a chunk short.

## 1.10.1 - 2026-09-12

### Fixed

- **The tag, the repository and the published assets name the same version again.** 1.10.0 was released from a branch whose version bump had not yet reached `main`, so its tag sits on a tree that still says 1.9.0 while its assets say 1.10.0. No code changed between the two releases; this one exists so a checkout of the tag matches what was published under it.

## 1.10.0 - 2026-09-12

### Added

- **Bookmarks in the file pane.** A list of links above the tree for the places the tree cannot hold: a web page, an Obsidian URI, a vault folder, a note. Obsidian's own bookmarks cover the last two and have no room for the first two.
  - **A Markdown file is the whole store.** `bookmarks.md` by default, anywhere in the vault by setting, in the format Launchpad used — a heading is a folder, a second-level heading a subfolder, a list item a link, a `[[wikilink]]` a note. An existing file is read as it stands.
  - **The pane never writes it.** Links are added by editing the file, which is what keeps the list readable, versionable and mergeable, and what leaves exactly one writer per device: the person.
  - **Five schemes open, everything else is dropped while reading** — `https`, `http`, `obsidian://`, `vault://` and `note://` — so a `javascript:` line pasted into a synced file never becomes a row that can be tapped. A `vault://` bookmark reveals the folder in this pane, ancestors opened, rather than handing the job to Obsidian's explorer.
  - **Open bookmark**, a command that searches the list by name, folder or URL, offering what was opened most recently on that device first. Recents are stored per device and never written into the file.
  - **Copy path for Schreibstube** on any folder's context menu, which is how a `vault://` URL is obtained without typing a path out by hand.
- **Latest in the file pane.** The notes created most recently and those changed most recently, in two short lists. A note shown as created is not repeated as changed, only Markdown counts, and the bookmarks file is always excluded. The count and further exclusions are settings.
- **The pane has sections**, each collapsible: bookmarks, latest, files and folders.

### Changed

- **The pane remembers what was open.** Which folders and which sections, stored per device in Obsidian's local storage rather than in a synced file — what is open on a phone is not a thing a laptop should inherit, and it is not worth a sync conflict. Folder expansion was previously lost on every restart.

## 1.9.0 - 2026-09-12

### Added

- **A file pane of Schreibstube's own** (`Open file pane`), because three things cannot be done to Obsidian's explorer from a plugin without fighting it.
  - **An icon per file and per folder**, chosen from 172 icons in a searchable picker, grouped by what they are for. The set is a subsetted Tabler webfont carried inside the bundle — 24 KB of woff2 — so it works offline and on mobile with no request to a CDN. Icons are stored by name, so a font upgrade never scrambles a vault.
  - **A sync mark on notes bound to a source**: in sync, changes waiting, never checked, or a source that cannot be fetched. Derived from what the poller already records, so a mark costs no request. Shape carries the state, colour only reinforces it, and nothing is shown while document sync is off.
  - **Pinning to the top of a folder**, in the order things were pinned. Below the pinned block, Obsidian's own arrangement: folders first, then files, numeric-aware.
  - **One context menu instead of several.** The pane builds its own, in a fixed order, and every item other plugins contribute goes behind a single "More actions" entry at the end. The pane fires Obsidian's own `file-menu` event, so those plugins need to know nothing about it; a setting moves their items inline or removes them.
  - **Sync lives in that menu**: bind a note to a source with the URL validated before it is written, check one note now whether or not it is open, open the source, remove the binding, or refresh every bound note in a folder.
- **A per-note source check** (`SyncPoller.checkFile`) and a per-folder one, next to the existing whole-vault poll. The poll walked the vault or the open note and had nothing in between, which is exactly what a file list needs.

### Changed

- **Icons and pins live in their own file**, `explorer.json` in the plugin folder, rather than in `data.json`. That file is written by overwriting the whole settings object, so a device holding a stale copy in memory would clobber another device's changes along with mailbox and publishing state. The new file is merged per entry, newest wins, re-read before every write, and watched for writes delivered by iCloud, Obsidian Sync or Git while the pane is open. Writes are debounced, so pinning three notes is one write.
- **A file that moves keeps its icon.** Renames are followed, including every file under a renamed folder. A file that disappears keeps its entry for thirty days, so a move made outside Obsidian — which arrives as a delete and a create — can hand the icon back when the file turns up under the same name. An ambiguous match is left alone rather than guessed.

## 1.8.0 - 2026-09-12

### Added

- **The interface speaks German and English.** It was half of each; both are now first class. English is the reference catalogue and gives the message type, so a string added without a translation does not compile. The language follows Obsidian's own by default, with a setting for when it should not.
- **A linter, a formatter and an editorconfig**, with the rules deliberately few: formatting belongs to Prettier, and what is left are the mistakes nobody should have to catch by eye.
- **CI runs what it was not running**: both Node versions the bridge supports, the linter, the formatter, coverage against a floor, and an assertion that the built bundle reaches for no Node built-ins — the property that keeps the plugin working on mobile.
- **The publish controller has tests**, behind a stub of Obsidian and a fake vault. It was the largest untested file in the plugin, and it decides what the bridge writes and what it deletes.
- **One slug contract**, shared by both implementations. The rule existed twice, in two languages, and had to agree or a published page would stop being reachable.
- **Property tests for the path rules** and an awkward vault fixture — emoji in a filename, a note that is one long line, a dead wikilink, a missing date — with the rendered pages snapshotted, so a layout change shows up as a diff rather than as nothing.
- **Uploads retry** with backoff and jitter. They are addressed by the hash of their content, so a repeat is either a no-op or the same write again; one dropped connection used to fail a whole publish.
- **Each account shows what it last published**, generates the bridge's environment block, and picks its target from a list the bridge provides rather than a retyped name.
- **The plugin checks the bridge's protocol version** once per session, so a bridge that was not redeployed says so instead of answering a 404 that reads like a wrong URL.
- **Each publish leaves a trace**: the last fifty summaries are kept next to the manifest, so "when did that page change" has an answer.
- **Two per-target switches**: raw HTML inside a note, and diagrams. A page with a diagram loads five megabytes, now only when a diagram is about to be read.
- **`ARCHITECTURE.md`, `CONTRIBUTING.md`, a mobile checklist, a bridge compatibility table, an example publish folder, and a release script** that bumps the three files carrying a version together.
- **The publish frontmatter keys are configurable.** A vault that already names these fields its own way can map each role — published, title, date, description, slug, and the two written back after publishing — to the key it uses, under **Frontmatter-Felder** in the publish settings. The defaults are the plain names (`published`, `title`, `date`, …), since a collision with another plugin's property is what the mapping is there to resolve. A configured key replaces the default rather than adding to it; a blank field means "unchanged", and two roles cannot share a key, because the plugin would have no way to tell which meaning was intended.
- **Publishing: a vault folder becomes a website, from desktop and from mobile.** Three commands — **Veröffentlichen**, **Veröffentlichung prüfen** and **Website öffnen** — publish a folder as a static site over SFTP.
  - **Opt-in per note.** A note is published when its frontmatter carries `published: true`; removing the flag takes the page down on the next publish. Title, date, description and slug come from frontmatter, each with a sensible default. After publishing, the time and the address are written back into the note.
  - **The bridge renders the Markdown**, so the output is identical from a phone and a laptop, can be snapshot-tested, and can be rebuilt months later without the vault. Wikilinks between published notes become site links; a link to an unpublished note degrades to plain text rather than a dead link. Callouts, footnotes, tables, definition lists, task lists, highlights, maths and Mermaid diagrams all render, and comments never reach the page.
  - **Images and video** referenced by a published note are uploaded under a content-addressed name, so a changed picture cannot be served from a cache.
  - **A plan before anything moves.** The confirmation dialog lists what will be uploaded and, in full, what will be deleted.
  - **Only what changed travels.** Sources are addressed by content, so an unchanged note is never uploaded twice and a renamed one uploads nothing at all. Re-publishing an untouched folder writes nothing.
  - **Deletions are safe by construction.** The bridge keeps a manifest of every file it wrote; a file it has never heard of is never touched. The manifest is written last, so an interrupted publish costs repeated work rather than a lost file.
  - **The hosting credentials stay on the bridge.** The vault holds a target name and a token, and the publish token is separate from the mail token. The host key is checked against a configured fingerprint.
- **Publish settings section** — bridge URL (falling back to the mail bridge), publish token in Obsidian's secret storage, and one entry per account with a connection test that proves token, target, SSH login, host key and web root in one request.
- **The bridge has tests.** 295 of them, covering configuration, routing, authorisation, the throttle, deadlines, the mail paths, the path rules, the manifest, the renderer and the whole publish flow. They run under the repository's own `npm test`: the mail paths use a fake SMTP transport and a fake IMAP client, and the publish flow drives a real SSH connection into a real SFTP server, so nothing reaches the network.
- **A CI workflow** runs the test suite and the production build on every pull request.
- **The plugin explains the bridge's new statuses** — throttled, restarting and timed out — instead of echoing the status code.
- **Email commands, working on mobile as well as desktop.** Three new commands:
  - **Send note as email** — addressing comes from the note's frontmatter (`schreibstubeTo`, `schreibstubeCc`, `schreibstubeSubject`), the body is the note with its frontmatter stripped. A confirmation dialog shows recipients and subject before anything leaves the vault. On success the assigned `schreibstubeMessageId` and `schreibstubeSentAt` are written back to the note.
  - **Query mailbox** — search IMAP by sender, subject, full text and date, then insert the chosen message into the active note.
  - **Fetch replies into note** — find replies to the note's own `schreibstubeMessageId` and append the new ones under a configurable heading. Every merged message is recorded in `schreibstubeMergedIds`, so the command is idempotent and can be run as often as you like without duplicating content.
- **Mail bridge** (`bridge/`) — a small, stateless self-hosted service that speaks IMAP/SMTP on the plugin's behalf. Ships with a Dockerfile and Sliplane deployment instructions.
- **Email settings section** — bridge URL, bridge token (in Obsidian's secret storage), optional From override, mailbox, result limit, and merge heading.

### Changed

- **The settings tab is one module per area** rather than a 900-line class, and each control changes a setting through one call instead of repeating five lines.
- **Background polling moved out of the review controller**, which was holding three concerns because they happened to share a store.
- **Nodemailer moves to 10**, clearing its advisories. The findings that remain reach the bridge through Mermaid's parser; `bridge/README.md` says exactly what they are rather than silencing them.
- **The bridge can log JSON**, behind a flag, for a hosting dashboard that searches fields.
- **A JSON request body that is not an object is refused as one**, rather than falling through to a field check and being reported as a missing field.
- **The bridge is now capability-based** (`bridge/` 2.0.0), in preparation for publishing. Each capability brings its own token, credentials and limits; a capability whose variables are absent is not offered, and a deployment that offers nothing refuses to start. One capability's token never opens another's routes.
  - **`BRIDGE_TOKEN` is now `MAIL_TOKEN`.** Rename it in your deployment before updating the bridge. Nothing changes in the plugin: the token is still sent as `Authorization: Bearer`.
  - **Errors carry a stable `code` and a `requestId`** alongside the message, so a report can be tied to a log line. Every log line about a request carries the same id.
  - **`/health` reports the bridge version, the protocol version and the capabilities offered**, so a bridge that was not redeployed alongside the plugin can say so instead of failing on an unknown route.
  - **New `/diagnostics` endpoint** opens a real connection with the configured credentials and reports each protocol separately.
  - **The token is now checked before the path**, so an unauthorised caller cannot map the bridge by probing for routes.
  - **Repeated authentication failures from one address are throttled**, then answered with a 429 and a `Retry-After`. The health probe stays reachable.
  - **Every outbound operation has a deadline** and every request a budget, so a connection that neither answers nor closes can no longer hold a request open until the client gives up.
  - **Shutdown drains in-flight requests** instead of cutting them off, so a redeploy is not a crash.
- Run the bridge as a single instance. Shared state such as the throttle lives in memory.

### Fixed

- **Duplicate correspondence sections.** A merge heading configured with stray whitespace never matched the section it wrote last time, so every "Fetch replies" run appended a fresh `## Correspondence` block.
- **A send is no longer reported as failed after the mail has gone out.** Persisting `schreibstubeMessageId` is now separate from the send itself: if it fails, the notice says the mail was delivered and shows the ID to add by hand, instead of inviting a re-send that would deliver a duplicate.
- **"Fetch replies" reports its own failures.** It previously had no error handling, so a failed write surfaced only as an unhandled rejection — with `schreibstubeMergedIds` unwritten, making the next run duplicate the replies it had already merged.
- **Merging no longer races the editor.** Replies are appended with an atomic read-modify-write, so a pending editor flush can no longer discard either unsaved typing or the merged replies.
- **The in-flight guard now spans the whole reply merge**, not just the search, so two overlapping runs cannot append the same replies twice.
- **Bridge: oversized requests return a readable 413** instead of dropping the connection, and the size is rejected from the declared `Content-Length` before any body is read.
- **Bridge: the search limit is clamped from both ends.** A negative or non-numeric `limit` previously inverted the result window, returning the oldest matches and far more of them than configured — each one fully parsed.

### Notes

- The plugin gains no new dependencies and remains available on mobile. Obsidian's mobile runtime has no Node and no raw sockets, so IMAP/SMTP cannot be spoken from the plugin; all mail traffic goes to the bridge over HTTPS via `requestUrl`, the same transport the AI commands already use.
- The mailbox password lives in the bridge's environment, never in the vault. The plugin stores only the bridge token, which can be rotated independently.
- Fetched message bodies are quoted when merged into a note, so email content cannot inject headings or lists into the note's own structure.
- Frontmatter keys follow the plugin-wide `schreibstube` prefix rule, so nothing the mail commands read can collide with another plugin's properties.

## 1.7.0 - 2026-09-11

### Added

- **Background poll for bound notes.** Every note bound to a source can be checked on a schedule, not just the one you have open. Changes found while a note is closed are counted, so opening it later surfaces them immediately, and a single summary notice reports how many notes changed rather than one notice per note.
  - The schedule is a five-field cron expression in local time, with lists, ranges, steps, and month and weekday names. Cron's OR rule for the two day fields is implemented, so `0 9 1 * 1` fires on the first of the month and on Mondays.
  - The settings screen validates the expression as you type and shows the next fire time, since a schedule cannot be verified by waiting for it.
  - Obsidian has no scheduler, so a poll runs only while the app is open. A schedule that came due while it was closed is caught up once shortly after the next start, which is what makes a daily poll usable on a machine that is not always on.
  - Requests are capped and the per-note interval still applies, so one tick never becomes a burst. State for the whole poll is written in a single save rather than once per note.
  - A poll that found changes has already advanced the validator, so the next interactive check fetches unconditionally. Without that the conditional request would answer "unchanged" and the update would be lost.
  - New command **Check all bound notes for updates** runs the poll immediately, regardless of schedule.
- **Private GitHub repositories.** A token stored in Obsidian's secret storage makes sources in a private repository work, and raises GitHub's rate limit. Authenticated reads go through the contents API, which is the path that serves a private file.
  - The token is only ever sent to GitHub. A note's URL cannot cause it to be attached to any other host, and a raw GitHub URL is recognised as a GitHub source just as a page URL is.
  - Without a token a private source reports that a token is needed rather than claiming the file was deleted, since GitHub answers 404 in both cases.
  - A rate-limited response says so instead of reporting a generic failure, and a response that arrived as metadata rather than file content is refused rather than written into the note.

### Settings

- **Document sync** gains a GitHub token, a background poll toggle, and the cron schedule.

## 1.6.0 - 2026-09-11

### Added

- **Document sync.** A note can be bound to a remote Markdown file with a `schreibstubeSyncedFrom` frontmatter key, and mirrors it. The source is the single truth and nothing is ever pushed back; incoming changes arrive in the review sidebar as cards you accept one at a time. A bound note can live in any folder, because it is found by its key rather than its location.
  - Changes are hunk-level, so one card covers one coherent edit rather than scattering a rewritten paragraph across a dozen word changes.
  - The note's own frontmatter is never part of the diff, and the remote file's frontmatter is stripped before comparison. Without the second rule the first sync of any source with frontmatter would overwrite the binding and orphan the note.
  - Local edits are detected with a hash of the body as of the last sync, so an edited mirror is reported as diverged rather than having your own words presented back as a remote change. The baseline advances only once the note matches the source again.
  - A deleted or moved source is reported on the card and the note is left untouched. It is never emptied.
  - Only HTTPS sources with a Markdown path are fetched, with a size cap and a content-type check. GitHub page URLs are rewritten to their raw form. Checks are conditional, so an unchanged source costs no download.
  - New command **Check note source for updates**, plus an optional check when a bound note opens, rate-limited per note.

### Changed

- **Every frontmatter key the plugin reads is now `schreibstube`-prefixed camelCase, and the old spellings are gone.** Obsidian frontmatter is one flat namespace shared with other plugins and with the user's own properties, so a bare key is a collision waiting to happen. Existing glossary notes need their frontmatter updated.

  | Before | After |
  |---|---|
  | `schreibstube-glossary` | `schreibstubeGlossary` |
  | `language` | `schreibstubeLanguage` |
  | `default-severity` | `schreibstubeDefaultSeverity` |
  | `glossary` | `schreibstubeGlossaries` |

### Settings

- New **Document sync** section: enable the feature, check on open, and the minimum interval between automatic checks.

### Internal

- The word-level and line-level diffs now share one longest-common-subsequence implementation, so they cannot drift apart in how they decide what changed.

## 1.5.0 - 2026-09-11

### Added

- **Proof-read sidebar.** A side pane that reviews the active note and proposes changes one at a time, each as a word-level diff with accept, reject, and jump-to-place. Three commands drive it: **Open proof-read sidebar**, **Proof-read note**, and **Check note against glossary**. Accepting the whole queue applies it as a single undo step.
  - The model is asked for clean prose, never for diffs or line numbers; every change and its offsets are derived locally, so what a card shows is what the document says.
  - Frontmatter, fenced code, tables, and math blocks are excluded from a run. Inline code, wikilinks, link targets, tags, and bare URLs are masked before sending and restored afterwards; a response that lost one is discarded rather than applied.
  - Cards are re-anchored against the live note before they are applied, so editing while the queue is open marks cards stale instead of rewriting the wrong words.
  - Long notes are chunked, with suggestions appearing per chunk. A failing chunk no longer loses the chunks that succeeded, and a run can be cancelled.
- **Glossary support.** A glossary is an ordinary note carrying `schreibstube-glossary: true` and a term table. Checks run locally and need no API key; the selected terms are also passed to the correction pass as constraints so a rewrite cannot undo them.
  - The term model follows TBX-Basic (ISO 30042): concepts group terms, and each term is `preferred`, `admitted`, `deprecated`, or `superseded`. A forbidden term with no replacement is therefore an ordinary case, not a special one. TBX picklist identifiers and the `notRecommended` and `obsolete` spellings are accepted for pasted exports.
  - Rule shapes follow Vale's vocabulary: substitution, existence, and capitalization, with suggestion, warning, and error severities.
  - Matching is whole-word and Unicode-aware, tolerating German inflection endings, with `exact` and `prefix` modes per term. An inflected match is flagged for review rather than silently given a base-form ending.
  - Which glossary applies is resolved in one order with no merging: the note's own `glossary` property, then a folder rule, then the sidebar pick, then the vault default.
  - Optional live underline of error-severity terms in the editor, off by default.

### Settings

- New **Proofreading** section: prompt, maximum response tokens, characters per request, and parallel requests.
- New **Glossary** section: default glossaries, folder rules, and the editor underline toggle.

## 1.4.0 - 2026-09-04

### Added

- **Summarize selection** command — select text in a note and replace it with an LLM-generated summary. Built for turning raw text pasted from analytics and reporting tools into a running insight log. The summarize prompt is configurable (with an insight-log preset as the default) and a **Maximum response tokens** setting caps the summary length. The command uses the shared AI model configured under **AI models**.
- **Debug logging** setting (under a new **Diagnostics** section). Errors are always logged to the developer console; enabling this adds verbose tracing to help diagnose issues.

### Changed

- **Shared AI configuration.** Provider, model, custom model ID, and API key now live under a dedicated **AI models** settings section and are shared by both rename and summarize (previously grouped under rename). Existing configurations are migrated automatically.
- **Production builds now ship inline source maps**, so console stack traces from a release point at real source.

### Internal

- Extracted the link-open-mode feature and the LLM commands out of the main plugin class into dedicated controllers; isolated every access to undocumented Obsidian internals behind a single guarded adapter that degrades to a logged no-op if an internal changes.
- Focus-mode decorations are now built only for the visible range, and the reading-view lifecycle observer no longer watches the whole document subtree — both reduce work on large notes and large workspaces.
- AI commands now guard against overlapping runs, and summarize targets the originally selected range even if the cursor moves while the request is in flight.

## 1.3.0 - 2026-08-28

### Changed

- **The heading-stack overlay is now ancestor-only.** It shows the chain of headings above the current viewport so you can see where you are in the document, and clicking a row jumps to that heading. Sibling expansion — hovering or tapping an ancestor to browse and jump between headings at the same level — has been removed, along with the **Max visible rows** setting. The **Enable heading stack overlay** toggle and click-to-navigate remain.

## 1.2.0 - 2026-08-28

### Added

- **Interactive sibling expansion restored in the heading-stack overlay.** Hover (desktop) or tap (touch) an ancestor to expand its siblings and jump to any heading at that level, on top of the outline connector styling. This behaviour was documented in the README but had been dropped from the code in 1.1.7.
- **Max visible rows** setting (3–20, default 6) — caps the height of an expanded sibling list. Restored alongside the feature above.
- **Enable heading stack overlay** setting — turn the overlay off entirely.
- **Custom model ID** setting — override the model dropdown with a newer or unlisted model id for the selected provider.
- Request **timeout** (30 s) for rename calls, so a stalled provider no longer hangs the command.

### Changed

- **Rename calls now use Obsidian's `requestUrl`** instead of the browser `fetch`, bypassing the renderer CORS restrictions that could block direct Anthropic/OpenAI requests.
- **LLM provider integration refactored** into a single registry (`llm-providers.ts`) that is the one source of truth for endpoints, headers, request bodies, response parsing, and model lists.
- **Google/Gemini removed** as a provider; Anthropic and OpenAI remain.
- README now documents all four feature areas (heading stack, focus mode, rename, link modes) with settings tables.

### Fixed

- Rename **API errors** are now mapped to actionable messages (invalid key, rate limited, service error) instead of a raw JSON blob.
- Model responses that wrap the filename in a code fence, quotes, or a `Filename:` label are cleaned up before the name is applied.

## 1.1.13 - 2026-06-27

### Fixed

- **Outline indent beyond 3rd level** was broken: the connector span inherited `white-space: nowrap` from its parent, which collapses consecutive spaces. Added `white-space: pre` to the connector span so every indent level renders at the correct depth.

## 1.1.12 - 2026-06-27

### Fixed

- **Outline tree connectors** no longer show a redundant leading `│` on deeper levels. The path now renders as clean indented `└─` entries:
  ```
  Chapter
  └─ Section
     └─ Subsection
  ```

## 1.1.11 - 2026-06-27

### Improved

- **Document tree outline** strips Markdown formatting (bold, italic, inline code, links, wikilinks) from heading text so it renders cleanly in the overlay.
- **Tree connector indicators** replace hash prefixes in the outline overlay. Ancestor headings appear in muted colour with `│`/`└─` connectors; the current (innermost) heading is highlighted in accent colour, making your position in the document immediately visible.

## 1.1.10 - 2026-06-13

### Fixed

- **Rename file from content** command is now visible in reading mode, when a side panel has focus, and on mobile. It previously used `editorCallback` which only registers the command while an editor is focused; it now uses `callback` like the image rename command.

## 1.1.9 - 2026-06-12

### Fixed

- **Directional link-open now works in Live Preview (edit mode).** In Live Preview, CodeMirror renders links as span decorations and calls `workspace.openLinkText()` directly, bypassing the DOM click handler that covered Reading mode. The plugin now also patches `openLinkText` at load time so both view modes are intercepted correctly.

## 1.1.8 - 2026-06-12

### Added

- **Directional link-open commands** — three new commands for focused reading sessions:
  - **Open links to the left** — while active, every internal link you click opens in a vertical split to the left; focus returns to your reading pane automatically.
  - **Open links to the right** — same, but right.
  - **Open links normally** — restores Obsidian's default behaviour.
  - The side pane is reused for subsequent clicks (no pane accumulation). Links with heading or block subpaths (`[[Note#heading]]`, `[[Note^block]]`) scroll to the correct position.
  - A status-bar chip (`← links` / `links →`) shows which mode is active.

## 1.1.7 - 2026-06-12

### Fixed

- **API errors now show the actual provider message.** Previously, any 4xx/5xx response from Anthropic, OpenAI, or Google was surfaced as a generic "could not reach the LLM API" notice. The response body is now included so the real reason (wrong key, quota exhausted, unsupported model, etc.) is visible in Obsidian.

### Improved

- Removed dead code left over from the stack-only overlay refactor (1.0.1): unused interaction state interfaces, no-op collapse reducers, `isTouchDevice()`, the global `pointerdown` listener, and the `overlayMaxVisibleRows` setting that controlled sibling lists that no longer exist.

## 1.1.6 - 2026-06-12

### Added

- **Rename image from content** command — works the same as the existing text rename, but for images open in Obsidian. The image is resized to a configurable maximum dimension (default 768 px) before being sent to the LLM, keeping costs low. All vault links to the file are updated automatically.
- New **Max image size** setting (256–2048 px) under _Rename file from content_ in Settings.
- Supported formats: jpg, png, gif, webp. SVG and BMP are not supported by vision APIs and show a notice.

## 1.1.5 - 2026-06-12

### Fixed

- **Dim opacity setting had no effect.** The settings tab was missing the **Dim opacity** slider entirely, leaving `focusDimOpacity` stuck at its default (0.4) with no way to change it through the UI. The slider is now present under the overlay settings.

## 1.1.4 - 2026-06-09

### Fixed

- Focus mode commands (**Focus Mode: Sentence**, **Focus Mode: Paragraph**, **Focus Mode: Disable**) were missing from the command palette — restored after being dropped during the 1.1.1 merge rewrite.

## 1.1.3 - 2026-06-09

### Fixed

- API key is now configured using Obsidian's native `SecretComponent`. The settings field shows a proper secret picker — users select or create a named secret rather than pasting a raw key. The plugin stores only the secret name; the actual value is retrieved from `SecretStorage` at runtime and never exposed in the UI.
- `minAppVersion` bumped to `1.11.4` (minimum required for `SecretComponent`).

## 1.1.2 - 2026-06-09

### Improved

- API key settings UI overhauled: when a key is stored it shows a status indicator with **Replace** and **Clear** buttons — the actual key value is never displayed. When no key is stored a plain password input appears; saving happens on blur and the view refreshes automatically.
- Stale `feat/llm-rename-file` and `schreibstube-main` remote branches removed.

## 1.1.1 - 2026-06-09

### Fixed

- Paragraph focus mode no longer treats an entire Markdown list as one block. Each list item is now its own focus unit, so sibling items are dimmed correctly.

## 1.1.0 - 2026-06-09

### Added

- **Rename file from content** command: trigger via command palette or keyboard shortcut to have an LLM generate a filename from the active note's content and rename the file in-place.
- Supports Anthropic (Claude Haiku 4.5, Claude Sonnet 4.6), OpenAI (GPT-4o mini, GPT-4o), and Google (Gemini 1.5 Flash, Gemini 1.5 Pro) as LLM providers.
- API keys stored in Obsidian's native SecretStorage — never written to plugin data.
- Configurable minimum content length (default 50 chars), maximum content sent to LLM (default 4 000 chars), and maximum filename length (default 60 chars).
- All failure paths (no key, API error, empty result) surface a Notice.

### Improved

- Settings: number inputs now save on blur instead of on every keystroke.
- `focus-settings.test.ts` moved to `src/services/` to match co-location convention.
- Added 23 unit tests covering `sanitizeFilename` and `normalizeSettings`.
- README rewritten to document both plugin features with a settings reference table.
- `.gitignore` extended to cover `*.map`, `Thumbs.db`, and `.claude/`.

## 1.0.2 - 2026-06-02

### Fixed

- Paragraph focus mode no longer treats an entire Markdown list as one block. Each list item is now its own focus unit, so sibling items are dimmed correctly.

## 1.0.1 - 2026-06-02

### Changed

- Restored deterministic stack-only headline overlay behavior in Live Edit.
- Removed hover and sibling expansion behavior; click/tap now navigates directly.
- Aligned overlay host mounting with the original Headway implementation for reliable Live Edit rendering.
- Improved iOS behavior with safe-area notch padding for the top stack row.
- Updated local docs for current stack-only behavior and release flow.

### Fixes

- Fixed cases where no heading stack appeared in Live Edit after reopening/re-activating the plugin.
- Fixed iOS regressions causing stuck/flickering scroll behavior.

### Release

- BRAT-ready release artifacts: `main.js`, `manifest.json`, `styles.css`.

## 1.0.0 - 2026-06-02

### Changed

- Plugin identity renamed from Headway to Schreibstube.
- Focus mode naming aligned to sentence and paragraph semantics.
- iOS-focused behavior fixes and styling updates for overlay and focus visuals.
- Repository hardened for distribution with docs excluded from Git tracking.

### Release

- First stable public release for BRAT installation.

## 0.1.1 - 2026-06-01

### Added

- MIT license file (`LICENSE`).

### Changed

- Release metadata bumped from `0.1.0` to `0.1.1` in manifest and package metadata.
- Added `0.1.1` compatibility mapping in `versions.json`.

## 0.1.0 - 2026-06-01

### Added

- Initial Obsidian plugin scaffold with TypeScript + esbuild build pipeline.
- Sticky heading ancestor overlay for active Markdown notes.
- Edit mode and reading mode integration.
- Click/tap navigation to headings from overlay rows.
- Desktop hover expansion for ancestor levels.
- Touch interaction model:
  - first tap expands
  - second tap navigates
  - outside tap collapses
- Parent-scoped sibling resolution with configurable row cap.
- Theme-aware overlay styling.
- Settings tab with `overlayMaxVisibleRows` (3-20).

### Architecture

- Extracted runtime bootstrap registration, scheduler, overlay coordinator, reading navigator, and pure interaction reducers into dedicated services.
- Added architecture documentation in `docs/ARCHITECTURE.md`.

### Quality

- Added unit tests for heading parsing, ancestor/sibling resolution, interaction reducers, reading mapping/navigation, refresh scheduler, host/coordinator lifecycle, and settings normalization.
- Added QA checklist and fixture note for manual validation.
