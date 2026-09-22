/**
 * The review sidebar: a queue of proposed changes, each accepted or rejected on
 * its own.
 *
 * The view is deliberately passive. It renders the state it is handed and
 * reports clicks back; every decision about anchoring, applying, and rescanning
 * belongs to the controller. That split is what lets the queue logic be tested
 * without a workspace.
 */

import { t } from "../i18n";
import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { GlossarySelectionSource } from "../services/glossary-resolver";
import { diffParts } from "../services/diff-marks";
import { RenderGate } from "../services/render-gate";
import { isFlagOnly } from "../services/proofread-runner";
import type { Suggestion } from "../services/suggestion";
import { diffWords } from "../services/word-diff";

export const REVIEW_VIEW_TYPE = "schreibstube-review";

export type ReviewPhase = "no-file" | "idle" | "running" | "reviewing";

export interface GlossaryPanelState {
  selected: string[];
  available: { path: string; name: string }[];
  source: GlossarySelectionSource;
  errors: string[];
  missing: string[];
}

export type SyncPanelStatus =
  "none" | "idle" | "checking" | "clean" | "diverged" | "unsynced" | "missing" | "error";

export interface SyncPanelState {
  /** Whether the note carries a source binding at all. */
  bound: boolean;
  status: SyncPanelStatus;
  /** The resolved source URL, or the raw value when it failed validation. */
  source: string;
  /** Epoch milliseconds of the last check, or zero if never. */
  checkedAt: number;
  /** What the note's own interval key says, already said back as a sentence. */
  interval: string;
  message: string;
}

export interface ReviewState {
  phase: ReviewPhase;
  fileName: string;
  suggestions: Suggestion[];
  progress: { completed: number; total: number } | null;
  glossary: GlossaryPanelState;
  sync: SyncPanelState;
  /** A short line under the header: a result summary, or why nothing happened. */
  message: string;
}

export interface ReviewHandlers {
  onProofread(): void;
  onGlossaryCheck(): void;
  onStop(): void;
  onAcceptAll(): void;
  onAccept(id: string): void;
  onReject(id: string): void;
  onReveal(id: string): void;
  onToggleGlossary(path: string): void;
  onCheckSource(): void;
}

export const EMPTY_REVIEW_STATE: ReviewState = {
  phase: "no-file",
  fileName: "",
  suggestions: [],
  progress: null,
  glossary: { selected: [], available: [], source: "none", errors: [], missing: [] },
  sync: { bound: false, status: "none", source: "", checkedAt: 0, interval: "", message: "" },
  message: ""
};

export class ReviewPanelView extends ItemView {
  private state: ReviewState = EMPTY_REVIEW_STATE;
  private handlers: ReviewHandlers | null = null;
  private readonly gate = new RenderGate<ReviewState>();
  private heldRedraw = 0;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return REVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t().proofread.panelTitle;
  }

  override getIcon(): string {
    return "spell-check";
  }

  setHandlers(handlers: ReviewHandlers): void {
    this.handlers = handlers;
  }

  /** Named apart from ItemView's own `setState`, which persists view state and
   *  takes a different shape. */
  updateReviewState(state: ReviewState): void {
    this.state = state;
    // Not while a finger is down on this panel: a redraw would destroy the
    // button under it and put an identical one in its place, and the press
    // and the release would land on two different elements (render-gate.ts).
    const draw = this.gate.request(state);
    if (draw !== null) this.render();
  }

  override async onOpen(): Promise<void> {
    // The listeners go on contentEl, which render() empties but never
    // replaces, so they outlive every redraw. The release is watched on the
    // document: a finger that leaves the panel before lifting must still open
    // the gate, or the panel would stop redrawing altogether.
    // A tap starts here and is not over until the browser has delivered its
    // click. Measured in Obsidian: a redraw scheduled from `pointerup` runs
    // BEFORE that click and loses it — the same bug, three milliseconds wide.
    this.registerDomEvent(this.contentEl, "pointerdown", () => {
      this.gate.hold();
      window.clearTimeout(this.heldRedraw);
      // A gesture that never becomes a click — a scroll, a finger that slid
      // off the button — still has to open the gate, or the panel would stop
      // redrawing until the next tap.
      this.heldRedraw = window.setTimeout(() => this.drawHeld(), 400);
    });
    // Zero, not immediately: this runs in the click's own task, so the
    // button's handler has already had the event and the element it is
    // standing on survives until then.
    this.registerDomEvent(this.contentEl, "click", () => {
      window.clearTimeout(this.heldRedraw);
      this.heldRedraw = window.setTimeout(() => this.drawHeld(), 0);
    });
    this.render();
  }

  override async onClose(): Promise<void> {
    window.clearTimeout(this.heldRedraw);
    this.contentEl.empty();
  }

  /** Draw whatever the gate held back while a tap was in progress. */
  private drawHeld(): void {
    window.clearTimeout(this.heldRedraw);
    if (this.gate.release() !== null) this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("schreibstube-review");

    this.renderHeader(root);
    this.renderSync(root);
    this.renderGlossary(root);

    if (this.state.message) {
      root.createDiv({ cls: "schreibstube-review-message", text: this.state.message });
    }

    for (const error of this.state.glossary.errors) {
      root.createDiv({ cls: "schreibstube-review-warning", text: error });
    }
    for (const missing of this.state.glossary.missing) {
      root.createDiv({
        cls: "schreibstube-review-warning",
        text: t().proofread.panelGlossaryMissing(missing)
      });
    }

    this.renderQueue(root);
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "schreibstube-review-header" });

    header.createDiv({
      cls: "schreibstube-review-file",
      text: this.state.fileName || t().proofread.panelNoNote
    });

    const actions = header.createDiv({ cls: "schreibstube-review-actions" });
    const running = this.state.phase === "running";
    const hasFile = this.state.phase !== "no-file";

    this.button(
      actions,
      t().proofread.panelProofread,
      // Not the view's own `spell-check`: that glyph is the panel's identity
      // on its leaf tab, and the same mark on a button inside it would mean two
      // things at once. `scan-text` is the act, not the place.
      "scan-text",
      !hasFile || running,
      () => this.handlers?.onProofread(),
      "primary"
    );
    this.button(
      actions,
      t().proofread.panelGlossaryCheck,
      "book-a",
      !hasFile || running,
      () => this.handlers?.onGlossaryCheck(),
      "secondary"
    );

    if (running) {
      this.button(
        actions,
        t().proofread.panelStop,
        "circle-stop",
        false,
        () => this.handlers?.onStop(),
        "destructive"
      );
    }

    const pending = this.pendingSuggestions();
    const applicable = pending.filter((suggestion) => !isFlagOnly(suggestion));
    if (applicable.length > 0) {
      this.button(
        actions,
        t().proofread.acceptAll(applicable.length),
        "list-checks",
        false,
        () => this.handlers?.onAcceptAll(),
        "primary"
      );
    }

    if (this.state.progress) {
      const { completed, total } = this.state.progress;
      header.createDiv({
        cls: "schreibstube-review-progress",
        text: t().proofread.panelSection(completed, total)
      });
    }
  }

  /** Shown only for a note bound to a source, so an ordinary note is unchanged. */
  private renderSync(root: HTMLElement): void {
    const sync = this.state.sync;
    if (!sync.bound) return;

    const section = root.createDiv({ cls: "schreibstube-review-sync" });

    const row = section.createDiv({ cls: "schreibstube-review-sync-row" });
    row.createSpan({
      cls: "schreibstube-review-glossary-label",
      text: t().proofread.panelSource(t().proofread.syncStatus[sync.status] ?? sync.status)
    });
    this.button(row, t().proofread.panelCheckSource, "refresh-cw", sync.status === "checking", () =>
      this.handlers?.onCheckSource()
    );

    if (sync.source) {
      section.createDiv({ cls: "schreibstube-review-hint", text: sync.source });
    }
    // What the note asked for, said back as cron: a person who wrote "Alle 2
    // Tage" can see here that it was understood, and as what.
    if (sync.interval) {
      section.createDiv({ cls: "schreibstube-review-hint", text: sync.interval });
    }

    if (sync.checkedAt > 0) {
      section.createDiv({
        cls: "schreibstube-review-hint",
        text: t().proofread.panelCheckedAt(new Date(sync.checkedAt).toLocaleString())
      });
    }
    if (sync.message) {
      const cls =
        sync.status === "missing" || sync.status === "error"
          ? "schreibstube-review-warning"
          : "schreibstube-review-hint";
      section.createDiv({ cls, text: sync.message });
    }
  }

  private renderGlossary(root: HTMLElement): void {
    const { selected, available, source } = this.state.glossary;
    const section = root.createDiv({ cls: "schreibstube-review-glossary" });

    section.createSpan({
      cls: "schreibstube-review-glossary-label",
      text: t().proofread.panelGlossary(t().proofread.glossarySource[source] ?? source)
    });

    if (available.length === 0) {
      section.createSpan({
        cls: "schreibstube-review-hint",
        text: t().proofread.panelNoGlossary
      });
      return;
    }

    const chips = section.createDiv({ cls: "schreibstube-review-chips" });
    // Frontmatter and folder rules are the note's own answer, so the chips show
    // what applies but do not pretend a click here would override it.
    const locked = source === "frontmatter" || source === "folder";

    for (const candidate of available) {
      const active = selected.includes(candidate.path);
      const chip = chips.createEl("button", {
        cls: `sb sb-seg schreibstube-review-chip${active ? " active" : ""}`,
        text: candidate.name
      });
      chip.setAttr("title", candidate.path);
      if (locked) {
        chip.setAttr("disabled", "true");
        chip.addClass("is-locked");
        continue;
      }
      chip.addEventListener("click", () => this.handlers?.onToggleGlossary(candidate.path));
    }
  }

  private renderQueue(root: HTMLElement): void {
    const pending = this.pendingSuggestions();

    if (pending.length === 0) {
      root.createDiv({
        cls: "schreibstube-review-empty",
        text: this.state.phase === "running" ? t().proofread.panelRunning : t().proofread.panelIdle
      });
      return;
    }

    const list = root.createDiv({ cls: "schreibstube-review-list" });
    for (const suggestion of pending) {
      this.renderCard(list, suggestion);
    }
  }

  private renderCard(list: HTMLElement, suggestion: Suggestion): void {
    const card = list.createDiv({
      cls: `schreibstube-review-card is-${suggestion.severity}${
        suggestion.status === "stale" ? " is-stale" : ""
      }`
    });

    const meta = card.createDiv({ cls: "schreibstube-review-meta" });
    meta.createSpan({
      cls: "schreibstube-review-category",
      text: t().proofread.categories[suggestion.category] ?? suggestion.category
    });
    if (suggestion.source === "glossary") {
      meta.createSpan({ cls: "schreibstube-review-badge", text: t().proofread.badgeGlossary });
    }
    if (suggestion.source === "remote") {
      meta.createSpan({ cls: "schreibstube-review-badge", text: t().proofread.badgeSource });
    }
    if (suggestion.status === "stale") {
      meta.createSpan({ cls: "schreibstube-review-badge", text: t().proofread.badgeStale });
    }
    if (suggestion.needsReview) {
      meta.createSpan({ cls: "schreibstube-review-badge", text: t().proofread.badgeInflection });
    }

    this.renderDiff(card, suggestion);

    if (suggestion.note) {
      card.createDiv({ cls: "schreibstube-review-note", text: suggestion.note });
    }

    const actions = card.createDiv({ cls: "schreibstube-review-card-actions" });
    const stale = suggestion.status === "stale";

    if (!isFlagOnly(suggestion)) {
      this.button(
        actions,
        t().proofread.accept,
        "check",
        stale,
        () => this.handlers?.onAccept(suggestion.id),
        "secondary"
      );
    }
    this.button(actions, t().proofread.reject, "x", false, () =>
      this.handlers?.onReject(suggestion.id)
    );
    this.button(actions, t().proofread.show, "locate", false, () =>
      this.handlers?.onReveal(suggestion.id)
    );
  }

  /** Word-level before and after. A flag-only card has nothing to show on the
   *  right, so it shows the flagged text alone. */
  private renderDiff(card: HTMLElement, suggestion: Suggestion): void {
    const diff = card.createDiv({ cls: "schreibstube-review-diff" });

    if (isFlagOnly(suggestion)) {
      diff.createSpan({ cls: "schreibstube-diff-flag", text: suggestion.original });
      return;
    }

    for (const segment of diffWords(suggestion.original, suggestion.replacement)) {
      if (segment.op === "equal") {
        diff.createSpan({ cls: "schreibstube-diff-equal", text: segment.text });
        continue;
      }
      // A changed segment can run over several lines. The mark lands and lifts
      // on each of them, so a blank line would get a fragment with no text and
      // two paddings — a stub floating between two paragraphs (diff-marks.ts).
      const cls = segment.op === "delete" ? "schreibstube-diff-delete" : "schreibstube-diff-insert";
      for (const part of diffParts(segment.text)) {
        if (part.marked) diff.createSpan({ cls, text: part.text });
        else diff.appendText(part.text);
      }
    }
  }

  private pendingSuggestions(): Suggestion[] {
    return this.state.suggestions.filter(
      (suggestion) => suggestion.status === "pending" || suggestion.status === "stale"
    );
  }

  private button(
    parent: HTMLElement,
    label: string,
    /**
     * A glyph before the label, or `null` for none.
     *
     * This panel is a queue: accept, reject and show repeat once per suggestion
     * card, so the glyph is what the eye lands on and the word only confirms.
     * That is why the buttons here carry one and a conversation's do not. An
     * icon that does no work the word cannot is decoration, and `null` is how
     * a button says so — every glyph in this panel is also distinct, which
     * `src/services/review-icons.test.ts` holds.
     */
    icon: string | null,
    disabled: boolean,
    onClick: () => void,
    /** The look: one of the nine button roles in `styles.css`. */
    role: "primary" | "secondary" | "quiet" | "destructive" = "quiet"
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `sb sb-${role} schreibstube-review-button`
    });
    if (icon !== null) {
      setIcon(button.createSpan({ cls: "schreibstube-review-icon" }), icon);
    }
    button.createSpan({ text: label });

    if (disabled) {
      button.setAttr("disabled", "true");
    } else {
      button.addEventListener("click", onClick);
    }

    return button;
  }
}
