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
    private readonly suffix = ".bin",
    /** Which index: the vault's notes, or the conversations a source hands over. */
    private readonly prefix: "semantic-notes" | "semantic-conversations" = "semantic-notes"
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

  async write(buf: ArrayBuffer): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    const dir = pluginDir(this.plugin);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.writeBinary(this.path, buf);
  }

  journal(): IndexStore {
    return new SemanticIndexFiles(this.plugin, this.modelId, ".journal.bin", this.prefix);
  }

  /**
   * Copy Pythia's vault index in, once, when this vault has none of its own.
   *
   * Same model family, same vectors: a vault Pythia already indexed starts
   * ready here instead of embedding every note again. The copy is taken as it
   * is; the next build under Schreibstube's own scope keeps every row whose
   * content still matches and embeds only the rest. Pythia's files are left
   * where they are.
   */
  async importFromPythia(): Promise<boolean> {
    if (await this.exists()) return false;
    const adapter = this.plugin.app.vault.adapter;
    const pythiaDir = normalizePath(`${this.plugin.app.vault.configDir}/plugins/pythia`);
    const family = vectorFamily(this.modelId);
    // Pythia's names for the same two indexes.
    const name = this.prefix === "semantic-notes" ? "vault-embeddings" : "related-embeddings";
    const base = normalizePath(`${pythiaDir}/${name}-${family}.bin`);
    if (!(await adapter.exists(base))) return false;
    await this.write(await adapter.readBinary(base));
    const journal = normalizePath(`${pythiaDir}/${name}-${family}.journal.bin`);
    if (await adapter.exists(journal))
      await this.journal().write(await adapter.readBinary(journal));
    return true;
  }
}

function pluginDir(plugin: Plugin): string {
  return normalizePath(
    plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`
  );
}
