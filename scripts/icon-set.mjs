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
      "notes",
      "note",
      "book",
      "book-2",
      "bookmark",
      "writing",
      "pencil",
      "article",
      "clipboard-text",
      "checklist",
      "list-details",
      "template",
      "quote",
      "abc",
      "language",
      "vocabulary",
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
      "luggage",
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
      "building",
      "building-community",
      "building-estate",
      "building-skyscraper",
      "building-store",
      "building-warehouse",
      "building-factory",
      "building-bank",
      "door",
      "key",
      "bed",
      "sofa",
      "ruler",
      "ruler-measure",
      "map",
      "map-2",
      "map-pin",
      "road",
      "parking",
      "stairs",
      "tree",
      "garden-cart"
    ]
  },
  {
    id: "business",
    icons: [
      "users",
      "user",
      "user-circle",
      "user-plus",
      "address-book",
      "phone",
      "phone-call",
      "device-mobile",
      "calendar",
      "calendar-event",
      "calendar-time",
      "clock",
      "businessplan",
      "coin-euro",
      "currency-euro",
      "receipt",
      "receipt-euro",
      "file-invoice",
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
      "credit-card",
      "shopping-cart"
    ]
  },
  {
    id: "status",
    icons: [
      "star",
      "stars",
      "flag",
      "flag-2",
      "pin",
      "pinned",
      "alert-triangle",
      "alert-circle",
      "circle-check",
      "circle-x",
      "clock-hour-4",
      "hourglass",
      "bolt",
      "flame",
      "rocket",
      "bulb",
      "eye",
      "lock",
      "shield",
      "shield-check",
      "ban",
      "help",
      "info-circle",
      "progress"
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
      "terminal",
      "settings",
      "tool",
      "tools",
      "heart",
      "coffee",
      "plane",
      "car",
      "train",
      "ship",
      "sun",
      "moon",
      "leaf",
      "palette",
      "brush",
      "sparkles",
      "wand",
      "atom",
      "microscope",
      "school",
      "certificate",
      "trophy",
      "gift",
      "robot",
      "brain",
      "message",
      "message-circle",
      "messages",
      "send",
      "history",
      "share"
    ]
  }
];
