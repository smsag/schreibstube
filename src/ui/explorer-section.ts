/**
 * A section of the file pane: a header that toggles, and a body that is simply
 * not drawn while the section is closed. Keeping the rows out of the document
 * rather than hiding them is what keeps a vault of thousands of notes cheap to
 * redraw.
 *
 * This module draws the header and wires its controls. What a section holds,
 * and whether it is closed, is the view's to say.
 */
import { setIcon } from "obsidian";
import { t } from "../i18n";
import { folderCountLabel } from "../services/folder-count";
import { applyIcon } from "./icon-font";

export type SectionId = "pinned" | "bookmarks" | "latest" | "files";

/** A control a header carries at its far end, past the rule. */
export interface SectionAction {
  /** A name in the bundled set, which is what the rest of the pane draws with. */
  icon: string;
  /** Obsidian's own name for the same thing, drawn if the set has not got it. */
  fallbackIcon: string;
  /** Named for a screen reader and on hover, because the icon alone is a guess. */
  label: string;
  /**
   * Set only by a control that opens and closes its own section.
   *
   * The pinned block's chevron is the one: its section has none in the twisty
   * slot, so this control is where a state that would have been said there has
   * to be said instead.
   */
  expanded?: boolean;
  run: () => void;
}

/** A mark on a section's icon, and what a tap on the mark does. */
export interface SectionAlert {
  label: string;
  acknowledge: () => void;
}

/** What a section wants from its header beyond a title and a chevron. */
export interface SectionOptions {
  /** Draw the body even while closed, for a section that keeps some of it. */
  keepBodyWhenClosed?: boolean;
  /** How many rows the section holds in all, named on the header while closed. */
  total?: number;
  /** False when there is nothing behind the chevron, so it is not drawn. */
  closable?: boolean;
  /** Drawn open whatever was remembered, for as long as a filter is set. */
  forceOpen?: boolean;
  /** A control of the section's own, drawn at the far end of the header. */
  action?: SectionAction;
  /** A mark on the section's icon that something came in while nobody looked. */
  alert?: SectionAlert;
  /**
   * False for a section whose chevron is drawn at the other end of the header.
   *
   * The slot itself stays, empty: every icon in the pane lines up on it, and a
   * header that dropped it would sit a chevron's width left of its own rows.
   */
  twisty?: boolean;
}

export interface SectionSpec {
  id: SectionId;
  icon: string;
  /** Decided by the view from what it remembers and what a filter forces. */
  collapsed: boolean;
  options: SectionOptions;
  /** Open a closed section, close an open one. */
  toggle: () => void;
  /** Take the mark down and open the section. */
  acknowledge: (alert: SectionAlert) => void;
}

/** Returns the body to draw into, or null when the section is closed. */
export function renderSection(host: HTMLElement, spec: SectionSpec): HTMLElement | null {
  const { id, icon, collapsed, options } = spec;
  const section = host.createDiv({ cls: "schreibstube-explorer-section" });
  // Nothing behind the chevron is nothing to click: a section that hides
  // nothing while closed must not offer to open.
  const closable = options.closable ?? true;

  // "Files and folders" is drawn as a band across the pane, because it is the
  // one header that separates two kinds of thing: the three curated lists
  // above it and the vault itself below.
  //
  // A div and not a button, though it behaves as one. A button carries every
  // theme's idea of what a button looks like — a fill, a hover fill, a
  // pressed fill — and a header that lit up grey under the finger that had
  // just opened it, and stayed lit, was that idea arriving where it was not
  // wanted. A row in this pane is drawn by this pane. It also stops a control
  // of the section's own from being a button inside a button.
  const header = section.createDiv({
    cls:
      `schreibstube-explorer-section-header` +
      `${id === "files" ? " is-divider" : ""}${closable ? " is-clickable" : ""}`
  });

  // The band is pressable and does not say it is a button, because the things
  // standing on it are. A button's children are not read out — that is what
  // the role means — so a header calling itself one would have taken the
  // chevron beside it and the mark on its icon down with it, which is the
  // same silence moving one level up. The chevron carries the role instead,
  // and a pointer still has the whole band.
  const twisty = header.createSpan({ cls: "schreibstube-explorer-twisty" });
  if (closable && options.twisty !== false) {
    applyIcon(twisty, collapsed ? "chevron-right" : "chevron-down");
    wireSectionToggle(twisty, collapsed, t().explorer.sections[id], spec.toggle);
  }

  // How many there are in all, on the section's own icon: a closed section
  // showing rows does not look closed, and the rows on screen are not the
  // whole of it. The same badge a closed folder carries, in the same place,
  // because it answers the same question.
  const glyph = header.createSpan({ cls: "schreibstube-explorer-glyph-box" });
  applyIcon(glyph.createSpan({ cls: "schreibstube-explorer-glyph" }), icon);

  const total = collapsed ? folderCountLabel(options.total ?? 0) : null;
  // News first: a figure says how much is there and the mark says that some of
  // it is new, and one corner of one icon can only carry the more urgent of
  // the two. No section asks for both today.
  if (options.alert) {
    renderSectionAlert(glyph, options.alert, spec.acknowledge);
  } else if (total !== null) {
    glyph.createSpan({ cls: "schreibstube-explorer-count", text: total });
  }

  header.createSpan({
    cls: "schreibstube-explorer-section-title",
    text: t().explorer.sections[id]
  });

  if (options.action) renderSectionAction(header, options.action);

  // With a mark on it the whole band is the way to take it down — the chevron
  // excepted, which stops the press at itself and goes on opening and closing
  // the section. Without a mark the band is the toggle it always was.
  const alert = options.alert;
  if (alert) {
    header.addEventListener("click", () => spec.acknowledge(alert));
  } else if (closable) {
    header.addEventListener("click", () => spec.toggle());
  }

  const body = section.createDiv({ cls: "schreibstube-explorer-section-body" });
  if (!collapsed || options.keepBodyWhenClosed) return body;

  body.detach();
  return null;
}

/**
 * The chevron, as the one thing on the band that says what the band does.
 *
 * A pointer has the whole header and always did. This is for everything else:
 * a name, a state, a tab stop, and a key that works — on the element the eye
 * was going to anyway.
 */
function wireSectionToggle(
  twisty: HTMLElement,
  collapsed: boolean,
  label: string,
  toggle: () => void
): void {
  twisty.setAttrs({
    role: "button",
    tabindex: "0",
    "aria-label": label,
    "aria-expanded": String(!collapsed)
  });
  // Drawing an icon marks what it was drawn on as decoration; this one is the
  // control, and a control nothing can read is worse than one nobody can see.
  twisty.removeAttribute("aria-hidden");

  const run = (event: Event): void => {
    // The band under it would otherwise toggle the section a second time,
    // which is the section not moving at all.
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };

  twisty.addEventListener("click", run);
  twisty.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") run(event);
  });
}

/**
 * A control of the section's own, inside the header that opens the section.
 *
 * It has to stop the press reaching that header, or opening every folder in
 * the vault would close the section they are in — the one thing a control put
 * there must not do. Like the header around it, it is drawn rather than being
 * a button: nothing here should arrive wearing a theme's button.
 */
function renderSectionAction(header: HTMLElement, action: SectionAction): void {
  const control = header.createSpan({
    cls: "schreibstube-explorer-section-action",
    attr: {
      role: "button",
      tabindex: "0",
      "aria-label": action.label,
      title: action.label,
      ...(action.expanded === undefined ? {} : { "aria-expanded": String(action.expanded) })
    }
  });

  // The glyph goes in a child of the control, never on the control itself:
  // drawing an icon marks what it is drawn on `aria-hidden`, which is right
  // for the icon and wrong for the labelled, focusable thing carrying it —
  // a control nothing can read is worse than one nobody can see.
  //
  // The bundled font first, as everywhere else in the pane, and Obsidian's
  // own icon if that font has nothing under the name. A control drawn as an
  // empty box is indistinguishable from one that is broken, and this one
  // sits alone at the end of a band with no label beside it to explain it.
  const glyph = control.createSpan();
  if (!applyIcon(glyph, action.icon)) {
    glyph.removeClass("schreibstube-icon");
    setIcon(glyph, action.fallbackIcon);
  }

  const run = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    action.run();
  };

  control.addEventListener("click", run);
  control.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") run(event);
  });
}

/**
 * The mark that something came in, worn where a folder wears its count.
 *
 * A mark and not a figure: how many sources changed is not what a person
 * wants from the corner of an icon, and the list under it says it exactly.
 *
 * It comes down when it is tapped and at no other time — not when the section
 * is merely on screen, which a pane left open all day would do by itself. The
 * tap opens the section with it, so one press both answers the mark and shows
 * what it was about.
 */
function renderSectionAlert(
  glyph: HTMLElement,
  alert: SectionAlert,
  acknowledge: (alert: SectionAlert) => void
): void {
  // A dot, in the colour the interface uses for its own voice. It says one
  // thing — something came in — and a figure or a character beside it would
  // be answering a question nobody asked of a mark this size. The list under
  // the header says which notes, exactly.
  //
  // The band around it is what a finger presses; this is a control as well,
  // so the same thing can be reached by a keyboard.
  const mark = glyph.createSpan({
    cls: "schreibstube-explorer-alert",
    attr: { role: "button", tabindex: "0", "aria-label": alert.label, title: alert.label }
  });

  const run = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    acknowledge(alert);
  };

  mark.addEventListener("click", run);
  mark.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") run(event);
  });
}
