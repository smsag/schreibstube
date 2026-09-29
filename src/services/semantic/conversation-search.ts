/**
 * Other plugins' items as answers to what is typed into the Explorer search.
 *
 * An item is not a file, so the search's own index never holds one. It is
 * found here two ways — by the words of its title, which needs nothing but the
 * listing, and by meaning, which needs the model — and the title comes first,
 * because an item called what was typed is the one being looked for.
 */

import { queryTokens, tokenize } from "../file-search";

export interface ConversationResult {
  id: string;
  title: string;
}

/** The most items one query shows from each source: they sit under the files,
 *  and a list longer than the files above it would bury them. Per source, so
 *  one whose titles happen to match cannot push every other one off. */
export const ITEM_RESULTS_PER_SOURCE = 10;

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
  limit = ITEM_RESULTS_PER_SOURCE
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
