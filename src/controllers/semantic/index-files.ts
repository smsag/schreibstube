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
    return this.plugin.app.vault.adapter.exists(this.path);
  }

  async read(): Promise<ArrayBuffer | null> {
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(this.path))) return null;
    return adapter.readBinary(this.path);
  }

  /** Written beside the file and renamed over it, so a write cut short — the
   *  app ended mid-build, a full disk — leaves the last whole index in place
   *  rather than a truncated one that reads as "no index" and rebuilds. */
  async write(buf: ArrayBuffer): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    const dir = pluginDir(this.plugin);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const tmp = `${this.path}.tmp`;
    if (await adapter.exists(tmp)) await adapter.remove(tmp);
    await adapter.writeBinary(tmp, buf);
    await adapter.rename(tmp, this.path);
  }

  journal(): SemanticIndexFiles {
    return new SemanticIndexFiles(this.plugin, this.modelId, ".journal.bin", this.prefix);
  }

  /** The phone's own edits to an index the desktop keeps; only a phone reads it. */
  phoneJournal(): SemanticIndexFiles {
    return new SemanticIndexFiles(this.plugin, this.modelId, ".phone-journal.bin", this.prefix);
  }

  async mtime(): Promise<number | null> {
    const stat = await this.plugin.app.vault.adapter.stat(this.path);
    return stat?.mtime ?? null;
  }

  /** The size of this file in bytes, or null when there is none. */
  async size(): Promise<number | null> {
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

function pluginDir(plugin: Plugin): string {
  return normalizePath(
    plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`
  );
}
