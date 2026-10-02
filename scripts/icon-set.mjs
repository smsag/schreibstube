/**
 * Which icons the plugin ships.
 *
 * Tabler has some five thousand glyphs and the plugin can afford a few hundred:
 * the release is one `main.js`, so the font travels base64-encoded inside the
 * bundle and every glyph is paid for by every user on every load. The list is
 * therefore curated rather than complete, and grouped the way the picker shows
 * it — a person looking for a folder icon should not scroll past two hundred
 * brand logos to find one.
 *
 * Adding a name here and running `npm run build:icons` is the whole process.
 * An unknown name fails the build rather than shipping an empty square.
 *
 * Removing one is not symmetrical, and is a decision rather than an edit. What
 * a vault stores is the name, so a folder already marked with a name that
 * leaves this list loses its mark: `applyIcon` draws nothing for a glyph the
 * font does not have, and only the interface's own actions pass a
 * `fallbackIcon`. Property keys fare better — `propertyIconCss` writes no rule
 * for an unknown name, so the key keeps Obsidian's type icon. The blank is
 * accepted: it is visible, it points at the one folder it affects, and picking
 * again is the whole repair.
 */

/**
 * Glyphs Tabler does not have, drawn from our own artwork.
 *
 * Each source follows Tabler's rules — the 24-unit grid, a 2-unit stroke,
 * round caps and joins, `currentColor` — so it can sit in a row of Tabler
 * glyphs without reading as a guest. The build outlines the strokes and adds
 * the result to the font; a name here still has to appear in a group or in
 * `UI_ICONS` to be shipped at all. A name Tabler also uses fails the build,
 * since two glyphs under one name would leave which one a vault gets to chance.
 */
export const CUSTOM_ICONS = [
  { name: "schreibstube", source: "assets/logo.svg" },
  { name: "pythia", source: "assets/icons/pythia.svg" }
];

/** Glyphs the interface itself needs, whether or not a user can pick them. */
export const UI_ICONS = [
  "chevron-right",
  // The slideshow's previous-image control, the twin of the row chevron.
  "chevron-left",
  // The slideshow's fullscreen control.
  "arrows-maximize",
  "chevron-down",
  // The pinned block's own control, which points the way it will move the list.
  "chevron-up",
  // The one control over the whole tree: the row twisty doubled, so opening
  // and closing everything reads as more of what opening one folder does.
  "chevrons-down",
  "chevrons-up",
  "folder",
  "folder-open",
  "file-text",
  "pin",
  "pinned",
  "pinned-off",
  "cloud-check",
  "cloud-download",
  "cloud-off",
  // The file pane's mark for a note marked for publication: a globe, so it
  // cannot be read as one of the cloud marks for sync beside it.
  "world-upload",
  "alert-triangle",
  "refresh",
  "search",
  "x",
  "plus",
  "dots",
  "photo",
  "photo-off",
  // The file pane's own marks for a PDF, an Excalidraw drawing and a base.
  "file-type-pdf",
  "scribble",
  "table",
  "link",
  "link-off",
  "pencil",
  "trash",
  "external-link"
];

/**
 * The picker, in the order it is shown. Group ids are translated in `i18n`; a
 * new group needs an entry in both catalogues, or `src/i18n/index.test.ts`
 * fails — the picker itself would quietly show the id.
 *
 * The writing groups come first, after documents and folders, because the
 * plugin is for writing; the domains it grew up beside follow.
 */
export const ICON_GROUPS = [
  {
    id: "documents",
    icons: [
      "file-text",
      "file",
      "files",
      "file-description",
      "file-plus",
      "file-check",
      "file-search",
      "file-pencil",
      "file-star",
      "notes",
      "notebook",
      "book",
      "books",
      "bookmark",
      "bookmarks",
      // The marks of the craft itself: a quill for a draft, a signed sheet for
      // a finished one, and the pens in between.
      "feather",
      "writing-sign",
      "writing",
      "ballpen",
      "pencil",
      "eraser",
      "highlight",
      // What a manuscript is made of, as against what it is about.
      "typography",
      "quote",
      "markdown",
      "versions",
      "sitemap",
      "article",
      "clipboard-text",
      "checklist",
      "list",
      "list-numbers",
      "list-details",
      "template",
      "language",
      "vocabulary",
      "paperclip",
      "printer",
      "mail",
      "mailbox",
      "news"
    ]
  },
  {
    id: "folders",
    icons: [
      "folder",
      "folder-open",
      "folder-star",
      "folder-share",
      // A folder that says what state it is in carries one mark where a plain
      // folder and a status icon would need two, and the tree has room for one.
      "folder-check",
      "folder-x",
      "folder-plus",
      "folder-question",
      "folder-exclamation",
      "folder-heart",
      "folder-pin",
      "folder-bolt",
      "folder-pause",
      "folder-cog",
      "folder-code",
      "folder-search",
      "folder-root",
      "folders",
      "archive",
      "box",
      "box-multiple",
      "packages",
      "briefcase",
      "briefcase-2",
      "backpack",
      "basket",
      "stack-2",
      "stack-3",
      "layout-grid",
      "inbox",
      "database"
    ]
  },
  {
    id: "revision",
    icons: [
      // A draft that forks into a second version and comes back together.
      "git-branch",
      "git-merge",
      "git-compare",
      "file-diff",
      "scissors",
      "copy",
      "replace",
      "arrows-shuffle",
      // What a pass over the text found, or still has to look at.
      "text-spellcheck",
      "text-grammar",
      "pencil-check",
      "pencil-question",
      "eye-check",
      "list-check",
      "message-2-question",
      "pilcrow",
      "section-sign",
      "letter-case",
      "heading",
      "page-break"
    ]
  },
  {
    id: "markers",
    icons: [
      // One frame for digits and letters, so Part 2 and Appendix B read as
      // members of the same series. A circle, because a circled figure is the
      // typographer's own ordinal mark.
      "circle-number-0",
      "circle-number-1",
      "circle-number-2",
      "circle-number-3",
      "circle-number-4",
      "circle-number-5",
      "circle-number-6",
      "circle-number-7",
      "circle-number-8",
      "circle-number-9",
      "circle-letter-a",
      "circle-letter-b",
      "circle-letter-c",
      "circle-letter-d",
      "circle-letter-e",
      "circle-letter-f",
      "circle-letter-g",
      "circle-letter-h",
      "circle-letter-i",
      "circle-letter-j",
      "circle-letter-k",
      "circle-letter-l",
      "circle-letter-m",
      "circle-letter-n",
      "circle-letter-o",
      "circle-letter-p",
      "circle-letter-q",
      "circle-letter-r",
      "circle-letter-s",
      "circle-letter-t",
      "circle-letter-u",
      "circle-letter-v",
      "circle-letter-w",
      "circle-letter-x",
      "circle-letter-y",
      "circle-letter-z",
      // Shapes mean nothing on their own, which is the point: a mark that only
      // has to tell two things apart should not also claim to say what they are.
      "circle",
      "square",
      "square-rounded",
      "square-dot",
      "triangle",
      "triangle-inverted",
      "diamond",
      "pentagon",
      "hexagon",
      "octagon",
      "oval",
      "point",
      "asterisk",
      "spiral"
    ]
  },
  {
    id: "story",
    icons: [
      // Who someone is in the story, before what they are called.
      "crown",
      "masks-theater",
      "chess-king",
      "chess-queen",
      "chess-knight",
      "chess-rook",
      "man",
      "woman",
      "old",
      "baby-carriage",
      "friends",
      "user-heart",
      "user-question",
      "spy",
      // What goes wrong, and what is not of this world.
      "sword",
      "swords",
      "bomb",
      "skull",
      "fingerprint",
      "spider",
      "wand",
      "crystal-ball",
      "ghost",
      "dragon",
      "route"
    ]
  },
  {
    id: "moods",
    icons: [
      // How a draft reads on the day, or how a character stands in a scene:
      // worth recording, and not the same as how far along either is.
      "mood-happy",
      "mood-smile",
      "mood-smile-beam",
      "mood-crazy-happy",
      "mood-wink",
      "mood-heart",
      "mood-surprised",
      "mood-neutral",
      "mood-confused",
      "mood-puzzled",
      "mood-nervous",
      "mood-unamused",
      "mood-empty",
      "mood-silence",
      "mood-sad",
      "mood-cry",
      "mood-angry",
      "mood-annoyed",
      "mood-sick",
      "mood-nerd",
      "mood-spark",
      "heart",
      "hearts",
      "heart-broken"
    ]
  },
  {
    id: "places",
    icons: [
      "mountain",
      "volcano",
      "beach",
      "ripple",
      "building-lighthouse",
      "building-bridge",
      "building-monument",
      "pyramid",
      "tent",
      "campfire",
      "world",
      "world-pin",
      "map-route",
      "car",
      "bus",
      "train",
      "plane",
      "ship",
      "sailboat",
      "bike",
      "walk",
      "trekking",
      "luggage",
      // A scene's hour and weather, which the prose has to keep straight from
      // one chapter to the next.
      "sun",
      "sunrise",
      "sunset",
      "moon",
      "moon-stars",
      "cloud-rain",
      "cloud-snow",
      "cloud-storm",
      "cloud-fog",
      "wind",
      "snowflake",
      "umbrella",
      "leaf",
      "flower",
      "seedling",
      "cat",
      "dog",
      "horse",
      "fish",
      "butterfly"
    ]
  },
  {
    id: "research",
    icons: [
      "school",
      "chalkboard",
      "library",
      "book-2",
      "microscope",
      "flask",
      "atom",
      "dna",
      "telescope",
      "math",
      "brain",
      "stethoscope",
      "heartbeat",
      "timeline-event",
      "globe",
      "hierarchy",
      // A question still open, kept apart from the answers already found.
      "zoom-question",
      "world-search",
      "report-search",
      "list-search"
    ]
  },
  {
    id: "media",
    icons: [
      // A text that is read aloud, filmed or put online, as against printed:
      // the printer stays with documents.
      "microphone",
      "headphones",
      "radio",
      "device-audio-tape",
      "speakerphone",
      "playlist",
      "music",
      "photo",
      "camera",
      "movie",
      "video",
      "player-play",
      "player-record",
      "theater",
      "slideshow",
      "rss",
      "broadcast",
      "world-www",
      "world-share",
      "qrcode",
      "book-upload",
      "book-download",
      "file-export",
      "device-tablet"
    ]
  },
  {
    id: "property",
    icons: [
      "home",
      "home-2",
      "home-plus",
      "home-check",
      "home-search",
      "home-edit",
      "home-eco",
      "building",
      "building-community",
      "building-estate",
      "building-skyscraper",
      "building-store",
      "building-warehouse",
      "building-factory",
      "building-bank",
      "building-cottage",
      "building-castle",
      "building-church",
      "building-hospital",
      // The parts of a building a listing actually names.
      "door",
      "window",
      "wall",
      "stairs",
      "elevator",
      "key",
      "bed",
      "bath",
      "sofa",
      "armchair",
      "lamp",
      // What a survey measures and what a viewing asks after.
      "ruler",
      "ruler-measure",
      "dimensions",
      "compass",
      "map",
      "map-2",
      "map-pin",
      "road",
      "parking",
      // Services, and the works that put them there.
      "droplet",
      "plug",
      "air-conditioning",
      "solar-panel",
      "crane",
      "hammer",
      "bulldozer",
      "paint",
      "tree",
      "trees",
      "fence",
      "garden-cart"
    ]
  },
  {
    id: "business",
    icons: [
      "users",
      "user",
      "users-group",
      "user-plus",
      "user-check",
      "user-search",
      "address-book",
      "id",
      "phone",
      "device-mobile",
      "calendar",
      "calendar-event",
      "calendar-week",
      "calendar-due",
      "calendar-month",
      "calendar-check",
      "calendar-time",
      "clock",
      "alarm",
      "timeline",
      "businessplan",
      "heart-handshake",
      "contract",
      "license",
      "file-certificate",
      "file-analytics",
      "signature",
      "rubber-stamp",
      "scale",
      "gavel",
      "target",
      "presentation",
      "ticket"
    ]
  },
  {
    id: "finance",
    icons: [
      // Money as it is held and moved.
      "coin-euro",
      "coins",
      "cash",
      "cash-banknote",
      "currency-euro",
      "currency-dollar",
      "currency-pound",
      "currency-frank",
      "currency-bitcoin",
      "moneybag",
      "wallet",
      "pig-money",
      "credit-card",
      "credit-card-pay",
      "cash-move",
      "transfer",
      // What the books and the tax office ask for.
      "calculator",
      "abacus",
      "percentage",
      "sum",
      "receipt",
      "receipt-euro",
      "receipt-tax",
      "receipt-refund",
      "file-invoice",
      "file-euro",
      "file-spreadsheet",
      "report-money",
      "tax",
      // Markets and the figures that describe them.
      "chart-bar",
      "chart-line",
      "chart-pie",
      "chart-donut",
      "chart-histogram",
      "chart-area-line",
      "chart-candle",
      "chart-arrows-vertical",
      "trending-up",
      "report-analytics",
      "presentation-analytics",
      "zoom-money",
      // Trade, and what is insured against it.
      "shopping-cart",
      "cash-register",
      "discount",
      "gift-card",
      "shield-dollar",
      "home-dollar",
      "world-dollar"
    ]
  },
  {
    id: "status",
    icons: [
      "star",
      "flag",
      "pin",
      "pinned",
      "alert-triangle",
      "alert-circle",
      "circle-check",
      "circle-x",
      "square-check",
      // A piece of work has stages before it is done or not done: untouched,
      // part-way, resting.
      "circle-dot",
      "circle-half",
      "circle-dashed",
      "progress",
      "player-pause",
      "zzz",
      "hourglass",
      "exclamation-mark",
      "question-mark",
      "bolt",
      "flame",
      "rocket",
      "bulb",
      "eye",
      "lock",
      "lock-open",
      "shield",
      "shield-check",
      "ban",
      "help",
      "info-circle",
      // A verdict on a draft, which is not the same as how far along it is.
      "thumb-up",
      "thumb-down",
      "trending-down"
    ]
  },
  {
    id: "logos",
    icons: ["schreibstube", "pythia"]
  },
  {
    id: "misc",
    icons: [
      "tag",
      "hash",
      "search",
      "filter",
      "link",
      "cloud",
      "code",
      "settings",
      "tools",
      "palette",
      "sparkles",
      "certificate",
      "message",
      "messages",
      "send",
      "history",
      "share"
    ]
  }
];
