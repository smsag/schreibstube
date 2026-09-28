#!/usr/bin/env node
/**
 * Measure the floors a conversation clears to be recommended beside a note.
 *
 * Reads the two index files Schreibstube keeps in a vault's plugin folder,
 * compares every note with every other note and with every conversation (the
 * best section pair, as Recommended does), and prints, for each preset, the
 * conversation floor that lets conversations through at the rate the note
 * floor lets notes through. Those are the numbers in `conversationFloors`.
 *
 * Usage:
 *   node scripts/measure-conversation-floors.mjs "<vault>/.obsidian/plugins/schreibstube" [model-id]
 *
 * Reads only. The index files are the plugin's own format, decoded with the
 * plugin's own code, bundled on the fly so this stays in step with it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const [folder, model = "xenova-paraphrase-multilingual-MiniLM-L12-v2"] = process.argv.slice(2);
if (!folder) {
  console.error("Usage: measure-conversation-floors.mjs <plugin folder> [model-id]");
  process.exit(1);
}

const source = (name) =>
  fileURLToPath(new URL(`../src/services/semantic/${name}.ts`, import.meta.url));
const bundled = await build({
  stdin: {
    contents: `export { deserializeIndex } from ${JSON.stringify(source("embedding-index"))};
export { maxPairwiseCosine } from ${JSON.stringify(source("vector-math"))};
export { embeddingModelConfig } from ${JSON.stringify(source("embedding-models"))};`,
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "warning"
});
const code = bundled.outputFiles[0]?.text ?? "";
const { deserializeIndex, maxPairwiseCosine, embeddingModelConfig } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

const load = (kind) => {
  const bytes = readFileSync(join(folder, `semantic-${kind}-${model}.bin`));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return deserializeIndex(buffer).items.filter((item) => item.chunks.length > 0);
};

const notes = load("notes");
const conversations = load("conversations");
const noteScores = [];
const conversationScores = [];
for (const note of notes) {
  for (const other of notes) {
    if (other.id !== note.id) noteScores.push(maxPairwiseCosine(note.chunks, other.chunks));
  }
  for (const conversation of conversations) {
    conversationScores.push(maxPairwiseCosine(note.chunks, conversation.chunks));
  }
}
conversationScores.sort((a, b) => b - a);

const rate = (scores, floor) => scores.filter((score) => score >= floor).length / scores.length;
const percent = (share) => `${(share * 100).toFixed(2)} %`;

console.log(`${notes.length} notes, ${conversations.length} conversations, model ${model}`);
for (const [preset, floor] of Object.entries(embeddingModelConfig(model).relatedFloors)) {
  const target = rate(noteScores, floor);
  const at = Math.max(0, Math.round(target * conversationScores.length) - 1);
  const matched = conversationScores[at] ?? floor;
  console.log(
    `${preset}: notes clear ${floor} at ${percent(target)}; ` +
      `conversations clear ${matched.toFixed(3)} at ${percent(rate(conversationScores, matched))}`
  );
}
