import { describe, expect, it } from "vitest";
import { obsidianFileUrl, pythiaConversationUrl } from "./obsidian-url";

describe("obsidianFileUrl", () => {
  it("leaves a note's .md off, as Obsidian's own Copy Obsidian URL does", () => {
    expect(obsidianFileUrl("vault", "Docs/Pythia readme.md")).toBe(
      "obsidian://open?vault=vault&file=Docs%2FPythia%20readme"
    );
  });

  it("keeps every other extension, a picture's included", () => {
    expect(obsidianFileUrl("vault", "_inbox/wochenplan.png")).toBe(
      "obsidian://open?vault=vault&file=_inbox%2Fwochenplan.png"
    );
    expect(obsidianFileUrl("vault", "Plan.excalidraw.md")).toBe(
      "obsidian://open?vault=vault&file=Plan.excalidraw"
    );
  });

  it("encodes the vault and the path, so a space, an ampersand or an umlaut cannot break the link", () => {
    expect(obsidianFileUrl("Mein Vault", "Büro & Co/Gehalt.md")).toBe(
      "obsidian://open?vault=Mein%20Vault&file=B%C3%BCro%20%26%20Co%2FGehalt"
    );
  });

  it("does not take .md from the middle of a name", () => {
    expect(obsidianFileUrl("v", "notes.md.bak")).toBe("obsidian://open?vault=v&file=notes.md.bak");
  });
});

describe("pythiaConversationUrl", () => {
  it("is Pythia's own resume link", () => {
    expect(pythiaConversationUrl("Mein Vault", "c 1&2")).toBe(
      "obsidian://pythia?vault=Mein%20Vault&cmd=resume&id=c%201%262"
    );
  });
});
