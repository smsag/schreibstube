import { Notice, Platform, TFile, type Plugin } from "obsidian";
import type { SchreibstubeSettings } from "../../types";
import type { Logger } from "../../services/logger";
import { t } from "../../i18n";
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_SIMILARITY_PRESET,
  effectiveEmbeddingModel,
  embedChunkChars,
  embeddingModelConfig,
  vectorFamily,
  type EmbeddingModelId
} from "../../services/semantic/embedding-models";
import type { SemanticStatus } from "../../services/semantic/status-text";
import type {
  BuildProgress,
  BuildRecord,
  IndexFacts,
  SearchTiming
} from "../../services/semantic/index-report";
import {
  ResidentProvider,
  installEmbeddingResidency,
  type EmbeddingResidency
} from "../../services/semantic/residency";
import {
  VaultIndexService,
  type IndexableNote,
  type QueryTiming
} from "../../services/semantic/vault-index-service";
import { hashPolicyFor } from "../../services/semantic/row-provenance";
import { decideBuild, shouldCatchUp } from "../../services/semantic/build-decision";
import { BuildGuard, vaultBuildGuard } from "../../services/semantic/build-guard";
import { isOutOfMemoryError } from "../../services/semantic/memory-error";
import { selectIndexPaths, scopeSignature } from "../../services/semantic/index-scope";
import { optedOut, type RetrievedNote } from "../../services/semantic/vault-retrieval";
import { catchUpIndex, CATCH_UP_DELAY_MS } from "../../services/semantic/vault-catch-up";
import { applyMeaningFloor, meaningFloor } from "../../services/semantic/search-fusion";
import { peekIndexMeta, type IndexKeeper } from "../../services/semantic/embedding-index";
import { pluginRunsOwnModel } from "../../services/workspace-internals";
import { createEmbeddingProvider } from "./host/embedding-provider-factory";
import { embeddingWorkerUrl } from "./host/worker-bundle-url";
import { SemanticConversations } from "./semantic-conversations";
import { SemanticIndexFiles } from "./index-files";
import { registerVaultWatcher } from "./vault-watcher";

/** Milliseconds for timing a search: steps with no clock change. */
function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * The most notes one "Build now" embeds on a phone.
 *
 * A phone holds the index a desktop builds (Pythia ADR-221); it does not build
 * one. A first build there ran for well over an hour on a vault of a few
 * hundred notes, on the UI thread, with iOS free to end it whenever Obsidian
 * went to the background. So a phone never builds on its own, and a press adds
 * this many — newest first — for a vault that has no desktop, or a note needed
 * now.
 */
export const MOBILE_BUILD_BUDGET = 50;

/**
 * The most notes one batch of edits embeds on a phone. A person writing edits
 * a note or two at a time; a sync landing a hundred changed notes at launch is
 * the desktop's to embed, not the phone's UI thread's.
 */
export const MOBILE_EDIT_BUDGET = 10;

/** How often a phone holding an unfinished index looks for the desktop's newer
 *  copy while it is being searched. Reading the file is cheap; reading it on
 *  every keystroke is not. */
const PHONE_LOOK_EVERY_MS = 60_000;

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "building"; done: number; total: number }
  | { kind: "failed"; error: string; outOfMemory: boolean; loadFailed: boolean };

/**
 * Search by meaning, on this device.
 *
 * One model, one index of the vault's notes, kept by a single device: the
 * decisions come from Pythia's engine after its hardening and live in
 * `services/semantic`; this class only wires them to the vault. It does
 * nothing until the setting is switched on, and it never loads a model on a
 * phone while Pythia, which runs a model of its own, is switched on there too —
 * two are over what the OS lets one app hold.
 */
export class SemanticEngine {
  private provider: ResidentProvider | null = null;
  private providerModel: EmbeddingModelId | null = null;
  private service: VaultIndexService | null = null;
  private residency: EmbeddingResidency | null = null;
  private workerUrl: Promise<string> | null = null;
  private readonly guard: BuildGuard;
  private phase: Phase = { kind: "idle" };
  private syncing = false;
  private caughtUp = false;
  private backend: string | null = null;
  private deferred: { changed: Map<string, TFile>; deleted: Set<string> } | null = null;
  /** Set at unload: every build still running stops at its next note. */
  private readonly stop = { aborted: false };
  /** The phone has said once this session that the desktop builds the index. */
  private toldDesktopBuilds = false;
  /** Where the time of the last search by meaning went. */
  private lastSearch: SearchTiming | null = null;
  /** A warm-up is running; a second focus does not start another. */
  private warming = false;
  /** The build running now, or the last one this session. */
  private lastBuild: BuildRecord | null = null;
  /** When the phone last looked for a newer index from the desktop. */
  private lastPhoneLook = Number.NEGATIVE_INFINITY;
  private fileCount: { scope: string; count: number; complete: boolean } | null | undefined;
  private readonly listeners = new Set<() => void>();
  /** Conversations a chat plugin hands over through the API. */
  readonly conversations: SemanticConversations;

  constructor(
    private readonly plugin: Plugin,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger
  ) {
    this.guard = vaultBuildGuard(plugin.app);
    this.conversations = new SemanticConversations({
      plugin,
      logger,
      enabled: () => this.enabled(),
      modelId: () => this.modelId(),
      provider: () => this.ensureProvider(),
      changed: () => this.emit()
    });
  }

  /** Register the vault watcher, the phone's residency rule and the launch catch-up. */
  start(): void {
    registerVaultWatcher(this.plugin, {
      applyChanges: (changed, deleted) => void this.applyChanges(changed, deleted),
      activePath: () => this.plugin.app.workspace.getActiveFile()?.path ?? null
    });
    this.residency = installEmbeddingResidency(this.plugin, {
      provider: () => this.provider,
      building: () => this.syncing || this.conversations.isSyncing(),
      mobile: Platform.isMobile,
      onBackground: (hidden) => {
        if (this.syncing) this.guard.markBackground(hidden);
      },
      log: (message, data) => this.logger.debug(message, data)
    });
    this.plugin.app.workspace.onLayoutReady(() => {
      const id = window.setTimeout(() => void this.catchUp(), CATCH_UP_DELAY_MS);
      this.plugin.register(() => window.clearTimeout(id));
    });
  }

  /** Called on every status change. Returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        this.logger.warn("semantic engine: status listener failed", e);
      }
    }
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.emit();
  }

  /** Whether a second model would join Pythia's on a phone. */
  private blocked(): boolean {
    return Platform.isMobile && pluginRunsOwnModel(this.plugin.app, "pythia");
  }

  /** Whether search by meaning is switched on and may run on this device. */
  enabled(): boolean {
    return this.getSettings().semanticSearchEnabled && !this.blocked();
  }

  private modelId(): EmbeddingModelId {
    return effectiveEmbeddingModel(DEFAULT_EMBEDDING_MODEL_ID, Platform.isMobile);
  }

  /** The model download this device would make, for the setting to name. */
  downloadMb(): number {
    return embeddingModelConfig(this.modelId()).downloadMb;
  }

  private files(): SemanticIndexFiles {
    return new SemanticIndexFiles(this.plugin, this.modelId());
  }

  private scope(): string {
    return scopeSignature(
      {
        vaultContextFolders: [],
        conversationsFolder: "",
        scratchFolder: "",
        vaultContextMaxIndexedNotes: this.getSettings().semanticMaxNotes
      },
      vectorFamily(this.modelId())
    );
  }

  private ensureProvider(): ResidentProvider {
    const modelId = this.modelId();
    if (this.provider && this.providerModel === modelId) return this.provider;
    this.provider?.unload();
    this.service = null;
    this.conversations.reset();
    this.provider = new ResidentProvider(
      createEmbeddingProvider(
        modelId,
        (p) => this.logger.debug("semantic engine: model load", p),
        () => (this.workerUrl ??= embeddingWorkerUrl(this.plugin)),
        (backend, failures) => {
          this.backend = backend;
          this.logger.debug("semantic engine: backend resolved", { backend, failures });
        },
        this.logger
      ),
      () => this.residency?.noteUse()
    );
    this.providerModel = modelId;
    return this.provider;
  }

  private ensure(): VaultIndexService {
    const provider = this.ensureProvider();
    if (!this.service) {
      this.service = new VaultIndexService(provider, this.files(), {
        maxChars: embedChunkChars(this.modelId()),
        hashPolicy: hashPolicyFor(this.modelId()),
        device: Platform.isMobile ? "mobile" : "desktop",
        logger: this.logger,
        ...(Platform.isMobile ? { phoneJournal: this.files().phoneJournal() } : {})
      });
    }
    return this.service;
  }

  /** The notes the index should hold, newest first, capped and opted out. */
  private collectNotes(): IndexableNote[] {
    return this.scopeNotes().notes;
  }

  /** The notes to index, and what was left out on the way and why. */
  private scopeNotes(): {
    notes: IndexableNote[];
    vaultNotes: number;
    optedOut: number;
    overCap: number;
  } {
    const app = this.plugin.app;
    const all = app.vault.getMarkdownFiles();
    const files = all
      .filter((file) => {
        return !optedOut(app.metadataCache.getFileCache(file)?.frontmatter);
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    const byPath = new Map(files.map((file) => [file.path, file]));
    const { paths, total } = selectIndexPaths(
      files.map((file) => file.path),
      { include: [], skip: [], cap: this.getSettings().semanticMaxNotes }
    );
    const notes = paths.flatMap((path) => {
      const file = byPath.get(path);
      return file ? [{ path, load: () => app.vault.cachedRead(file) }] : [];
    });
    return {
      notes,
      vaultNotes: all.length,
      optedOut: all.length - files.length,
      overCap: total - paths.length
    };
  }

  /** Start recording a build for the settings, and return its progress listener. */
  private record(kind: BuildRecord["kind"], total: number) {
    const build: BuildRecord = {
      kind,
      startedAt: Date.now(),
      endedAt: null,
      stopped: false,
      error: null,
      done: 0,
      total,
      embedded: 0,
      reused: 0,
      failed: 0,
      passages: 0
    };
    this.lastBuild = build;
    return (done: number, all: number, detail: BuildProgress): void => {
      Object.assign(build, detail, { done, total: all });
    };
  }

  /** The recorded build has ended, however it ended. */
  private endRecord(outcome: { stopped?: boolean; error?: string | null } = {}): void {
    const build = this.lastBuild;
    if (!build || build.endedAt !== null) return;
    build.endedAt = Date.now();
    build.stopped = outcome.stopped ?? false;
    build.error = outcome.error ?? null;
  }

  /**
   * Build or finish the index in the background (Pythia ADR-118/199/203).
   *
   * Never awaited by a search: a search against an index that is not ready
   * returns nothing from this side and the keyword results stand alone.
   */
  refresh(opts: { force?: boolean; manual?: boolean; clear?: boolean } = {}): void {
    if (!this.enabled() || this.syncing) return;
    if (Platform.isMobile && !opts.manual) {
      void this.holdOnPhone();
      return;
    }
    // A build that failed this session is not started again by a search. The
    // index now answers while it builds, so a failure moves what it can answer
    // and the Explorer asks again — which would restart the build, fail, and
    // go round for as long as the filter held text. "Build now" still retries.
    if (!opts.manual && this.phase.kind === "failed") return;
    const decision = decideBuild(opts, {
      syncing: false,
      complete: this.service?.isComplete(this.scope()) ?? false,
      mayAutoBuild: this.guard.mayAutoBuild(),
      loadFailed: this.phase.kind === "failed" && this.phase.loadFailed
    });
    if (!decision.run) return;
    if (opts.manual) this.guard.end();
    // A model that failed to load anywhere — a catch-up, a query, an edit —
    // is loaded afresh by a press, not only one whose failure a build saw.
    const reload =
      decision.reloadProvider || (Boolean(opts.manual) && (this.provider?.loadFailed() ?? false));
    this.syncing = true;
    this.guard.start(this.modelId());
    this.setPhase({ kind: "loading" });
    void this.build(opts, reload);
  }

  /**
   * A phone's automatic "build": read what the desktop wrote and answer from it,
   * finished or not. Never embeds a note, so it never loads the model for the
   * vault (a query still loads it, for the one query). When the index is not
   * finished, say once where it is being finished.
   */
  private async holdOnPhone(): Promise<void> {
    this.syncing = true;
    this.lastPhoneLook = Date.now();
    try {
      const svc = this.ensure();
      const heldBefore = svc.isReady();
      await svc.hydrateForQuery();
      // The desktop may have written more since this session read the file.
      if (heldBefore) {
        const buf = await this.files().read();
        if (svc.baseDiffersFrom(buf ? peekIndexMeta(buf)?.writtenAt : undefined))
          await svc.reload();
      }
      // Reading worked: a failure that was not the model's is behind it.
      if (this.phase.kind === "failed" && !this.phase.loadFailed) this.phase = { kind: "idle" };
      if (!svc.isComplete(this.scope()) && !this.toldDesktopBuilds) {
        this.toldDesktopBuilds = true;
        new Notice(
          t().semantic.desktopBuilds(svc.size(), this.collectNotes().length, MOBILE_BUILD_BUDGET),
          12_000
        );
      }
    } catch (e) {
      this.logger.warn("semantic engine: could not read the index on this phone", e);
    } finally {
      this.syncing = false;
      this.fileCount = undefined;
      this.emit();
    }
    // Edits made before the index was read waited for it. Applied once the
    // phone is no longer "busy", so Build now is not refused meanwhile.
    await this.flushDeferred();
  }

  private async build(
    opts: { force?: boolean; clear?: boolean },
    reloadProvider: boolean
  ): Promise<void> {
    let loaded = false;
    let notice: Notice | null = null;
    try {
      const provider = this.ensureProvider();
      if (reloadProvider) provider.unload();
      await provider.ready();
      loaded = true;
      const svc = this.ensure();
      if (opts.clear) await svc.clear();
      const scope = this.scope();
      const offThread = provider.isOffThread?.() ?? false;
      if (!offThread) {
        await svc.hydrateForQuery();
        if (svc.isComplete(scope) && !opts.force) {
          this.guard.end();
          this.setPhase({ kind: "idle" });
          return;
        }
      }
      const notes = this.collectNotes();
      notice = new Notice(t().semantic.building, 0);
      this.setPhase({ kind: "building", done: 0, total: notes.length });
      const recordProgress = this.record("build", notes.length);
      const result = await svc.sync(
        notes,
        (done, total, detail) => {
          recordProgress(done, total, detail);
          notice?.setMessage(t().semantic.progress(done, total));
          this.setPhase({ kind: "building", done, total });
        },
        offThread ? {} : { yieldEveryNotes: 1, breatherMs: 12 },
        scope,
        // A phone embeds a budget and merges what a desktop wrote meanwhile.
        Platform.isMobile
          ? { maxEmbeds: MOBILE_BUILD_BUDGET, mergeFromStore: true, signal: this.stop }
          : { signal: this.stop }
      );
      this.guard.end();
      this.endRecord({ stopped: result.stopped });
      this.setPhase({ kind: "idle" });
      if (result.stopped) new Notice(t().semantic.phoneBudget(result.embedded), 8_000);
    } catch (e) {
      const outOfMemory = isOutOfMemoryError(e);
      if (!outOfMemory) this.guard.end();
      this.endRecord({ error: e instanceof Error ? e.message : String(e) });
      this.setPhase({
        kind: "failed",
        error: e instanceof Error ? e.message : String(e),
        outOfMemory,
        loadFailed: !loaded
      });
      this.logger.warn("semantic engine: build failed", e);
    } finally {
      notice?.hide();
      this.syncing = false;
      this.fileCount = undefined;
      this.afterWork();
      this.emit();
    }
    // Outside the build's try: an edit that fails to apply is the edit's, and
    // must not report the build that just succeeded as failed.
    await this.flushDeferred();
  }

  /** What a build or catch-up leaves to do once it is over. */
  private afterWork(): void {
    // Switched off while it ran: the model is given back now, as it would
    // have been at the switch had nothing been running.
    if (!this.enabled()) this.teardown();
  }

  /** Once per session on a desktop: catch up with what changed while closed. */
  private async catchUp(): Promise<void> {
    if (!this.enabled()) return;
    if (
      !shouldCatchUp({
        mobile: Platform.isMobile,
        ran: this.caughtUp,
        syncing: this.syncing,
        mayAutoBuild: this.guard.mayAutoBuild(),
        loadFailed: this.phase.kind === "failed" && this.phase.loadFailed
      })
    ) {
      return;
    }
    this.caughtUp = true;
    // Busy from here, not after the awaits below: a search in between would
    // otherwise start a build beside the catch-up.
    this.syncing = true;
    try {
      if (!(await this.files().exists())) return;
      const result = await catchUpIndex({
        service: () => this.ensure(),
        scope: () => this.scope(),
        notes: () => this.collectNotes(),
        modelId: () => this.modelId(),
        guard: this.guard,
        signal: this.stop,
        onProgress: (done, total, detail) => {
          // Recorded from its first note on: a catch-up that finds the index
          // incomplete never calls this, and leaves the last build's record.
          if (this.lastBuild?.kind !== "catchUp" || this.lastBuild.endedAt !== null)
            this.record("catchUp", total);
          Object.assign(this.lastBuild!, detail, { done, total });
          this.setPhase({ kind: "building", done, total });
        }
      });
      this.endRecord();
      this.setPhase({ kind: "idle" });
      this.logger.debug("semantic engine: catch-up", result);
    } catch (e) {
      this.setPhase({
        kind: "failed",
        error: e instanceof Error ? e.message : String(e),
        outOfMemory: isOutOfMemoryError(e),
        loadFailed: this.provider?.loadFailed() ?? false
      });
      this.endRecord({ error: e instanceof Error ? e.message : String(e) });
      this.logger.warn("semantic engine: catch-up failed", e);
    } finally {
      this.syncing = false;
      this.fileCount = undefined;
      this.afterWork();
      this.emit();
    }
    await this.flushDeferred();
  }

  /** Targeted updates from the vault watcher; held while the index is not ready. */
  async applyChanges(changed: TFile[], deleted: string[]): Promise<void> {
    if (!this.enabled()) return;
    const svc = this.service;
    if (!svc?.isReady()) {
      // A phone that has not read the index yet reads it now, and applies the
      // edits held here once it has: a note written on the phone is indexed
      // on the phone, not only once someone searches.
      if (Platform.isMobile) this.refresh();
      const buf = (this.deferred ??= { changed: new Map(), deleted: new Set() });
      for (const file of changed) {
        buf.changed.set(file.path, file);
        buf.deleted.delete(file.path);
      }
      for (const path of deleted) {
        buf.deleted.add(path);
        buf.changed.delete(path);
      }
      return;
    }
    const app = this.plugin.app;
    const removes = [...deleted];
    const updates: IndexableNote[] = [];
    for (const file of changed) {
      if (optedOut(app.metadataCache.getFileCache(file)?.frontmatter)) {
        removes.push(file.path);
      } else {
        updates.push({ path: file.path, load: () => app.vault.cachedRead(file) });
      }
    }
    try {
      await svc.applyBatch(
        { updates, removes },
        {
          cap: this.getSettings().semanticMaxNotes,
          // A phone embeds a few edits of its own; a sync landing a hundred
          // changed notes is the desktop's to embed, not the phone's UI thread.
          ...(Platform.isMobile ? { maxEmbeds: MOBILE_EDIT_BUDGET } : {})
        }
      );
    } catch (e) {
      this.logger.warn("semantic engine: edits could not be applied to the index", e);
    }
    this.fileCount = undefined;
    // Edits held while the index was being read, if they arrived after it
    // had already applied the ones it held.
    await this.flushDeferred();
    this.emit();
  }

  private async flushDeferred(): Promise<void> {
    const buf = this.deferred;
    this.deferred = null;
    if (!buf || (buf.changed.size === 0 && buf.deleted.size === 0)) return;
    await this.applyChanges([...buf.changed.values()], [...buf.deleted]);
  }

  /** Whether a search by meaning can answer now, without building first. */
  isReady(): boolean {
    return this.enabled() && (this.service?.isReady() ?? false);
  }

  /**
   * How much a search by meaning can answer now: nothing, part of the vault
   * (a build under way, or a phone holding an unfinished index), or all of it.
   * The Explorer asks again when this moves, so a filter typed before the index
   * could answer is not left without its meaning rows.
   */
  searchState(): "none" | "partial" | "ready" {
    const svc = this.service;
    if (!this.enabled() || !svc?.isQueryable()) return "none";
    return svc.isComplete(this.scope()) && svc.isReady() ? "ready" : "partial";
  }

  /**
   * Notes whose meaning answers `text`, best first. Starts a build and answers
   * nothing while the index is not ready; the keyword results stand alone then.
   */
  async search(text: string, limit: number): Promise<RetrievedNote[]> {
    if (!this.enabled()) return [];
    const started = now();
    const svc = this.service;
    if (!svc?.isQueryable()) {
      // Read but not made queryable — the Recommended panel or the settings
      // read it first. A finished index answers at once; asking for a build
      // instead was refused as "complete", and nothing ever answered.
      if (!svc?.isComplete(this.scope())) {
        this.refresh();
        return [];
      }
      await svc.hydrateForQuery();
      void this.flushDeferred();
    }
    // A build left unfinished by an earlier session is resumed; a partial
    // index answers meanwhile. A phone instead looks, now and then, whether
    // the desktop has written more of it.
    if (!svc.isComplete(this.scope())) {
      if (!Platform.isMobile) this.refresh();
      else if (Date.now() - this.lastPhoneLook >= PHONE_LOOK_EVERY_MS) this.refresh();
    }
    try {
      // The model's load timed apart from the query, since it is the cost the
      // warm-up on focus exists to take out of the first search.
      let loadMs = 0;
      const provider = this.ensureProvider();
      if (!provider.loaded) {
        const loadStart = now();
        await provider.ready();
        loadMs = now() - loadStart;
      }
      const floor = meaningFloor(text);
      const timing: QueryTiming = { embedMs: 0, rankMs: 0, cached: false, notes: 0 };
      const hits = applyMeaningFloor(
        await svc.query(text, { minScore: floor.minScore, limit, timing }),
        floor
      );
      this.lastSearch = {
        at: Date.now(),
        totalMs: now() - started,
        loadMs,
        ...timing,
        hits: hits.length
      };
      this.logger.debug("semantic engine: search", this.lastSearch);
      return hits;
    } catch (e) {
      this.logger.warn("semantic engine: search failed", e);
      return [];
    }
  }

  /**
   * What is like the note at `path`, from vectors already stored: notes (a
   * description note among them stands for its picture) and conversations.
   * Never loads the model for the notes, so the panel can follow the open note
   * on a phone that released it; a note not yet indexed has nothing to offer.
   */
  async relatedToNote(
    path: string,
    limit: number
  ): Promise<{ notes: RetrievedNote[]; conversations: { id: string; score: number }[] }> {
    const none = { notes: [], conversations: [] };
    if (!this.enabled()) return none;
    try {
      const svc = this.ensure();
      if (!svc.isReady()) await svc.loadPersisted();
      const vectors = svc.vectorsOf(path);
      if (!vectors) return none;
      const floor = embeddingModelConfig(this.modelId()).relatedFloors[DEFAULT_SIMILARITY_PRESET];
      const notes = await svc.rankByVectors(vectors, { minScore: floor, limit, exclude: [path] });
      const conversations = await this.conversations
        .relatedToVectors(vectors, limit)
        .catch((e: unknown) => {
          this.logger.warn("semantic engine: related conversations failed", e);
          return [];
        });
      return { notes, conversations };
    } catch (e) {
      this.logger.warn("semantic engine: related failed", e);
      return none;
    }
  }

  /**
   * Get ready for a search that is about to be typed: the Explorer's filter
   * field got focus.
   *
   * A first search paid for everything at once — reading the index file, and
   * loading the model into a Worker, a second or more on a desktop — while
   * the person waited for the rows to appear. Started on focus, most of that
   * is done by the time a word has been typed. Only where the index already
   * exists: the model is not downloaded for someone who merely clicked the box.
   */
  warm(): void {
    if (!this.enabled() || this.warming || this.syncing) return;
    this.warming = true;
    void (async () => {
      try {
        if (!(await this.files().exists())) return;
        const svc = this.ensure();
        if (Platform.isMobile) {
          this.refresh(); // the phone reads the desktop's index
        } else if (!svc.isQueryable()) {
          await svc.loadPersisted();
          if (svc.isComplete(this.scope())) {
            await svc.hydrateForQuery();
            void this.flushDeferred();
          } else {
            this.refresh(); // an unfinished index resumes, as a search would
          }
        }
        await this.ensureProvider().ready();
        this.emit();
      } catch (e) {
        this.logger.debug("semantic engine: warm-up failed", e);
      } finally {
        this.warming = false;
      }
    })();
  }

  /** "Build now": finish or update the index, keeping its rows. */
  buildNow(): void {
    if (this.syncing) {
      new Notice(t().semantic.busy);
      return;
    }
    this.refresh({ force: true, manual: true });
  }

  /** "Rebuild": discard the rows and embed every note again. On a phone this is
   *  "Build now": the rows are the desktop's, and a phone that cleared them
   *  would leave both devices a budget's worth of index. */
  rebuild(): void {
    if (Platform.isMobile) {
      this.buildNow();
      return;
    }
    if (this.syncing) {
      new Notice(t().semantic.busy);
      return;
    }
    this.refresh({ force: true, manual: true, clear: true });
  }

  /** Where the index stands, for the settings tab. Never loads the model. */
  async status(): Promise<SemanticStatus> {
    const base: SemanticStatus = {
      state: "notBuilt",
      count: 0,
      done: 0,
      total: 0,
      error: null,
      outOfMemory: false,
      backend: this.backend
    };
    if (!this.getSettings().semanticSearchEnabled) return { ...base, state: "off" };
    if (this.blocked()) return { ...base, state: "blocked" };
    const phase = this.phase;
    if (phase.kind === "loading") return { ...base, state: "loading" };
    if (phase.kind === "building")
      return { ...base, state: "building", done: phase.done, total: phase.total };
    if (phase.kind === "failed") {
      return { ...base, state: "failed", error: phase.error, outOfMemory: phase.outOfMemory };
    }
    const scope = this.scope();
    if (this.service?.isComplete(scope))
      return { ...base, state: "ready", count: this.service.size() };
    if (this.fileCount === undefined) {
      try {
        const buf = await this.files().read();
        const meta = buf ? peekIndexMeta(buf) : null;
        this.fileCount = meta
          ? { scope: meta.scope, count: meta.count, complete: meta.complete }
          : null;
      } catch (e) {
        this.logger.warn("semantic engine: could not read the index for its status", e);
        this.fileCount = null;
      }
    }
    const file = this.fileCount;
    if (!this.guard.mayAutoBuild()) return { ...base, state: "paused", count: file?.count ?? 0 };
    if (Platform.isMobile && (!file || !file.complete))
      return {
        ...base,
        state: "desktopBuilds",
        count: file?.count ?? 0,
        budget: MOBILE_BUILD_BUDGET
      };
    if (!file || file.count === 0) return base;
    if (!file.complete) return { ...base, state: "partial", count: file.count };
    return { ...base, state: file.scope === scope ? "ready" : "outdated", count: file.count };
  }

  /**
   * The numbers behind the status line, for the settings: how much of the
   * vault the index covers and why the rest is not in it, the files, the
   * model, and the pace of the current or last build. Reads the index file if
   * this session has not, never loads the model.
   */
  async report(): Promise<Omit<IndexFacts, "text"> | null> {
    if (!this.enabled()) return null;
    const scope = this.scopeNotes();
    const files = this.files();
    let coverage = { indexed: 0, failed: 0, missing: scope.notes.length, passages: 0 };
    let signature: { keeper?: IndexKeeper; writtenAt?: number } = {};
    try {
      const svc = this.ensure();
      await svc.loadPersisted();
      coverage = svc.coverage(scope.notes.map((note) => note.path));
      signature = svc.signature();
    } catch (e) {
      this.logger.warn("semantic engine: could not read the index for its report", e);
    }
    const size = async (store: { size(): Promise<number | null> }): Promise<number | null> => {
      try {
        return await store.size();
      } catch {
        return null;
      }
    };
    return {
      model: embeddingModelConfig(this.modelId()).label,
      backend: this.backend,
      device: Platform.isMobile ? "mobile" : "desktop",
      vaultNotes: scope.vaultNotes,
      optedOut: scope.optedOut,
      overCap: scope.overCap,
      cap: this.getSettings().semanticMaxNotes,
      inScope: scope.notes.length,
      ...coverage,
      indexBytes: await size(files),
      journalBytes: await size(files.journal()),
      phoneJournalBytes: Platform.isMobile ? await size(files.phoneJournal()) : null,
      keeper: signature.keeper,
      writtenAt: signature.writtenAt,
      build: this.lastBuild ? { ...this.lastBuild } : null,
      search: this.lastSearch ? { ...this.lastSearch } : null
    };
  }

  /** The switch or the cap moved. Switched off, the model's memory is given
   *  back now rather than at the next restart; a build in flight finishes. */
  settingsChanged(): void {
    this.fileCount = undefined;
    // A deliberate change is a fresh start for automatic builds: a failure
    // otherwise kept them off for the session, whatever was changed. Not out
    // of memory, which a changed switch does not make any less likely.
    if (!this.syncing && this.phase.kind === "failed" && !this.phase.outOfMemory)
      this.phase = { kind: "idle" };
    // A conversation sync in flight holds the provider too; unloading under it
    // is what the build's own guard avoids. It finishes, and the next change
    // or restart gives the memory back.
    if (!this.enabled() && !this.syncing && !this.conversations.isSyncing()) this.teardown();
    this.emit();
  }

  /** Give the model and the index back: search by meaning is off. */
  private teardown(): void {
    this.provider?.unload();
    this.provider = null;
    this.providerModel = null;
    this.service = null;
    this.deferred = null;
    this.conversations.reset();
  }

  /** Plugin unload: a build cut short by unload is not a crash; held edits are written. */
  dispose(): void {
    if (this.syncing) this.guard.end();
    this.listeners.clear();
    // A build running now stops at its next note instead of running through
    // the vault after the plugin is gone, and the provider refuses to load the
    // model again for it: an unload alone made the next embed load a model
    // nobody held any more.
    this.stop.aborted = true;
    void this.service?.flushPendingWrites().catch((e: unknown) => {
      this.logger.warn("semantic engine: held edits could not be written at unload", e);
    });
    this.provider?.dispose();
  }
}
