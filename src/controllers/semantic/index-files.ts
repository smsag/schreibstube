import { normalizePath, type Plugin } from "obsidian";
import type { IndexStore } from "../../services/semantic/index-store";
import { vectorFamily, type EmbeddingModelId } from "../../services/semantic/embedding-models";

/**
 * The semantic index as files in Schreibstube's plugin folder: one per model
 * family, with its journal beside it. The family, not the variant, so a phone
 * running the Latin-script variant reads the file a desktop wrote.
 */
export class SemanticIndexFiles implements IndexStore {
  private readonly path: string;
  /** Put back at most once per instance: only a write cut short leaves it. */
  private restored: Promise<void> | null = null;

  constructor(
    private readonly plugin: Plugin,
    private readonly modelId: EmbeddingModelId,
    suffix = ".bin",
    /** Which index: the vault's notes, or the conversations a source hands over. */
    private readonly prefix: "semantic-notes" | `semantic-source-${string}` = "semantic-notes"
  ) {
    this.path = normalizePath(`${pluginDir(plugin)}/${prefix}-${vectorFamily(modelId)}${suffix}`);
  }

  async exists(): Promise<boolean> {
    await this.restore();
    return this.plugin.app.vault.adapter.exists(this.path);
  }

  async read(): Promise<ArrayBuffer | null> {
    await this.restore();
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(this.path))) return null;
    return adapter.readBinary(this.path);
  }

  /** Written beside the file and moved into its place, so a write cut short —
   *  the app ended mid-build, a full disk — leaves the last whole index in
   *  place rather than a truncated one that reads as "no index" and rebuilds.
   *  Obsidian's rename refuses a destination that exists, so the old index is
   *  moved aside first and removed only once the new one stands. */
  async write(buf: ArrayBuffer): Promise<void> {
    await this.restore();
    const adapter = this.plugin.app.vault.adapter;
    const dir = pluginDir(this.plugin);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const tmp = `${this.path}.tmp`;
    const old = `${this.path}.old`;
    if (await adapter.exists(tmp)) await adapter.remove(tmp);
    await adapter.writeBinary(tmp, buf);
    const replacing = await adapter.exists(this.path);
    if (replacing) {
      if (await adapter.exists(old)) await adapter.remove(old);
      await adapter.rename(this.path, old);
    }
    await adapter.rename(tmp, this.path);
    if (replacing) await adapter.remove(old);
  }

  /** A write cut short between moving the old index aside and moving the new
   *  one in leaves only the old one, whole: it is the index until the next
   *  write replaces it. */
  private restore(): Promise<void> {
    this.restored ??= (async () => {
      const adapter = this.plugin.app.vault.adapter;
      const old = `${this.path}.old`;
      if (!(await adapter.exists(this.path)) && (await adapter.exists(old)))
        await adapter.rename(old, this.path);
    })();
    return this.restored;
  }

  journal(): SemanticIndexFiles {
    return new SemanticIndexFiles(this.plugin, this.modelId, ".journal.bin", this.prefix);
  }

  /** The phone's own edits to an index the desktop keeps; only a phone reads it. */
  phoneJournal(): SemanticIndexFiles {
    return new SemanticIndexFiles(this.plugin, this.modelId, ".phone-journal.bin", this.prefix);
  }

  async mtime(): Promise<number | null> {
    await this.restore();
    const stat = await this.plugin.app.vault.adapter.stat(this.path);
    return stat?.mtime ?? null;
  }

  /** The size of this file in bytes, or null when there is none. */
  async size(): Promise<number | null> {
    await this.restore();
    const stat = await this.plugin.app.vault.adapter.stat(this.path);
    return stat?.size ?? null;
  }
}

/**
 * Remove the conversation index API version 1 kept in one file for its one
 * source. Each source now has a file of its own, so that one is read by
 * nothing; Pythia's items are embedded again once, into their new file.
 */
export async function removeRetiredIndexFiles(plugin: Plugin): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const dir = pluginDir(plugin);
  if (!(await adapter.exists(dir))) return;
  const listed = await adapter.list(dir);
  for (const path of listed.files) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name.startsWith("semantic-conversations-") && name.endsWith(".bin")) {
      await adapter.remove(path);
    }
  }
}

/**
 * Remove every index file a source left, for every model: a source the
 * person refused, or one they forgot, keeps nothing on this device.
 */
export async function removeSourceFiles(plugin: Plugin, sourceId: string): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const dir = pluginDir(plugin);
  if (!(await adapter.exists(dir))) return;
  const prefix = `semantic-source-${sourceId}-`;
  for (const path of (await adapter.list(dir)).files) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name.startsWith(prefix)) await adapter.remove(path);
  }
}

function pluginDir(plugin: Plugin): string {
  return normalizePath(
    plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`
  );
}
