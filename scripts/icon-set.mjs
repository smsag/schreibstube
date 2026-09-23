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
 */

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
 * Names the picker no longer offers, which the font still carries.
 *
 * The stored value is a name, so dropping one from a group would blank the
 * folder of everyone who had already chosen it — `applyIcon` draws nothing for
 * a name it does not know, and only the interface's own actions pass a
 * `fallbackIcon`. Retiring is therefore about what the picker shows, not about
 * what the bundle holds: these cost their bytes so that no vault loses a mark
 * it was given. A name may leave this list once it is safe to assume nobody
 * still points at it.
 */
export const RETIRED_ICONS = [
  "note",
  "book-2",
  "abc",
  "luggage",
  "currency-euro",
  "phone-call",
  "user-circle",
  "shopping-cart",
  "stars",
  "flag-2",
  "clock-hour-4",
  "terminal",
  "tool",
  "message-circle",
  "brush",
  "wand",
  "ship",
  "train",
  "trophy",
  "gift",
  "school",
  "brain",
  "coffee",
  "sun",
  "moon",
  "leaf",
  "atom",
  "microscope",
  "robot"
];

/**
 * The picker, in the order it is shown. Group ids are translated in `i18n`; a
 * new group needs an entry in both catalogues or the build fails on the type.
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
      "archive",
      "box",
      "briefcase",
      "stack-2",
      "layout-grid",
      "inbox",
      "database"
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
      "building",
      "building-community",
      "building-estate",
      "building-skyscraper",
      "building-store",
      "building-warehouse",
      "building-factory",
      "building-bank",
      "building-cottage",
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
      "map",
      "map-2",
      "map-pin",
      "road",
      "parking",
      // Services, and the works that put them there.
      "droplet",
      "plug",
      "crane",
      "hammer",
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
      "address-book",
      "id",
      "phone",
      "device-mobile",
      "calendar",
      "calendar-event",
      "calendar-month",
      "calendar-check",
      "calendar-time",
      "clock",
      "alarm",
      "businessplan",
      "heart-handshake",
      "contract",
      "license",
      "coin-euro",
      "cash",
      "calculator",
      "receipt",
      "receipt-euro",
      "report-money",
      "file-invoice",
      "file-euro",
      "file-certificate",
      "file-analytics",
      "signature",
      "rubber-stamp",
      "scale",
      "gavel",
      "target",
      "chart-bar",
      "chart-line",
      "chart-pie",
      "presentation",
      "trending-up",
      "ticket",
      "wallet",
      "credit-card"
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
      "progress",
      "player-pause",
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
      // How a draft reads on the day, which is worth recording and is not the
      // same as how far along it is.
      "mood-happy",
      "mood-neutral",
      "mood-sad",
      "thumb-up"
    ]
  },
  {
    id: "misc",
    icons: [
      "tag",
      "hash",
      "search",
      "filter",
      "link",
      "world",
      "cloud",
      "photo",
      "camera",
      "movie",
      "music",
      "code",
      "settings",
      "tools",
      "heart",
      "car",
      "plane",
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
