/**
 * Conversations another plugin hands over to be found by meaning.
 *
 * Pythia keeps its chats in its own data file, out of the vault, so the vault
 * index never sees them. It lists them through the API instead, and what it
 * lists is input from outside this plugin: untrusted until checked here. Every
 * field is coerced, every text is bounded, and the list is capped, so a broken
 * or hostile source can cost at most a known amount of memory and embedding.
 *
 * The chunking is Pythia's own (its `conversationChunks`), unchanged: a lead
 * chunk of title and summary, then the messages packed to the chunk size. The
 * same text gives the same chunks and so the same content hash, which is what
 * lets an index Pythia built be taken over without embedding anything again.
 */

/** At most this many conversations are indexed, the newest first. */
export const MAX_CONVERSATIONS = 1000;
/** At most this much text per conversation, title and summary included. */
export const MAX_CONVERSATION_CHARS = 40_000;
const MAX_ID_CHARS = 200;
const MAX_TITLE_CHARS = 300;

/** Pythia's chunk size for conversations, at which its related floors were measured. */
export const CONVERSATION_CHUNK_CHARS = 500;

export interface ConversationItem {
  id: string;
  title: string;
  updatedAt: number;
  summary: string;
  messages: string[];
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** One listed conversation, checked and bounded, or null when it has no id. */
export function normalizeConversation(raw: unknown): ConversationItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = text(record.id).trim();
  if (id.length === 0 || id.length > MAX_ID_CHARS) return null;
  const title = text(record.title).trim().slice(0, MAX_TITLE_CHARS);
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;

  let budget = MAX_CONVERSATION_CHARS - title.length;
  const take = (value: string): string => {
    const kept = value.slice(0, Math.max(0, budget));
    budget -= kept.length;
    return kept;
  };
  const summary = take(text(record.summary));
  const messages: string[] = [];
  for (const message of Array.isArray(record.messages) ? record.messages : []) {
    if (budget <= 0) break;
    const kept = take(text(message));
    if (kept.length > 0) messages.push(kept);
  }
  return { id, title, updatedAt, summary, messages };
}

/** The whole list: each entry checked, one per id, the newest first, capped. */
export function normalizeConversations(raw: unknown): ConversationItem[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, ConversationItem>();
  for (const entry of raw) {
    const item = normalizeConversation(entry);
    if (item && !byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
}

/**
 * The text chunks a conversation is embedded as. Pythia's rule exactly: title
 * and summary lead, as a dense fingerprint of the topic; then the messages,
 * packed to `maxChars`, with one too long for a chunk split hard.
 */
export function conversationChunks(
  item: ConversationItem,
  maxChars = CONVERSATION_CHUNK_CHARS
): string[] {
  const chunks: string[] = [];
  const lead = [item.title, item.summary]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(". ")
    .trim();
  if (lead) chunks.push(lead);

  let buf = "";
  const flush = (): void => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
  };
  for (const message of item.messages) {
    let rest = message.trim();
    if (!rest) continue;
    while (rest.length > maxChars) {
      flush();
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (buf && buf.length + rest.length + 1 > maxChars) flush();
    buf = buf ? `${buf}\n${rest}` : rest;
  }
  flush();

  if (chunks.length === 0) chunks.push(item.title || item.id);
  return chunks;
}
