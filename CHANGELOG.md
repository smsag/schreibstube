# Changelog

All notable changes to this project will be documented in this file.

## 1.19.1 - 2026-09-13

### Fixed

- **A deleted file leaves the list at once.** It went when it was deleted; the row did not. The pane draws what the vault says it holds, and the vault says a file is gone when its own watcher has noticed — which on a phone, behind a sync client, is seconds after the file went, and seconds of a row sitting there is a delete that looks as though it failed. The row is now taken away the moment the trash call returns, and the vault's event, when it arrives, only confirms it. If no event ever arrives the row comes back within ten seconds rather than a file being hidden by a plugin that was only guessing, and a path written again is visible again immediately, whatever was trashed there before.
- **A deleted note leaves "Zuletzt" and the folder counts with it.** The tree stopped drawing it at once and the lists two sections above did not, which is the same lag in a second place. Every list the pane draws now agrees about a file that has just gone, the badge on a closed folder included.
- **An AI rename works on a GIF.** The canvas was asked to encode one and cannot: it quietly writes PNG for any type it does not know, so the picture went to the model declared as a GIF, and the request was refused for a mismatch that had nothing to do with the picture. What comes back is now declared as what it is — re-encoded as PNG, and called PNG.
- **The review cards speak the set language.** The two lines a sync card carries — that a note was edited locally, and that this is its first comparison with a source — were German in the code, the last of them to be.
- **A redraw held back by a drag cannot be held for ever.** Redraws wait for a drag to finish so the row being carried is not thrown away mid-gesture. If the flag that says a drag is in progress were ever left standing, every later redraw waited on it and the pane stopped answering. It is now held for at most five seconds — longer than any gesture, shorter than anything worth calling a freeze.
- **The context menu stays open again, so a file can be deleted.** 1.19.0 let a finger drag a row, and the press that arms that drag is the same press that opens the menu. What it inherited was the mouse's idea of when a press becomes a drag: four pixels. A finger resting on glass moves further than that, and rolls further still as it lifts — so the menu opened and was taken away again by the drag starting, before anything on it could be tapped. Deleting, renaming, moving and every other action behind that menu became unreachable on a phone. A finger now has to travel sixteen pixels, more than half a row, before the drag takes over: a hand on its way somewhere rather than a hand staying put. A mouse is unchanged at four.

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
