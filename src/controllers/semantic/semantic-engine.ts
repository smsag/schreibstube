import { Notice, Platform, TFile, type Plugin } from "obsidian";
import type { SchreibstubeSettings } from "../../types";
import type { Logger } from "../../services/logger";
import { t } from "../../i18n";
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  effectiveEmbeddingModel,
  embedChunkChars,
  embeddingModelConfig,
  vectorFamily,
  type EmbeddingModelId
} from "../../services/semantic/embedding-models";
import type { SemanticStatus } from "../../services/semantic/status-text";
import {
  ResidentProvider,
  installEmbeddingResidency,
  type EmbeddingResidency
} from "../../services/semantic/residency";
import { VaultIndexService, type IndexableNote } from "../../services/semantic/vault-index-service";
import { hashPolicyFor } from "../../services/semantic/row-provenance";
import { decideBuild, shouldCatchUp } from "../../services/semantic/build-decision";
import { BuildGuard, vaultBuildGuard } from "../../services/semantic/build-guard";
import { isOutOfMemoryError } from "../../services/semantic/memory-error";
import { selectIndexPaths, scopeSignature } from "../../services/semantic/index-scope";
import { isIndexingOptedOut, type RetrievedNote } from "../../services/semantic/vault-retrieval";
import { catchUpIndex, CATCH_UP_DELAY_MS } from "../../services/semantic/vault-catch-up";
import { peekIndexMeta } from "../../services/semantic/embedding-index";
import { isCommunityPluginEnabled } from "../../services/workspace-internals";
import { createEmbeddingProvider } from "./host/embedding-provider-factory";
import { embeddingWorkerUrl } from "./host/worker-bundle-url";
import { SemanticIndexFiles } from "./index-files";
import { registerVaultWatcher } from "./vault-watcher";

/**
 * Below this, a note is not where the words were: a query scoring lower than
 * this against every passage of a note does not bring it up. Pythia's measured
 * vault-retrieval floor for its "balanced" preset, kept as is: it was measured
 * for this model on notes, and a guess here would be a guess.
 */
export const SEMANTIC_MIN_SCORE = 0.35;

/** Frontmatter a note carries to stay out of the index. */
const OPT_OUT_KEY = "schreibstubeIndex";

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
  private imported = false;
  private backend: string | null = null;
  private deferred: { changed: Map<string, TFile>; deleted: Set<string> } | null = null;
  private fileCount: { scope: string; count: number; complete: boolean } | null | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly plugin: Plugin,
    private readonly getSettings: () => SchreibstubeSettings,
    private readonly logger: Logger
  ) {
    this.guard = vaultBuildGuard(plugin.app);
  }

  /** Register the vault watcher, the phone's residency rule and the launch catch-up. */
  start(): void {
    registerVaultWatcher(this.plugin, {
      applyChanges: (changed, deleted) => void this.applyChanges(changed, deleted),
      activePath: () => this.plugin.app.workspace.getActiveFile()?.path ?? null
    });
    this.residency = installEmbeddingResidency(this.plugin, {
      provider: () => this.provider,
      building: () => this.syncing,
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
    return Platform.isMobile && isCommunityPluginEnabled(this.plugin.app, "pythia");
  }

  private enabled(): boolean {
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
        logger: this.logger
      });
    }
    return this.service;
  }

  /** Pythia's index, copied in once when this vault has none of its own. */
  private async importOnce(): Promise<void> {
    if (this.imported) return;
    this.imported = true;
    try {
      if (await this.files().importFromPythia()) {
        this.fileCount = undefined;
        this.logger.info("semantic engine: imported Pythia's vault index");
      }
    } catch (e) {
      this.logger.warn("semantic engine: could not import Pythia's vault index", e);
    }
  }

  /** The notes the index should hold, newest first, capped and opted out. */
  private collectNotes(): IndexableNote[] {
    const app = this.plugin.app;
    const files = app.vault
      .getMarkdownFiles()
      .filter((file) => {
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        return !isIndexingOptedOut(frontmatter) && frontmatter?.[OPT_OUT_KEY] !== false;
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    const byPath = new Map(files.map((file) => [file.path, file]));
    const { paths } = selectIndexPaths(
      files.map((file) => file.path),
      { include: [], skip: [], cap: this.getSettings().semanticMaxNotes }
    );
    return paths.flatMap((path) => {
      const file = byPath.get(path);
      return file ? [{ path, load: () => app.vault.cachedRead(file) }] : [];
    });
  }

  /**
   * Build or finish the index in the background (Pythia ADR-118/199/203).
   *
   * Never awaited by a search: a search against an index that is not ready
   * returns nothing from this side and the keyword results stand alone.
   */
  refresh(opts: { force?: boolean; manual?: boolean; clear?: boolean } = {}): void {
    if (!this.enabled() || this.syncing) return;
    const decision = decideBuild(opts, {
      syncing: false,
      complete: this.service?.isComplete(this.scope()) ?? false,
      mayAutoBuild: this.guard.mayAutoBuild(),
      loadFailed: this.phase.kind === "failed" && this.phase.loadFailed
    });
    if (!decision.run) return;
    if (opts.manual) this.guard.end();
    this.syncing = true;
    this.guard.start(this.modelId());
    this.setPhase({ kind: "loading" });
    void this.build(opts, decision.reloadProvider);
  }

  private async build(
    opts: { force?: boolean; clear?: boolean },
    reloadProvider: boolean
  ): Promise<void> {
    let loaded = false;
    let notice: Notice | null = null;
    try {
      await this.importOnce();
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
          await this.flushDeferred();
          return;
        }
      }
      const notes = this.collectNotes();
      notice = new Notice(t().semantic.building, 0);
      this.setPhase({ kind: "building", done: 0, total: notes.length });
      await svc.sync(
        notes,
        (done, total) => {
          notice?.setMessage(t().semantic.progress(done, total));
          this.setPhase({ kind: "building", done, total });
        },
        offThread ? {} : { yieldEveryNotes: 1, breatherMs: 12 },
        scope
      );
      this.guard.end();
      this.setPhase({ kind: "idle" });
      await this.flushDeferred();
    } catch (e) {
      const outOfMemory = isOutOfMemoryError(e);
      if (!outOfMemory) this.guard.end();
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
      this.emit();
    }
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
    await this.importOnce();
    if (!(await this.files().exists())) return;
    this.syncing = true;
    try {
      const result = await catchUpIndex({
        service: () => this.ensure(),
        scope: () => this.scope(),
        notes: () => this.collectNotes(),
        modelId: () => this.modelId(),
        guard: this.guard,
        onProgress: (done, total) => this.setPhase({ kind: "building", done, total })
      });
      this.setPhase({ kind: "idle" });
      await this.flushDeferred();
      this.logger.debug("semantic engine: catch-up", result);
    } catch (e) {
      this.setPhase({
        kind: "failed",
        error: e instanceof Error ? e.message : String(e),
        outOfMemory: isOutOfMemoryError(e),
        loadFailed: false
      });
      this.logger.warn("semantic engine: catch-up failed", e);
    } finally {
      this.syncing = false;
      this.fileCount = undefined;
      this.emit();
    }
  }

  /** Targeted updates from the vault watcher; held while the index is not ready. */
  async applyChanges(changed: TFile[], deleted: string[]): Promise<void> {
    if (!this.enabled()) return;
    const svc = this.service;
    if (!svc?.isReady()) {
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
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      if (isIndexingOptedOut(frontmatter) || frontmatter?.[OPT_OUT_KEY] === false) {
        removes.push(file.path);
      } else {
        updates.push({ path: file.path, load: () => app.vault.cachedRead(file) });
      }
    }
    await svc.applyBatch({ updates, removes }, { cap: this.getSettings().semanticMaxNotes });
    this.fileCount = undefined;
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
   * Notes whose meaning answers `text`, best first. Starts a build and answers
   * nothing while the index is not ready; the keyword results stand alone then.
   */
  async search(text: string, limit: number): Promise<RetrievedNote[]> {
    if (!this.enabled()) return [];
    const svc = this.service;
    if (!svc?.isReady()) {
      this.refresh();
      return [];
    }
    try {
      return await svc.query(text, { minScore: SEMANTIC_MIN_SCORE, limit });
    } catch (e) {
      this.logger.warn("semantic engine: search failed", e);
      return [];
    }
  }

  /** "Build now": finish or update the index, keeping its rows. */
  buildNow(): void {
    if (this.syncing) {
      new Notice(t().semantic.busy);
      return;
    }
    this.refresh({ force: true, manual: true });
  }

  /** "Rebuild": discard the rows and embed every note again. */
  rebuild(): void {
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
    if (!file || file.count === 0) return base;
    if (!file.complete) return { ...base, state: "partial", count: file.count };
    return { ...base, state: file.scope === scope ? "ready" : "outdated", count: file.count };
  }

  /** The switch or the cap moved. Switched off, the model's memory is given
   *  back now rather than at the next restart; a build in flight finishes. */
  settingsChanged(): void {
    this.fileCount = undefined;
    if (!this.enabled() && !this.syncing) {
      this.provider?.unload();
      this.provider = null;
      this.providerModel = null;
      this.service = null;
      this.deferred = null;
    }
    this.emit();
  }

  /** Plugin unload: a build cut short by unload is not a crash; held edits are written. */
  dispose(): void {
    if (this.syncing) this.guard.end();
    this.listeners.clear();
    void this.service?.flushPendingWrites().catch((e: unknown) => {
      this.logger.warn("semantic engine: held edits could not be written at unload", e);
    });
    this.provider?.unload();
  }
}
