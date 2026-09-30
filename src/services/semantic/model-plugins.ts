/**
 * Plugins known to load a language model of their own. On a phone,
 * Schreibstube's model does not join one of theirs: two runtimes are more
 * than iOS lets Obsidian hold, and it restarts the app rather than say so.
 * Measured on an iPhone: Obsidian with Similarity's model stood at 1.4 GB
 * after its start, and Schreibstube's model on top passed the 2 GB line.
 *
 * EVERY plugin that loads a model of its own belongs on this list — one that
 * is missing is a phone that restarts every few seconds, with no message to
 * say why. A plugin can take itself off by declaring
 * `ownsEmbeddingModel = false` once it asks Schreibstube instead (see
 * `pluginRunsOwnModel`); Pythia does, since 3.9, and so is not listed.
 */
export const OWN_MODEL_PLUGINS: readonly { id: string; name: string }[] = [
  { id: "similarity", name: "Similarity" }
];

/** The name of the first known plugin running a model of its own, or null. */
export function modelPluginInTheWay(runsOwnModel: (id: string) => boolean): string | null {
  return OWN_MODEL_PLUGINS.find((p) => runsOwnModel(p.id))?.name ?? null;
}
