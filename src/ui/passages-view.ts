/**
 * A layout for Bases: the callouts and highlights of the notes a base lists.
 *
 * Obsidian's own layouts show a note's properties, and a callout or a
 * `==highlight==` is in its text. Here every callout is a card of its own and
 * a note's highlights are one card, each drawn by Obsidian's renderer so the
 * theme's callouts and highlights look as they do in the note. The base
 * still decides which notes, in what order and grouping; the layout's own
 * options say which callout types, whether callouts, highlights or both,
 * and whether a press opens the note for reading. A press opens the note at
 * the passage.
 *
 * It draws. What a passage is and which cards there are is decided in
 * `services/passages`; the vault is asked through the controller.
 */
import { BasesView, Component, Keymap, type QueryController, type TFile } from "obsidian";
import { t } from "../i18n";
import { openTargetOf, type PaneTarget } from "../services/pane-target";
import {
  MAX_PASSAGE_CARDS,
  MAX_PASSAGE_NOTES,
  opensPassageForReading,
  PASSAGE_OPTION,
  PASSAGES_ROOT_CLASS,
  passageCards,
  readPassageOptions,
  type NotePassages,
  type PassageCard
} from "../services/passages";
import { pressedCalloutFold } from "../services/workspace-internals";
import { pressKeys } from "./pressable";

export const PASSAGES_VIEW_TYPE = "schreibstube-passages";

/** How many notes are read at once: enough to overlap the reads, few enough for a phone. */
const READ_AT_ONCE = 16;

export interface PassagesHost {
  passages(file: TFile): Promise<NotePassages | null>;
  open(file: TFile, line: number, where: PaneTarget, reading: boolean): Promise<void>;
  render(markdown: string, el: HTMLElement, sourcePath: string, owner: Component): Promise<void>;
}

export class PassagesView extends BasesView {
  readonly type = PASSAGES_VIEW_TYPE;
  /** Ours, inside the container Bases hands over: switching to another
   *  layout takes this away and leaves the container as it was. */
  private readonly root: HTMLElement;
  /** Bumped by every drawing; a drawing whose notes came back late gives way. */
  private generation = 0;
  /** What the last drawing rendered hangs off this, and goes with it. */
  private drawing: Component | null = null;

  constructor(
    controller: QueryController,
    parentEl: HTMLElement,
    private readonly host: PassagesHost
  ) {
    super(controller);
    this.root = parentEl.createDiv({ cls: PASSAGES_ROOT_CLASS });
  }

  override onunload(): void {
    this.generation += 1;
    this.drawing?.unload();
    this.drawing = null;
    this.root.detach();
  }

  onDataUpdated(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const generation = ++this.generation;
    const words = t().passages;
    const options = readPassageOptions(
      this.config.get(PASSAGE_OPTION.types),
      this.config.get(PASSAGE_OPTION.show)
    );

    // The notes are taken in the base's order, so the limit keeps the first,
    // and read a few at a time rather than one after another.
    let taken = 0;
    let unread = 0;
    const wanted = this.data.groupedData.map((group) => {
      const files: TFile[] = [];
      for (const entry of group.entries) {
        if (entry.file.extension !== "md") continue;
        if (taken >= MAX_PASSAGE_NOTES) unread += 1;
        else {
          taken += 1;
          files.push(entry.file);
        }
      }
      return { label: group.hasKey() ? (group.key?.toString() ?? "") : null, files };
    });
    const read = new Map<string, NotePassages | null>();
    const all = wanted.flatMap((group) => group.files);
    for (let at = 0; at < all.length; at += READ_AT_ONCE) {
      const batch = all.slice(at, at + READ_AT_ONCE);
      const answers = await Promise.all(batch.map((file) => this.host.passages(file)));
      if (generation !== this.generation) return;
      batch.forEach((file, index) => read.set(file.path, answers[index] ?? null));
    }
    const groups = wanted.map((group) => ({
      label: group.label,
      notes: group.files.flatMap((file) => {
        const passages = read.get(file.path);
        return passages ? [{ file, passages }] : [];
      })
    }));

    const drawing = new Component();
    drawing.load();
    this.drawing?.unload();
    this.drawing = drawing;
    this.root.empty();

    let room = MAX_PASSAGE_CARDS;
    let held = 0;
    let drawn = 0;
    for (const group of groups) {
      const files = new Map(group.notes.map((note) => [note.file.path, note.file]));
      const result = passageCards(
        group.notes.map((note) => ({ path: note.file.path, passages: note.passages })),
        options,
        room
      );
      room -= result.cards.length;
      held += result.held;
      if (result.cards.length === 0) continue;
      if (group.label !== null) {
        this.root.createDiv({ cls: "schreibstube-passages-group", text: group.label });
      }
      const list = this.root.createDiv({ cls: "schreibstube-passages-list" });
      for (const card of result.cards) {
        const file = files.get(card.path);
        if (file) this.renderCard(list, card, file, drawing);
        drawn += 1;
      }
    }

    if (drawn === 0) this.note(words.empty);
    if (held > 0) this.note(words.moreCards(held));
    if (unread > 0) this.note(words.moreNotes(unread));
  }

  private note(text: string): void {
    this.root.createDiv({ cls: "schreibstube-passages-note", text });
  }

  private renderCard(list: HTMLElement, card: PassageCard, file: TFile, owner: Component): void {
    const el = list.createDiv({ cls: `schreibstube-passage-card is-${card.kind}` });
    if (card.kind === "callout") {
      const body = this.body(el, card.callout.markdown, file, owner);
      this.pressable(body, file, card.callout.line);
    } else {
      for (const line of card.lines) {
        const body = this.body(el, line.markdown, file, owner);
        body.addClass("schreibstube-passage-line");
        this.pressable(body, file, line.line);
      }
    }
    const source = el.createDiv({ cls: "schreibstube-passage-source", text: file.basename });
    this.pressable(
      source,
      file,
      card.kind === "callout" ? card.callout.line : (card.lines[0]?.line ?? 0)
    );
  }

  /** A passage drawn as the note draws it, by Obsidian's renderer, in the theme's styles. */
  private body(el: HTMLElement, markdown: string, file: TFile, owner: Component): HTMLElement {
    const body = el.createDiv({ cls: "schreibstube-passage-body markdown-rendered" });
    // A passage the renderer could not draw still shows what it says.
    this.host.render(markdown, body, file.path, owner).catch(() => body.setText(markdown));
    return body;
  }

  /**
   * A press on a passage opens its note at the passage. A link inside it
   * opens the note too, rather than leaving the base for wherever it points,
   * and the title of a foldable callout folds it, as it does in the note.
   */
  private pressable(el: HTMLElement, file: TFile, line: number): void {
    el.setAttr("role", "button");
    el.setAttr("tabindex", "0");
    el.setAttr("aria-label", t().passages.open(file.basename));
    el.addEventListener("click", (event) => {
      if (pressedCalloutFold(event.target)) return;
      event.preventDefault();
      this.open(file, line, event);
    });
    pressKeys(el, (event) => this.open(file, line, event));
  }

  private open(file: TFile, line: number, event: MouseEvent | KeyboardEvent): void {
    const reading = opensPassageForReading(this.config.get(PASSAGE_OPTION.readingView));
    void this.host.open(file, line, openTargetOf(Keymap.isModEvent(event)), reading);
  }
}
