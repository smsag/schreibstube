import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_KEYS,
  MAX_DESCRIPTION_CHARS,
  MAX_DESCRIPTION_TITLE,
  MAX_KEYWORDS,
  DEFAULT_DESCRIPTION_FOLDER,
  normalizeDescriptionFolder,
  descriptionNotePath,
  descriptionSystemPrompt,
  hashImageBytes,
  normalizeImageDescription,
  renderDescriptionNote,
  sanitizeDescriptionText,
  type ImageDescription
} from "./image-description";

const reply = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    title: "Offene Küche mit Kochinsel",
    description: "Offene Küche mit weißer Kochinsel und Eichenparkett.",
    keywords: ["Küche", "Kochinsel", "Eichenparkett"],
    visibleText: "",
    ...over
  });

describe("descriptionSystemPrompt", () => {
  it("names the language and every bound the answer is held to", () => {
    const prompt = descriptionSystemPrompt("de");
    expect(prompt).toContain("German");
    expect(prompt).toContain(String(MAX_DESCRIPTION_TITLE));
    expect(prompt).toContain(String(MAX_DESCRIPTION_CHARS));
    expect(prompt).toContain(String(MAX_KEYWORDS));
    expect(descriptionSystemPrompt("en")).toContain("English");
  });

  it("asks the model not to identify people or read out personal data", () => {
    expect(descriptionSystemPrompt("de")).toMatch(/Do not name or guess who a person is/);
    expect(descriptionSystemPrompt("de")).toMatch(/licence plates/);
  });
});

describe("normalizeImageDescription — the model's answer is untrusted input", () => {
  it("reads a well-formed answer", () => {
    expect(normalizeImageDescription(reply())).toEqual({
      title: "Offene Küche mit Kochinsel",
      description: "Offene Küche mit weißer Kochinsel und Eichenparkett.",
      keywords: ["Küche", "Kochinsel", "Eichenparkett"],
      visibleText: ""
    });
  });

  it("finds the object inside a code fence or chatter", () => {
    expect(normalizeImageDescription("Here you go:\n```json\n" + reply() + "\n```")?.title).toBe(
      "Offene Küche mit Kochinsel"
    );
  });

  it.each([
    ["no JSON at all", "A kitchen."],
    ["broken JSON", "{ title: kitchen"],
    ["an array", "[1, 2]"],
    ["no title", reply({ title: "" })],
    ["no description", reply({ description: "   " })],
    ["a title that is not text", reply({ title: 42 })]
  ])("refuses %s whole, rather than write half a description", (_why, raw) => {
    expect(normalizeImageDescription(raw)).toBeNull();
  });

  it("holds every field to its bound", () => {
    const long = normalizeImageDescription(
      reply({
        title: "T".repeat(500),
        description: "D".repeat(5000),
        keywords: Array.from({ length: 40 }, (_, i) => `k${i}${"x".repeat(100)}`)
      })
    )!;
    expect(long.title.length).toBeLessThanOrEqual(MAX_DESCRIPTION_TITLE);
    expect(long.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    expect(long.keywords).toHaveLength(MAX_KEYWORDS);
    expect(long.keywords.every((k) => k.length <= 40)).toBe(true);
  });

  it("drops keywords that are not text, empty, or repeated in another case", () => {
    const out = normalizeImageDescription(
      reply({ keywords: ["Küche", "küche", "", 7, null, "Bad"] })
    );
    expect(out?.keywords).toEqual(["Küche", "Bad"]);
  });

  it("makes the title one line without a trailing full stop", () => {
    expect(normalizeImageDescription(reply({ title: "Küche\nmit Insel." }))?.title).toBe(
      "Küche mit Insel"
    );
  });
});

describe("sanitizeDescriptionText — nothing a note would act on", () => {
  it.each([
    ["a wikilink", "see [[Secret note]] here", "see Secret note here"],
    ["a tag", "a #tag and #another", "a tag and another"],
    ["a heading", "# Heading", "Heading"],
    ["a frontmatter fence", "a\n---\nb", "a\n\nb"],
    ["HTML", '<img src="x" onerror="y">text<b>bold</b>', "textbold"]
  ])("takes out %s", (_what, input, expected) => {
    expect(sanitizeDescriptionText(input)).toBe(expected);
  });
});

describe("hashImageBytes", () => {
  it("is sixteen hex digits, stable, and changes with one byte", () => {
    const a = hashImageBytes(Uint8Array.from([1, 2, 3]));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hashImageBytes(Uint8Array.from([1, 2, 3]))).toBe(a);
    expect(hashImageBytes(Uint8Array.from([1, 2, 4]))).not.toBe(a);
  });
});

describe("descriptionNotePath", () => {
  it("puts the note in the shared folder, named after the picture", () => {
    expect(descriptionNotePath("Bildbeschreibungen", "Objekte/Seeblick/kueche-01.jpg")).toMatch(
      /^Bildbeschreibungen\/kueche-01\.jpg – [0-9a-f]{8}\.md$/
    );
  });

  it("keeps two pictures of the same name in different folders apart", () => {
    expect(descriptionNotePath("B", "A/x.jpg")).not.toBe(descriptionNotePath("B", "C/x.jpg"));
  });

  it("tolerates a trailing slash and the vault root", () => {
    expect(descriptionNotePath("B/", "x.jpg")).toMatch(/^B\/x\.jpg – /);
    expect(descriptionNotePath("", "x.jpg")).toMatch(/^x\.jpg – /);
  });
});

describe("renderDescriptionNote", () => {
  const image = {
    path: "Objekte/Seeblick/kueche-01.jpg",
    hash: "3fa29c1e9b7d40aa",
    size: 2481152,
    describedAt: "2026-09-26T10:14:03Z"
  };
  const desc: ImageDescription = {
    title: 'Küche "offen"',
    description: "Offene Küche.",
    keywords: ["Küche", "Kochinsel"],
    visibleText: ""
  };

  it("writes the pairing link, fingerprint and keywords under Schreibstube's keys", () => {
    const note = renderDescriptionNote(image, desc);
    expect(note).toContain(`${DESCRIPTION_KEYS.image}: "[[Objekte/Seeblick/kueche-01.jpg]]"`);
    expect(note).toContain(`${DESCRIPTION_KEYS.hash}: "3fa29c1e9b7d40aa"`);
    expect(note).toContain(`${DESCRIPTION_KEYS.size}: 2481152`);
    expect(note).toContain(`${DESCRIPTION_KEYS.keywords}:\n  - "Küche"\n  - "Kochinsel"`);
    expect(note).not.toContain("tags:");
  });

  it("quotes a title safely for YAML", () => {
    expect(renderDescriptionNote(image, desc)).toContain('title: "Küche \\"offen\\""');
  });

  it("embeds the picture first and repeats the keywords in the body", () => {
    const body = renderDescriptionNote(image, desc).split("---\n")[2]!;
    expect(body.trimStart().startsWith("![[Objekte/Seeblick/kueche-01.jpg]]")).toBe(true);
    expect(body).toContain("Stichworte: Küche, Kochinsel");
    expect(body).toContain("Sichtbarer Text: –");
  });

  it("writes Obsidian tags only when asked", () => {
    expect(
      renderDescriptionNote(
        image,
        { ...desc, keywords: ["Offene Küche"] },
        { keywordsAsTags: true }
      )
    ).toContain('tags:\n  - "Offene-Küche"');
  });

  it("labels the body in English when the descriptions are English", () => {
    expect(renderDescriptionNote(image, desc, { language: "en" })).toContain(
      "Keywords: Küche, Kochinsel"
    );
  });

  it("writes an empty keyword list as a list", () => {
    expect(renderDescriptionNote(image, { ...desc, keywords: [] })).toContain(
      `${DESCRIPTION_KEYS.keywords}: []`
    );
  });
});

describe("normalizeDescriptionFolder — a hand-edited data.json must not choose where notes land", () => {
  it.each([
    ["a plain folder", "Bilder", "Bilder"],
    ["slashes at either end and doubled", "/Archiv//Bilder/", "Archiv/Bilder"],
    ["backslashes", "Archiv\\Bilder", "Archiv/Bilder"],
    ["spaces around segments", " Archiv / Bilder ", "Archiv/Bilder"]
  ])("keeps %s", (_what, input, expected) => {
    expect(normalizeDescriptionFolder(input)).toBe(expected);
  });

  it.each([
    ["a parent segment", "../outside"],
    ["a dot segment", "Bilder/./x"],
    ["nothing", ""],
    ["only slashes", "///"],
    ["not a string", 42]
  ])("falls back to the default for %s", (_what, input) => {
    expect(normalizeDescriptionFolder(input)).toBe(DEFAULT_DESCRIPTION_FOLDER);
  });
});
