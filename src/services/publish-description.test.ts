import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX_INPUT_CHARS,
  descriptionUserMessage,
  leavesDescriptionToModel,
  MAX_DESCRIPTION_CHARS,
  parseDescriptionResponse
} from "./publish-description";
import { DEFAULT_PUBLISH_KEYS } from "./publish-index";

const keys = DEFAULT_PUBLISH_KEYS;

describe("leavesDescriptionToModel", () => {
  it("leaves it to the model when the key is absent or holds nothing", () => {
    expect(leavesDescriptionToModel({ published: true }, keys)).toBe(true);
    expect(leavesDescriptionToModel({ description: null }, keys)).toBe(true);
    expect(leavesDescriptionToModel({ description: "" }, keys)).toBe(true);
    expect(leavesDescriptionToModel({ description: [] }, keys)).toBe(true);
    expect(leavesDescriptionToModel(undefined, keys)).toBe(true);
  });

  it("keeps any character the person put there, whitespace included", () => {
    expect(leavesDescriptionToModel({ description: " " }, keys)).toBe(false);
    expect(leavesDescriptionToModel({ description: "\t" }, keys)).toBe(false);
    expect(leavesDescriptionToModel({ description: "\n" }, keys)).toBe(false);
    expect(leavesDescriptionToModel({ description: "Kurz." }, keys)).toBe(false);
  });

  it("keeps a value of any other kind, which is something too", () => {
    expect(leavesDescriptionToModel({ description: 0 }, keys)).toBe(false);
    expect(leavesDescriptionToModel({ description: false }, keys)).toBe(false);
    expect(leavesDescriptionToModel({ description: ["Kurz"] }, keys)).toBe(false);
    expect(leavesDescriptionToModel({ description: new Date(0) }, keys)).toBe(false);
  });

  it("reads the key the settings name", () => {
    const mapped = { ...keys, description: "beschreibung" };
    expect(leavesDescriptionToModel({ description: "", beschreibung: " " }, mapped)).toBe(false);
    expect(leavesDescriptionToModel({ description: "Text", beschreibung: "" }, mapped)).toBe(true);
  });
});

describe("descriptionUserMessage", () => {
  it("sends the title and the text", () => {
    expect(descriptionUserMessage("Hallo Welt", "\nErster Absatz.\n")).toBe(
      "Title: Hallo Welt\n\nErster Absatz."
    );
    expect(descriptionUserMessage("", "Nur Text")).toBe("Nur Text");
  });

  it("sends only the beginning of a long note", () => {
    const message = descriptionUserMessage("", "a".repeat(DESCRIPTION_MAX_INPUT_CHARS * 2));
    expect(message).toHaveLength(DESCRIPTION_MAX_INPUT_CHARS);
  });
});

describe("parseDescriptionResponse", () => {
  it("takes a plain answer as it is", () => {
    expect(parseDescriptionResponse("  Wie man Brot bäckt.  ")).toBe("Wie man Brot bäckt.");
  });

  it("undoes quotation marks, a label, Markdown and line breaks", () => {
    expect(parseDescriptionResponse("„Wie man Brot bäckt.“")).toBe("Wie man Brot bäckt.");
    expect(parseDescriptionResponse('"How to bake bread."')).toBe("How to bake bread.");
    expect(parseDescriptionResponse("Beschreibung: Wie man Brot bäckt.")).toBe(
      "Wie man Brot bäckt."
    );
    expect(parseDescriptionResponse("# **Brot** backen\nmit `Sauerteig`.")).toBe(
      "Brot backen mit Sauerteig."
    );
  });

  it("is nothing for an empty answer", () => {
    expect(parseDescriptionResponse("")).toBeNull();
    expect(parseDescriptionResponse("  \n ")).toBeNull();
    expect(parseDescriptionResponse('""')).toBeNull();
    expect(parseDescriptionResponse(undefined as unknown as string)).toBeNull();
  });

  it("cuts an overlong answer at a word, whatever it claims", () => {
    const parsed = parseDescriptionResponse(`${"Wort ".repeat(200)}Ende.`)!;
    expect(parsed.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    expect(parsed).toMatch(/Wort…$/);
  });
});
