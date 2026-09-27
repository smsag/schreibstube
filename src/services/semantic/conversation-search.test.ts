import { describe, expect, it } from "vitest";
import {
  CONVERSATION_RESULTS,
  matchConversationTitles,
  mergeConversationResults
} from "./conversation-search";

const chats = [
  { id: "a", title: "Karussell naming candidates" },
  { id: "b", title: "Mietvertrag prüfen" },
  { id: "c", title: "Hausverwaltung Fristsetzung" }
];

describe("matchConversationTitles", () => {
  it("finds a conversation by a word of its title, in any case", () => {
    expect(matchConversationTitles("karussell", chats).map((c) => c.id)).toEqual(["a"]);
  });

  it("finds a word inside a compound", () => {
    expect(matchConversationTitles("vertrag", chats).map((c) => c.id)).toEqual(["b"]);
  });

  it("needs every word typed", () => {
    expect(matchConversationTitles("karussell frist", chats)).toEqual([]);
    expect(matchConversationTitles("hausverwaltung frist", chats).map((c) => c.id)).toEqual(["c"]);
  });

  it("finds nothing for an empty query", () => {
    expect(matchConversationTitles("  ", chats)).toEqual([]);
  });
});

describe("mergeConversationResults", () => {
  it("puts title matches first and lists each conversation once", () => {
    const merged = mergeConversationResults([chats[1]!], [chats[0]!, chats[1]!]);
    expect(merged.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), title: `Chat ${i}` }));
    expect(mergeConversationResults(many, [])).toHaveLength(CONVERSATION_RESULTS);
  });
});
