/**
 * Pythia's conversations as answers to what is typed into the Explorer filter.
 *
 * A conversation is not a file, so the filter's own index never held one: a
 * chat about the Karussell naming was found by the Recommended panel beside a
 * note and by nothing a person typed. It is found here two ways — by the words
 * of its title, which needs nothing but the list, and by meaning, which needs
 * the model — and the title comes first, because a conversation called what
 * was typed is the one being looked for.
 */

import { queryTokens, tokenize } from "../file-search";

export interface ConversationResult {
  id: string;
  title: string;
}

/** The most conversations one query shows: they sit under the files, and a
 *  list longer than the files above it would bury them. */
export const CONVERSATION_RESULTS = 10;

/**
 * Conversations whose title holds every word typed.
 *
 * Inside a word as well as at its start, as the filter reads names: *Vertrag*
 * finds a chat called *Mietvertrag prüfen*.
 */
export function matchConversationTitles(
  query: string,
  conversations: readonly ConversationResult[]
): ConversationResult[] {
  const wanted = queryTokens(query);
  if (wanted.length === 0) return [];

  return conversations.filter((conversation) => {
    const words = tokenize(conversation.title);
    return wanted.every((token) => words.some((word) => word.includes(token)));
  });
}

/** Title matches first, then what meaning found, each conversation once. */
export function mergeConversationResults(
  byTitle: readonly ConversationResult[],
  byMeaning: readonly ConversationResult[],
  limit = CONVERSATION_RESULTS
): ConversationResult[] {
  const seen = new Set<string>();
  const out: ConversationResult[] = [];
  for (const result of [...byTitle, ...byMeaning]) {
    if (out.length >= limit) break;
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    out.push(result);
  }
  return out;
}
