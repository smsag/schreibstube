import { describe, expect, it } from "vitest";
import { followedNotePath, linkPointedAt, retargetLinks } from "./description-follow";
import { descriptionNotePath } from "./image-description";

describe("linkPointedAt", () => {
  it("knows a full path", () => {
    expect(linkPointedAt("Bilder/see.jpg", "Bilder/see.jpg", false)).toBe(true);
  });

  it("takes a bare name for the file that carried it", () => {
    expect(linkPointedAt("see.jpg", "Bilder/see.jpg", false)).toBe(true);
  });

  it("leaves a link that still resolves alone", () => {
    expect(linkPointedAt("see.jpg", "Bilder/see.jpg", true)).toBe(false);
  });

  it("does not claim a link to another file", () => {
    expect(linkPointedAt("Andere/see.jpg", "Bilder/see.jpg", false)).toBe(false);
    expect(linkPointedAt("berg.jpg", "Bilder/see.jpg", false)).toBe(false);
  });
});

describe("followedNotePath", () => {
  it("renames a note that still carries the name it was given, in its own folder", () => {
    const note = descriptionNotePath("Bildbeschreibungen", "Bilder/see.jpg");
    expect(followedNotePath(note, "Bilder/see.jpg", "Urlaub/see-abend.jpg")).toBe(
      descriptionNotePath("Bildbeschreibungen", "Urlaub/see-abend.jpg")
    );
  });

  it("leaves a note that was renamed by hand", () => {
    expect(
      followedNotePath("Bildbeschreibungen/Der See.md", "Bilder/see.jpg", "Urlaub/see.jpg")
    ).toBeNull();
  });

  it("works for a note at the vault's root", () => {
    const note = descriptionNotePath("", "see.jpg");
    expect(followedNotePath(note, "see.jpg", "berg.jpg")).toBe(descriptionNotePath("", "berg.jpg"));
  });
});

describe("retargetLinks", () => {
  const note = [
    "---",
    'schreibstubeImage: "[[Bilder/see.jpg]]"',
    "---",
    "",
    "![[Bilder/see.jpg]]",
    "",
    "Siehe auch [[Bilder/see.jpg|das Bild]] und [[Bilder/see.jpg#x]]."
  ].join("\n");

  it("rewrites the key, the embed and every link to the picture", () => {
    const out = retargetLinks(note, "Bilder/see.jpg", "Urlaub/see.jpg");
    expect(out).not.toContain("Bilder/see.jpg");
    expect(out).toContain('schreibstubeImage: "[[Urlaub/see.jpg]]"');
    expect(out).toContain("![[Urlaub/see.jpg]]");
    expect(out).toContain("[[Urlaub/see.jpg|das Bild]]");
    expect(out).toContain("[[Urlaub/see.jpg#x]]");
  });

  it("changes only whole link targets", () => {
    const text = "[[see.jpg.md]] [[Bilder/see.jpg]] [[see.jpg]]";
    expect(retargetLinks(text, "see.jpg", "berg.jpg")).toBe(
      "[[see.jpg.md]] [[Bilder/see.jpg]] [[berg.jpg]]"
    );
  });

  it("reads the old link literally, not as a pattern", () => {
    expect(retargetLinks("[[a (1).jpg]] [[a 1.jpg]]", "a (1).jpg", "b.jpg")).toBe(
      "[[b.jpg]] [[a 1.jpg]]"
    );
  });
});
