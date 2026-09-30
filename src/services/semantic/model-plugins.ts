/**
 * Plugins known to load a language model of their own. On a phone,
 * Schreibstube's model does not join one of theirs: two runtimes are more
 * than iOS lets Obsidian hold, and it restarts the app rather than say so.
 * Measured on an iPhone: Obsidian with Similarity's model stood at 1.4 GB
 * after its start, and Schreibstube's model on top passed the 2 GB line.
 *
 * Pythia first: it says so itself (see `pluginRunsOwnModel`), and a Pythia
 * that asks Schreibstube instead loads none.
 */
export const OWN_MODEL_PLUGINS: readonly { id: string; name: string }[] = [
  { id: "pythia", name: "Pythia" },
  { id: "similarity", name: "Similarity" }
];

/** The name of the first known plugin running a model of its own, or null. */
export function modelPluginInTheWay(runsOwnModel: (id: string) => boolean): string | null {
  return OWN_MODEL_PLUGINS.find((p) => runsOwnModel(p.id))?.name ?? null;
}
