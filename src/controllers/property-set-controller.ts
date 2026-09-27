/**
 * Property sets, wired to the vault and to Obsidian's Properties widget.
 *
 * Four ways in, one way to write: the property menu, a control beside
 * "Add property", a feature that finds its keys missing (Mail), and a key
 * just added by hand that belongs to a set. Every one ends in `apply`, which
 * adds only what the note lacks and says what it did. What a set is and what
 * applying it means is decided in `services/property-sets`; this only reads
 * the folder, runs Templater when a set asks for it, and writes.
 */
import { Notice, parseYaml, setIcon, TFile, type App } from "obsidian";
import { t } from "../i18n";
import type { Logger } from "../services/logger";
import {
  applyPlan,
  BUILTIN_SETS,
  frontmatterBlock,
  hasTemplaterCode,
  isFolderSetPath,
  maskTemplaterCode,
  MAX_SET_NOTES,
  newKeys,
  planPropertySet,
  setFromFrontmatter,
  setsToComplete,
  withoutTemplaterCode,
  type PropertyEntry,
  type PropertySet
} from "../services/property-sets";
import {
  addPropertyControls,
  fileShownAround,
  isElementLike,
  propertiesWidgets,
  templaterRenderer
} from "../services/workspace-internals";
import type { SchreibstubeSettings } from "../types";
import { showActionNotice } from "../ui/action-notice";
import { PropertySetPickerModal, type SetChoice } from "../ui/property-set-picker";
import { withTimeout } from "../utils/with-timeout";

const CONTROL_CLASS = "schreibstube-add-set";
/** Long enough to read two lines and reach for the action. */
const OFFER_NOTICE_MS = 12_000;
/** A Templater set may ask the person something (`tp.system.prompt`); this is
 *  the ceiling on that, not on Templater's own work. */
const TEMPLATER_TIMEOUT_MS = 120_000;
/** The widget draws after the note opens; a second look catches a slow one. */
const LATE_DECORATE_MS = 300;

interface FolderSet {
  set: PropertySet;
  file: TFile;
  /** The frontmatter block as written, Templater code included. */
  block: string;
  skipped: string[];
}

type Register = (doc: Document, type: string, handler: (event: Event) => void) => void;

export class PropertySetController {
  private folderSets: { folder: string; sets: FolderSet[] } | null = null;
  private loading: Promise<FolderSet[]> | null = null;
  /** The keys each note had when last seen, to tell which were just added. */
  private readonly keysByPath = new Map<string, string[]>();
  /** One offer per note and set per session: a notice declined is an answer. */
  private readonly offered = new Set<string>();
  private readonly documents = new Set<Document>();
  /** One watch per Properties widget on screen; dropped once it is gone. */
  private readonly watches = new Map<HTMLElement, MutationObserver>();
  private lateTimer = 0;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger
  ) {}

  /** Install on a window: the main one at load, each popped-out one as it opens. */
  attach(win: Window, register: Register): void {
    const doc = win.document;
    this.documents.add(doc);
    register(doc, "click", (event) => this.onControl(event));
    register(doc, "keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") this.onControl(event);
    });
    this.decorate(doc);
  }

  detach(win: Window): void {
    this.documents.delete(win.document);
  }

  stop(): void {
    window.clearTimeout(this.lateTimer);
    for (const observer of this.watches.values()) observer.disconnect();
    this.watches.clear();
    for (const doc of this.documents) {
      for (const control of Array.from(doc.querySelectorAll(`.${CONTROL_CLASS}`))) control.remove();
    }
    this.documents.clear();
  }

  /** Look for Properties widgets again, now and once more when a slow one has drawn. */
  decorateSoon(): void {
    for (const doc of this.documents) this.decorate(doc);
    window.clearTimeout(this.lateTimer);
    this.lateTimer = window.setTimeout(() => {
      for (const doc of this.documents) this.decorate(doc);
    }, LATE_DECORATE_MS);
  }

  /** A note was opened: what it has now is the baseline, not something just added. */
  noteOpened(file: TFile | null): void {
    // The note left behind is no longer watched; its keys would only go stale.
    this.keysByPath.clear();
    if (file) this.keysByPath.set(file.path, this.keysOf(file));
    this.decorateSoon();
  }

  /** A note in the set folder changed, appeared, moved or went. */
  vaultChanged(path: string): void {
    if (isFolderSetPath(path, this.getSettings().propertySetFolder)) this.folderSets = null;
  }

  /**
   * A note's frontmatter changed. When the active note gained a key that
   * belongs to a set it has not finished, offer the rest — once per note and
   * set, and never for a key this controller wrote itself (`apply` moves the
   * baseline before the change arrives).
   */
  noteChanged(file: TFile): void {
    // Only the note in front of the person: a key another plugin writes to a
    // note nobody is looking at is not a key someone just typed, and keeping
    // every changed note's keys would grow with the vault.
    if (this.app.workspace.getActiveFile()?.path !== file.path) return;
    const keys = this.keysOf(file);
    const before = this.keysByPath.get(file.path);
    this.keysByPath.set(file.path, keys);
    if (before === undefined) return;
    if (isFolderSetPath(file.path, this.getSettings().propertySetFolder)) return;

    const added = newKeys(before, keys);
    if (added.length === 0) return;

    const sets = [...BUILTIN_SETS, ...this.cachedFolderSets().map((entry) => entry.set)];
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const offer = setsToComplete(sets, added, frontmatter).find(
      ({ set }) => !this.offered.has(`${file.path}|${set.id}`)
    );
    if (!offer) return;
    this.offered.add(`${file.path}|${offer.set.id}`);
    showActionNotice(
      t().properties.setCompleteOffer(this.nameOf(offer.set), offer.missing.join(", ")),
      t().properties.setCompleteAction,
      () => void this.applyById(file, offer.set.id),
      OFFER_NOTICE_MS
    );
  }

  /**
   * A feature found its keys missing. The message is the feature's own; the
   * action is offered only when the set would add something, since a note
   * that has the keys and leaves them empty needs a value, not a set.
   */
  offerSet(file: TFile, setId: string, message: string, label: string): void {
    const set = BUILTIN_SETS.find((entry) => entry.id === setId);
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!set || planPropertySet(frontmatter, set).add.length === 0) {
      new Notice(t().common.notice(message));
      return;
    }
    showActionNotice(
      t().common.notice(message),
      label,
      () => void this.applyById(file, setId),
      OFFER_NOTICE_MS
    );
  }

  /** Choose a set for a note, from the property menu or the control. */
  async pick(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice(t().common.notice(t().properties.noNote));
      return;
    }
    const folderSets = await this.loadFolderSets();
    const choices: SetChoice[] = [
      ...BUILTIN_SETS.map((set) => this.choiceOf(set, t().properties.setFromSchreibstube)),
      ...folderSets.map((entry) => this.choiceOf(entry.set, entry.file.path))
    ];
    new PropertySetPickerModal(this.app, choices, t().properties.setPickerPlaceholder, (choice) => {
      void this.applyById(file, choice.id);
    }).open();
  }

  async applyById(file: TFile, id: string): Promise<void> {
    const builtin = BUILTIN_SETS.find((set) => set.id === id);
    if (builtin) {
      await this.write(file, this.nameOf(builtin), builtin.entries, []);
      return;
    }
    const entry = (await this.loadFolderSets()).find((candidate) => candidate.set.id === id);
    if (!entry) return;
    await this.applyFolderSet(file, entry);
  }

  private async applyFolderSet(target: TFile, entry: FolderSet): Promise<void> {
    const name = entry.set.name;
    if (!entry.set.templater) {
      await this.write(target, name, entry.set.entries, this.skippedNotes(name, entry.skipped));
      return;
    }

    // Nothing Templater could add that is not already there: do not run its
    // code for nothing, since that code may ask the person something.
    const frontmatter = this.app.metadataCache.getFileCache(target)?.frontmatter;
    if (entry.set.entries.length > 0 && planPropertySet(frontmatter, entry.set).add.length === 0) {
      new Notice(t().common.notice(t().properties.setNothingToAdd(name)));
      return;
    }

    const render = templaterRenderer(this.app);
    if (render) {
      try {
        const rendered = await withTimeout(
          render(entry.file, target, entry.block),
          TEMPLATER_TIMEOUT_MS,
          (seconds) => `no answer after ${seconds} s`
        );
        const parsed = setFromFrontmatter(entry.set.id, name, parseYamlSafely(rendered), false);
        if (!parsed.set) {
          new Notice(t().common.notice(t().properties.setRenderedInvalid(name)));
          return;
        }
        await this.write(target, name, parsed.set.entries, this.skippedNotes(name, parsed.skipped));
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Templater could not render ${entry.file.path}: ${reason}`);
        await this.writeWithoutCode(target, entry, (keys) =>
          t().properties.setTemplaterFailed(reason, keys)
        );
        return;
      }
    }
    await this.writeWithoutCode(target, entry, (keys) => t().properties.setTemplaterMissing(keys));
  }

  /** Templater is missing or failed: add the keys, the coded values empty. */
  private async writeWithoutCode(
    target: TFile,
    entry: FolderSet,
    explain: (keys: string) => string
  ): Promise<void> {
    if (entry.set.entries.length === 0) {
      new Notice(t().common.notice(t().properties.setUnreadable(entry.set.name)));
      return;
    }
    const { entries, blanked } = withoutTemplaterCode(entry.set.entries);
    const notes = this.skippedNotes(entry.set.name, entry.skipped);
    if (blanked.length > 0) notes.push(explain(blanked.join(", ")));
    await this.write(target, entry.set.name, entries, notes);
  }

  private async write(
    file: TFile,
    name: string,
    entries: PropertyEntry[],
    notes: string[]
  ): Promise<void> {
    const plan = planPropertySet(this.app.metadataCache.getFileCache(file)?.frontmatter, {
      entries
    });
    if (plan.add.length === 0) {
      new Notice(t().common.notice([t().properties.setNothingToAdd(name), ...notes].join(" ")));
      return;
    }
    let added: string[] = [];
    try {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          added = applyPlan(frontmatter, plan);
        }
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Adding the property set "${name}" to ${file.path} failed:`, error);
      new Notice(t().common.notice(t().properties.setWriteFailed(reason)));
      return;
    }
    // These keys were written here, not typed: the change they cause is not
    // a reason to offer a set.
    const before = this.keysByPath.get(file.path) ?? this.keysOf(file);
    this.keysByPath.set(file.path, [...before, ...added]);
    new Notice(
      t().common.notice(
        [t().properties.setAdded(name, added.length, plan.kept.length), ...notes].join(" ")
      )
    );
  }

  private skippedNotes(name: string, skipped: string[]): string[] {
    return skipped.length > 0 ? [t().properties.setSkipped(name, skipped.join(", "))] : [];
  }

  private cachedFolderSets(): FolderSet[] {
    const folder = this.getSettings().propertySetFolder;
    if (this.folderSets?.folder === folder) return this.folderSets.sets;
    void this.loadFolderSets();
    return [];
  }

  private loadFolderSets(): Promise<FolderSet[]> {
    const folder = this.getSettings().propertySetFolder;
    if (this.folderSets?.folder === folder) return Promise.resolve(this.folderSets.sets);
    if (!folder) {
      this.folderSets = { folder, sets: [] };
      return Promise.resolve([]);
    }
    if (this.loading) return this.loading;
    this.loading = this.readFolder(folder)
      .then((sets) => {
        this.folderSets = { folder, sets };
        return sets;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /**
   * Every note in the folder with frontmatter, as a set named after its file.
   * A Templater set is listed from its text with the code masked out; a block
   * that only reads as YAML once Templater has run is still offered, with its
   * keys left to the render.
   */
  private async readFolder(folder: string): Promise<FolderSet[]> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => isFolderSetPath(file.path, folder))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, MAX_SET_NOTES);

    const sets: FolderSet[] = [];
    for (const file of files) {
      const block = frontmatterBlock(await this.app.vault.cachedRead(file));
      if (block === null) continue;
      const templater = hasTemplaterCode(block);
      const parsed = parseYamlSafely(templater ? maskTemplaterCode(block) : block);
      const result = setFromFrontmatter(file.path, file.basename, parsed, templater);
      if (result.set) {
        sets.push({ set: result.set, file, block, skipped: result.skipped });
      } else if (templater) {
        const set: PropertySet = {
          id: file.path,
          name: file.basename,
          source: "folder",
          entries: [],
          templater: true
        };
        sets.push({ set, file, block, skipped: [] });
      } else {
        this.logger.warn(`Property set ${file.path}: no frontmatter a set can be made of.`);
      }
    }
    return sets;
  }

  private choiceOf(set: PropertySet, origin: string): SetChoice {
    return {
      id: set.id,
      name: this.nameOf(set),
      origin,
      keys: set.entries.map((entry) => entry.key)
    };
  }

  private nameOf(set: PropertySet): string {
    return set.source === "schreibstube"
      ? (t().properties.setNames[set.name] ?? set.name)
      : set.name;
  }

  private keysOf(file: TFile): string[] {
    return Object.keys(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {});
  }

  private onControl(event: Event): void {
    const target = event.target;
    if (!isElementLike(target)) return;
    const control = target.closest(`.${CONTROL_CLASS}`);
    if (!isElementLike(control)) return;
    event.preventDefault();
    event.stopPropagation();
    const file = fileShownAround(this.app, control) ?? this.app.workspace.getActiveFile();
    void this.pick(file instanceof TFile ? file : null);
  }

  /**
   * Put a control beside every "Add property" in the document, and watch each
   * widget, which Obsidian rebuilds on edits and may rebuild without its
   * control. The watch is on the widget only, never the whole document: a
   * keystroke in the note must not cost a search of the page.
   */
  private decorate(doc: Document): void {
    for (const [widget, observer] of this.watches) {
      if (widget.isConnected) continue;
      observer.disconnect();
      this.watches.delete(widget);
    }
    for (const widget of propertiesWidgets(doc)) {
      if (!this.watches.has(widget)) {
        const observer = new MutationObserver(() => this.placeControls(widget));
        observer.observe(widget, { childList: true, subtree: true });
        this.watches.set(widget, observer);
      }
      this.placeControls(widget);
    }
  }

  private placeControls(root: ParentNode): void {
    for (const add of addPropertyControls(root)) {
      const next = add.nextElementSibling;
      if (next?.classList.contains(CONTROL_CLASS)) continue;
      const control = add.ownerDocument.createElement("div");
      // Obsidian's own look for a quiet text-and-icon control, the class its
      // "Add property" wears; the layout beside it is ours, in styles.css.
      control.className = `${CONTROL_CLASS} text-icon-button`;
      control.setAttribute("role", "button");
      control.setAttribute("tabindex", "0");
      control.setAttribute("aria-label", t().properties.addSet);
      const icon = control.appendChild(add.ownerDocument.createElement("span"));
      icon.className = "text-button-icon";
      setIcon(icon, "list-plus");
      const label = control.appendChild(add.ownerDocument.createElement("span"));
      label.className = "text-button-label";
      label.textContent = t().properties.addSetButton;
      add.after(control);
    }
  }
}

/** YAML from a note or from Templater's output, which either may get wrong. */
function parseYamlSafely(text: string): unknown {
  try {
    return parseYaml(text) as unknown;
  } catch {
    // Not YAML: the caller treats a non-object as "no set", and says so.
    return null;
  }
}
