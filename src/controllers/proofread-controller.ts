/**
 * Drives the review sidebar: resolves which glossaries apply, runs the two
 * kinds of scan, and puts accepted changes back into the editor.
 *
 * Two rules shape everything here. Accepted changes go in as one transaction so
 * a batch is one undo step. And nothing is applied at the offsets the scan
 * recorded without re-anchoring first, because the note may have been edited
 * while the queue sat open.
 */

import { MarkdownView, Notice, type App, type TFile } from "obsidian";
import type { SchreibstubeSettings } from "../types";
import type { Logger } from "../services/logger";
import { compileGlossaries, type GlossaryMatcher } from "../services/glossary-matcher";
import {
  parseFolderRules,
  parseGlossaryList,
  resolveGlossarySelection,
  type GlossarySelection,
} from "../services/glossary-resolver";
import { GlossaryRegistry } from "../services/glossary-registry";
import { createChunkSender } from "../services/llm-proofread";
import {
  createCancelToken,
  isFlagOnly,
  runProofread,
  scanGlossary,
  type CancelToken,
} from "../services/proofread-runner";
import { resolveApiKey } from "../services/secret";
import { fetchSource } from "../services/sync-fetcher";
import {
  buildSyncSuggestions,
  hashText,
  localState,
  splitNote,
  stripRemoteFrontmatter,
  type LocalState,
  type SyncRecord,
} from "../services/sync-document";
import { resolveSourceUrl, SYNC_FRONTMATTER_KEY } from "../services/sync-source";
import {
  mergeSuggestions,
  planApply,
  refreshStaleness,
  resolveAnchor,
  settleStatuses,
  type Suggestion,
} from "../services/suggestion";
import { GLOSSARY_CHANGED_EVENT } from "../utils/constants";
import {
  EMPTY_REVIEW_STATE,
  type GlossaryPanelState,
  type ReviewHandlers,
  type ReviewState,
  type SyncPanelState,
} from "../ui/review-panel";

export const GLOSSARY_FRONTMATTER_KEY = "schreibstubeGlossaries";

export type ReviewStateListener = (state: ReviewState) => void;

/** Persists sync bookkeeping between sessions. Implemented by the plugin, which
 *  owns the data file. */
export interface SyncStore {
  get(path: string): SyncRecord | undefined;
  set(path: string, record: SyncRecord): Promise<void>;
  forget(path: string): Promise<void>;
}

export class ProofreadController {
  private readonly registry: GlossaryRegistry;
  private readonly listeners = new Set<ReviewStateListener>();
  /** Manual glossary picks, per note, for this session only. */
  private readonly sessionPicks = new Map<string, string[]>();

  private filePath: string | null = null;
  private suggestions: Suggestion[] = [];
  private selection: GlossarySelection = { paths: [], source: "none" };
  private glossaryPanel: GlossaryPanelState = EMPTY_REVIEW_STATE.glossary;
  private matcher: GlossaryMatcher = compileGlossaries([]);
  private progress: ReviewState["progress"] = null;
  private message = "";
  private running: CancelToken | null = null;
  private sync: SyncPanelState = EMPTY_REVIEW_STATE.sync;
  private checking = false;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger,
    private readonly syncStore: SyncStore
  ) {
    this.registry = new GlossaryRegistry(app);
  }

  onStateChange(listener: ReviewStateListener): () => void {
    this.listeners.add(listener);
    listener(this.buildState());
    return () => this.listeners.delete(listener);
  }

  handlers(): ReviewHandlers {
    return {
      onProofread: () => void this.runModelPass(),
      onGlossaryCheck: () => void this.runGlossaryPass(),
      onStop: () => this.stop(),
      onAcceptAll: () => this.acceptAll(),
      onAccept: (id) => this.accept(id),
      onReject: (id) => this.reject(id),
      onReveal: (id) => this.reveal(id),
      onToggleGlossary: (path) => void this.toggleGlossary(path),
      onCheckSource: () => void this.checkSource(true),
    };
  }

  /** The compiled matcher for the active note, for the live editor underline. */
  activeMatcher(): GlossaryMatcher {
    return this.matcher;
  }

  /** Re-resolve the glossary selection when the user switches note. The queue
   *  belongs to one note, so it is dropped rather than shown against another. */
  async syncActiveFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();

    // Focusing the sidebar can leave no active file. That is not a reason to
    // throw away the queue for the note the user is reviewing, so an absent
    // file is only handled when there was nothing under review anyway.
    if (!file) {
      if (this.filePath === null) {
        await this.refreshGlossary(null);
      }
      return;
    }

    const path = file.path;
    if (path === this.filePath) {
      this.refreshSyncBinding(file);
      await this.refreshGlossary(file);
      return;
    }

    this.stop();
    this.filePath = path;
    this.suggestions = [];
    this.progress = null;
    this.message = "";
    this.refreshSyncBinding(file);
    await this.refreshGlossary(file);

    if (this.sync.bound && this.getSettings().syncCheckOnOpen) {
      await this.checkSource(false);
    }
  }

  /** Called as the user types: pending cards whose text has moved beyond
   *  recognition become stale instead of silently applying elsewhere. */
  notifyEditorChanged(): void {
    if (this.suggestions.length === 0) return;

    const text = this.activeEditorText();
    if (text === null) return;

    const refreshed = refreshStaleness(text, this.suggestions);
    if (refreshed.some((s, i) => s.status !== this.suggestions[i].status)) {
      this.suggestions = refreshed;
      this.emit();
    }
  }

  /** A glossary note changed on disk, so cached parses and the active matcher
   *  have to be rebuilt. */
  async invalidateGlossary(path: string): Promise<void> {
    this.registry.invalidate(path);
    if (this.selection.paths.some((selected) => path.endsWith(selected) || selected === path)) {
      await this.refreshGlossary(this.app.workspace.getActiveFile());
    }
  }

  /** Follow a bound note when it moves, so its baseline is not lost. */
  async handleNoteRenamed(oldPath: string, newPath: string): Promise<void> {
    const record = this.syncStore.get(oldPath);
    if (!record) return;
    await this.syncStore.set(newPath, record);
    await this.syncStore.forget(oldPath);
    if (this.filePath === oldPath) {
      this.filePath = newPath;
    }
  }

  async handleNoteDeleted(path: string): Promise<void> {
    if (this.syncStore.get(path)) {
      await this.syncStore.forget(path);
    }
  }

  stop(): void {
    if (this.running) {
      this.running.cancelled = true;
      this.running = null;
    }
  }

  private async runGlossaryPass(): Promise<void> {
    if (this.activeEditorText() === null) {
      new Notice("Schreibstube: keine Notiz im Editor geöffnet.");
      return;
    }

    // A run triggered straight from a command can arrive before the panel has
    // resolved the active note, so the glossary is settled first rather than
    // checking the note against whatever the last one used.
    await this.syncActiveFile();

    const text = this.activeEditorText();
    if (text === null) return;

    if (this.matcher.isEmpty()) {
      this.message = "Kein Glossar ausgewählt oder keine prüfbaren Begriffe.";
      this.emit();
      return;
    }

    const found = scanGlossary(text, this.matcher);
    this.suggestions = mergeSuggestions(this.suggestions, found, "glossary");
    this.message = found.length === 0 ? "Glossar: keine Treffer." : `Glossar: ${found.length} Treffer.`;
    this.emit();
  }

  private async runModelPass(): Promise<void> {
    if (this.activeEditorText() === null) {
      new Notice("Schreibstube: keine Notiz im Editor geöffnet.");
      return;
    }

    if (this.running) {
      new Notice("Schreibstube: es läuft bereits eine Korrektur.");
      return;
    }

    // Settle the glossary first, so the constraints sent with the very first
    // request belong to this note.
    await this.syncActiveFile();

    const text = this.activeEditorText();
    if (text === null) return;

    const settings = this.getSettings();
    const key = resolveApiKey(this.app.secretStorage, settings.llmSecretName);
    if (!key.ok) {
      new Notice(key.message);
      return;
    }

    const token = createCancelToken();
    this.running = token;
    this.progress = { completed: 0, total: 0 };
    this.message = "Korrektur läuft …";
    this.emit();

    // The glossary pass costs nothing and catches terms the model is only asked
    // to respect, so it seeds the queue before the first request goes out.
    const seeded = this.matcher.isEmpty() ? [] : scanGlossary(text, this.matcher);
    if (seeded.length > 0) {
      this.suggestions = mergeSuggestions(this.suggestions, seeded, "glossary");
      this.emit();
    }

    try {
      const result = await runProofread(
        text,
        createChunkSender(settings, key.apiKey, this.matcher.constraints()),
        {
          chunkChars: settings.proofreadChunkChars,
          concurrency: settings.proofreadConcurrency,
        },
        token,
        (progress) => {
          if (token.cancelled) return;
          this.progress = {
            completed: progress.completedChunks,
            total: progress.totalChunks,
          };
          this.suggestions = mergeSuggestions(this.suggestions, progress.suggestions, "llm");
          this.emit();
        }
      );

      if (token.cancelled) {
        this.message = "Korrektur abgebrochen.";
      } else {
        this.suggestions = mergeSuggestions(this.suggestions, result.suggestions, "llm");
        this.message = summarize(result.suggestions.length, result.rejectedBlocks, result.failedChunks);
      }
    } catch (err) {
      this.logger.error("Proofread failed:", err);
      const detail = err instanceof Error ? err.message : "unbekannter Fehler";
      new Notice(`Schreibstube: Korrektur fehlgeschlagen — ${detail}`);
      this.message = "Korrektur fehlgeschlagen.";
    } finally {
      if (this.running === token) {
        this.running = null;
      }
      this.progress = null;
      this.emit();
    }
  }

  private accept(id: string): void {
    const suggestion = this.suggestions.find((entry) => entry.id === id);
    if (!suggestion || isFlagOnly(suggestion)) return;
    this.applyBatch([suggestion]);
  }

  private acceptAll(): void {
    const pending = this.suggestions.filter(
      (suggestion) => suggestion.status === "pending" && !isFlagOnly(suggestion)
    );
    if (pending.length === 0) return;
    this.applyBatch(pending);
  }

  private applyBatch(batch: Suggestion[]): void {
    const view = this.resolveTargetView();
    if (!view) {
      new Notice("Schreibstube: die geprüfte Notiz ist nicht mehr geöffnet.");
      return;
    }

    const editor = view.editor;
    const fromSource = batch.some((suggestion) => suggestion.source === "remote");
    const plan = planApply(editor.getValue(), batch);

    if (plan.changes.length > 0) {
      // One transaction, so the whole batch is a single undo step.
      editor.transaction({
        changes: plan.changes.map((change) => ({
          from: editor.offsetToPos(change.from),
          to: editor.offsetToPos(change.to),
          text: change.text,
        })),
      });
    }

    const applied = new Set(plan.changes.map((change) => change.id));
    this.suggestions = settleStatuses(this.suggestions, plan, applied);

    // Offsets recorded before this batch are now wrong by the size of it, so
    // every remaining card is re-anchored against the new text at once.
    this.suggestions = refreshStaleness(editor.getValue(), this.suggestions);

    if (fromSource) {
      void this.settleSyncBaseline(editor.getValue());
    }

    const skipped = plan.stale.length + plan.conflicted.length;
    if (skipped > 0) {
      this.message = `${applied.size} übernommen, ${skipped} nicht mehr zuordenbar.`;
    } else if (applied.size > 1) {
      this.message = `${applied.size} Änderungen übernommen.`;
    }

    this.emit();
  }

  private reject(id: string): void {
    this.suggestions = this.suggestions.map((suggestion) =>
      suggestion.id === id ? { ...suggestion, status: "rejected" as const } : suggestion
    );
    this.emit();
  }

  private reveal(id: string): void {
    const view = this.resolveTargetView();
    const suggestion = this.suggestions.find((entry) => entry.id === id);
    if (!view || !suggestion) return;

    const anchor = resolveAnchor(view.editor.getValue(), suggestion);
    if (!anchor) {
      new Notice("Schreibstube: Stelle nicht mehr auffindbar.");
      return;
    }

    const from = view.editor.offsetToPos(anchor.from);
    const to = view.editor.offsetToPos(anchor.to);
    view.editor.setSelection(from, to);
    view.editor.scrollIntoView({ from, to }, true);
  }

  private async toggleGlossary(path: string): Promise<void> {
    if (!this.filePath) return;

    // The first toggle starts from whatever currently applies, so switching one
    // glossary off does not silently drop the rest.
    const current = this.sessionPicks.get(this.filePath) ?? [...this.selection.paths];
    const next = current.includes(path)
      ? current.filter((entry) => entry !== path)
      : [...current, path];

    this.sessionPicks.set(this.filePath, next);
    await this.refreshGlossary(this.app.workspace.getActiveFile());
  }

  private async refreshGlossary(file: TFile | null): Promise<void> {
    const settings = this.getSettings();
    const available = this.registry.listCandidates();

    if (!file) {
      this.sync = EMPTY_REVIEW_STATE.sync;
      this.selection = { paths: [], source: "none" };
      this.matcher = compileGlossaries([]);
      this.glossaryPanel = { selected: [], available, source: "none", errors: [], missing: [] };
      window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
      this.emit();
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    this.selection = resolveGlossarySelection({
      notePath: file.path,
      frontmatter: parseGlossaryList(frontmatter?.[GLOSSARY_FRONTMATTER_KEY]),
      folderRules: parseFolderRules(settings.glossaryFolderRules),
      session: this.sessionPicks.get(file.path),
      fallback: settings.glossaryDefault,
    });

    const loaded = await this.registry.load(this.selection.paths, file.path);
    this.matcher = compileGlossaries(loaded.glossaries);
    this.glossaryPanel = {
      selected: this.selection.paths,
      available,
      source: this.selection.source,
      errors: loaded.errors,
      missing: loaded.missing,
    };

    this.logger.debug(
      `Glossary for ${file.path}: ${this.selection.paths.length} file(s) via ${this.selection.source}.`
    );
    window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
    this.emit();
  }


  /**
   * Check the bound source and turn any difference into cards.
   *
   * `manual` separates a deliberate check from the automatic one on note open:
   * the automatic check respects the minimum interval and stays silent when the
   * note is not bound, while a manual one always runs and always reports.
   */
  private async checkSource(manual: boolean): Promise<void> {
    const settings = this.getSettings();
    if (!settings.syncEnabled || this.checking) return;

    const file = this.app.workspace.getActiveFile();
    if (!file || file.path !== this.filePath) return;

    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.[SYNC_FRONTMATTER_KEY];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      if (manual) new Notice("Schreibstube: diese Notiz ist an keine Quelle gebunden.");
      return;
    }

    const resolved = resolveSourceUrl(raw);
    if (!resolved.ok) {
      this.sync = { ...this.sync, bound: true, status: "error", source: raw, message: resolved.reason };
      this.emit();
      return;
    }

    const record = this.syncStore.get(file.path);
    if (!manual && !this.isCheckDue(record, settings.syncMinIntervalMinutes)) {
      return;
    }

    this.checking = true;
    this.sync = { ...this.sync, bound: true, status: "checking", source: resolved.url, message: "" };
    this.emit();

    try {
      const outcome = await fetchSource({ url: resolved.url, etag: record?.etag });
      const view = this.resolveTargetView();

      // The user may have moved on while the request was in flight.
      if (!view || view.file?.path !== file.path) return;

      const noteText = view.editor.getValue();
      const body = splitNote(noteText).body;
      const state = localState(body, record);
      const checkedAt = Date.now();

      if (outcome.status === "missing" || outcome.status === "error") {
        // A source that vanished never empties the note. It is reported and the
        // local copy is left exactly as it is.
        //
        // The clock still advances, so a dead binding does not fire a request
        // every time the note is opened. A manual check ignores the interval,
        // which is the way back from a source that was only briefly away.
        await this.syncStore.set(file.path, {
          hash: record?.hash ?? hashText(body),
          etag: record?.etag ?? "",
          checkedAt,
        });
        this.sync = {
          bound: true,
          status: outcome.status,
          source: resolved.url,
          checkedAt,
          message: outcome.message,
        };
        this.emit();
        return;
      }

      if (outcome.status === "unchanged") {
        await this.syncStore.set(file.path, {
          hash: record?.hash ?? hashText(body),
          etag: outcome.etag,
          checkedAt,
        });
        this.sync = {
          bound: true,
          status: state === "diverged" ? "diverged" : "clean",
          source: resolved.url,
          checkedAt,
          message: this.describeState(state, 0),
        };
        this.emit();
        return;
      }

      const remoteBody = stripRemoteFrontmatter(outcome.body);
      const suggestions = buildSyncSuggestions({ noteText, remoteBody, state });

      await this.syncStore.set(file.path, {
        // The baseline only advances once the note actually matches the source,
        // so an unaccepted update is still pending on the next check.
        hash: suggestions.length === 0 ? hashText(body) : record?.hash ?? hashText(body),
        etag: outcome.etag,
        checkedAt,
      });

      this.suggestions = mergeSuggestions(this.suggestions, suggestions, "remote");
      this.sync = {
        bound: true,
        status: suggestions.length === 0 ? "clean" : state === "diverged" ? "diverged" : "idle",
        source: resolved.url,
        checkedAt,
        message: this.describeState(state, suggestions.length),
      };
      this.emit();
    } catch (err) {
      this.logger.error("Source check failed:", err);
      this.sync = {
        ...this.sync,
        bound: true,
        status: "error",
        message: err instanceof Error ? err.message : "Unbekannter Fehler.",
      };
      this.emit();
    } finally {
      this.checking = false;
    }
  }

  /**
   * Move the divergence baseline forward once the note matches its source
   * again.
   *
   * Without this, accepting every incoming card would leave the baseline at the
   * pre-update body, and the next check would report the note as locally edited
   * when all the user did was accept the source.
   *
   * A partially accepted update deliberately does not advance it: the note then
   * matches neither side, and "diverged" is the honest description.
   */
  private async settleSyncBaseline(noteText: string): Promise<void> {
    if (!this.filePath) return;

    const record = this.syncStore.get(this.filePath);
    if (!record) return;

    const outstanding = this.suggestions.some(
      (suggestion) =>
        suggestion.source === "remote" &&
        (suggestion.status === "pending" || suggestion.status === "stale")
    );
    if (outstanding) return;

    await this.syncStore.set(this.filePath, {
      ...record,
      hash: hashText(splitNote(noteText).body),
    });

    this.sync = { ...this.sync, status: "clean", message: "Notiz entspricht der Quelle." };
    this.emit();
  }

  private describeState(state: LocalState, changes: number): string {
    if (changes === 0) {
      return state === "diverged"
        ? "Quelle unverändert, die Notiz enthält lokale Änderungen."
        : "Notiz entspricht der Quelle.";
    }
    if (state === "diverged") {
      return `${changes} Unterschied(e). Die Notiz wurde lokal geändert, Übernehmen stellt die Quelle wieder her.`;
    }
    return `${changes} Änderung(en) aus der Quelle.`;
  }

  private isCheckDue(record: SyncRecord | undefined, minIntervalMinutes: number): boolean {
    if (!record || minIntervalMinutes <= 0) return true;
    return Date.now() - record.checkedAt >= minIntervalMinutes * 60_000;
  }

  /** Reflect the binding in the panel without fetching anything. */
  private refreshSyncBinding(file: TFile | null): void {
    if (!file) {
      this.sync = EMPTY_REVIEW_STATE.sync;
      return;
    }

    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.[SYNC_FRONTMATTER_KEY];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      this.sync = EMPTY_REVIEW_STATE.sync;
      return;
    }

    const resolved = resolveSourceUrl(raw);
    const record = this.syncStore.get(file.path);

    this.sync = {
      bound: true,
      status: resolved.ok ? (record ? "idle" : "unsynced") : "error",
      source: resolved.ok ? resolved.url : raw,
      checkedAt: record?.checkedAt ?? 0,
      message: resolved.ok ? "" : resolved.reason,
    };
  }

  private activeEditorText(): string | null {
    const view = this.resolveTargetView();
    return view ? view.editor.getValue() : null;
  }

  /**
   * The editor holding the note under review.
   *
   * Every button in this panel takes focus away from the editor, so the active
   * view at click time may be the sidebar itself. The note being reviewed is
   * looked up by path instead, falling back to the active view only before a
   * note has been claimed.
   */
  private resolveTargetView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file && (this.filePath === null || active.file.path === this.filePath)) {
      return active;
    }

    if (this.filePath === null) {
      return active;
    }

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === this.filePath) {
        return view;
      }
    }

    return null;
  }

  private buildState(): ReviewState {
    const hasFile = this.filePath !== null;
    return {
      phase: !hasFile ? "no-file" : this.running ? "running" : this.suggestions.length > 0 ? "reviewing" : "idle",
      fileName: this.filePath?.split("/").pop() ?? "",
      suggestions: this.suggestions,
      progress: this.progress,
      glossary: this.glossaryPanel,
      sync: this.sync,
      message: this.message,
    };
  }

  private emit(): void {
    const state = this.buildState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

function summarize(count: number, rejectedBlocks: number, failedChunks: number): string {
  const parts = [count === 0 ? "Keine Vorschläge." : `${count} Vorschläge.`];
  if (rejectedBlocks > 0) {
    parts.push(`${rejectedBlocks} Abschnitt(e) verworfen (geschützter Inhalt verändert).`);
  }
  if (failedChunks > 0) {
    parts.push(`${failedChunks} Anfrage(n) fehlgeschlagen.`);
  }
  return parts.join(" ");
}
