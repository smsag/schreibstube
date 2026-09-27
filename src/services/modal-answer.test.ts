import { describe, expect, it } from "vitest";
import { modalAnswer } from "./modal-answer";

describe("modalAnswer", () => {
  it("keeps a choice reported after the dialog closed, as Obsidian reports it", async () => {
    const answer = new Promise<string | null>((resolve) => {
      const once = modalAnswer<string | null>(resolve);
      // SuggestModal.selectSuggestion: close() first, onChooseSuggestion second.
      once.closed(null);
      once.choose("Lebenslauf");
    });
    await expect(answer).resolves.toBe("Lebenslauf");
  });

  it("answers with the dismissal when the dialog closes without a choice", async () => {
    const answer = new Promise<string | null>((resolve) => modalAnswer(resolve).closed(null));
    await expect(answer).resolves.toBeNull();
  });

  it("gives one answer only", async () => {
    const seen: (string | null)[] = [];
    const once = modalAnswer<string | null>((value) => seen.push(value));
    once.choose("Brief");
    once.closed(null);
    once.choose("Lebenslauf");
    await Promise.resolve();
    expect(seen).toEqual(["Brief"]);
  });
});
