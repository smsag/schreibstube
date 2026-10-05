import { describe, expect, it } from "vitest";
import { findExecutableCode } from "./executable-code";
import {
  attachmentQuoteLines,
  isImageAttachment,
  MAX_ATTACHMENT_NAME_BYTES,
  MAX_ATTACHMENT_NAME_CHARS,
  MAX_SKIPPED_NAME_CHARS,
  safeAttachmentName,
  safeDisplayName
} from "./mail-import";

describe("safeAttachmentName", () => {
  it("keeps a plain name", () => {
    expect(safeAttachmentName("Protokoll 2025.pdf")).toBe("Protokoll 2025.pdf");
  });

  it("keeps only the last part of a path", () => {
    expect(safeAttachmentName("../../.obsidian/plugins/x.pdf")).toBe("x.pdf");
    expect(safeAttachmentName("C:\\temp\\Scan.PDF")).toBe("Scan.pdf");
  });

  it("replaces what breaks a link or a file system", () => {
    expect(safeAttachmentName("a#b^c[d]|e:f?.pdf")).toBe("a-b-c-d--e-f-.pdf");
  });

  it("refuses a kind the bridge does not hand over", () => {
    expect(safeAttachmentName("setup.exe")).toBeNull();
    expect(safeAttachmentName("Notiz.md")).toBeNull();
    expect(safeAttachmentName("ohne Endung")).toBeNull();
  });

  it("refuses a name that is only an extension or hidden", () => {
    expect(safeAttachmentName(".pdf")).toBeNull();
    expect(safeAttachmentName("...pdf")).toBeNull();
    expect(safeAttachmentName(".hidden.pdf")).toBe("hidden.pdf");
  });

  it("drops control characters and bounds the length", () => {
    expect(safeAttachmentName("a\u0000b\nc.pdf")).toBe("abc.pdf");
    expect(safeAttachmentName(`${"x".repeat(300)}.pdf`)).toBe(
      `${"x".repeat(MAX_ATTACHMENT_NAME_CHARS)}.pdf`
    );
  });

  it("drops the characters that make a name read as another, and C1 controls", () => {
    expect(safeAttachmentName("Rechnung\u202Eexe.pdf")).toBe("Rechnungexe.pdf");
    expect(safeAttachmentName("a\u200Bb\u2066c\u0085.pdf")).toBe("abc.pdf");
  });

  it("bounds a name in bytes, cutting between characters", () => {
    const name = safeAttachmentName(`${"😀".repeat(100)}.pdf`) ?? "";
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(MAX_ATTACHMENT_NAME_BYTES);
    expect(name).toBe(`${"😀".repeat(49)}.pdf`);
  });

  it("renames a name Windows keeps for a device", () => {
    expect(safeAttachmentName("CON.pdf")).toBe("_CON.pdf");
    expect(safeAttachmentName("nul.tar.pdf")).toBe("_nul.tar.pdf");
    expect(safeAttachmentName("_CON.pdf")).toBe("_CON.pdf");
    expect(safeAttachmentName("Console.pdf")).toBe("Console.pdf");
  });
});

describe("safeDisplayName", () => {
  it("holds a left-out file's name to what a file name may say", () => {
    expect(safeDisplayName("../x/Termin\u202E[[geheim]].ics")).toBe("Termin--geheim--.ics");
    expect(safeDisplayName("\u202E")).toBe("");
  });
});

describe("isImageAttachment", () => {
  it("tells pictures from documents", () => {
    expect(isImageAttachment("Foto.JPG")).toBe(true);
    expect(isImageAttachment("Scan.heic")).toBe(true);
    expect(isImageAttachment("Protokoll.pdf")).toBe(false);
    expect(isImageAttachment("ohne")).toBe(false);
  });
});

describe("attachmentQuoteLines", () => {
  const label = (names: string) => `Nicht übernommen: ${names}`;

  it("embeds pictures and links the rest, inside the quote", () => {
    expect(
      attachmentQuoteLines(
        [
          { link: "[[Foto.jpg]]", image: true },
          { link: "[[Protokoll 2025.pdf]]", image: false }
        ],
        [],
        label
      )
    ).toBe(">\n> ![[Foto.jpg]]\n> [[Protokoll 2025.pdf]]");
  });

  it("names what was left out", () => {
    const skipped = [
      { filename: "setup.exe", reason: "Dateityp" },
      { filename: "Film.mov", reason: "zu groß" }
    ];
    expect(attachmentQuoteLines([], skipped, label)).toBe(
      ">\n> Nicht übernommen: setup.exe (Dateityp), Film.mov (zu groß)"
    );
  });

  it("writes a name the sender chose as text, never as an embed or code", () => {
    const skipped = [
      { filename: "![[Finanzen/Gehalt.pdf]].ics", reason: "Dateityp" },
      { filename: "x.ics\n```dataviewjs\napp.vault.delete()\n```", reason: "Dateityp" },
      { filename: "`$= dv.pages()`<% tp.file.title %>%%.ics", reason: "Dateityp" }
    ];
    const lines = attachmentQuoteLines([], skipped, label);

    expect(lines).not.toContain("![[");
    expect(lines).toContain("!\\[\\[Finanzen/Gehalt.pdf]].ics (Dateityp)");
    expect(findExecutableCode(lines)).toEqual([]);
    expect(lines).not.toContain("`");
    expect(lines).not.toContain("<%");
    expect(lines).not.toContain("%%");
    expect(lines.split("\n").every((line) => line.startsWith(">"))).toBe(true);
  });

  it("cuts a name chosen to be enormous", () => {
    const lines = attachmentQuoteLines([], [{ filename: "a".repeat(5000), reason: "x" }], label);
    expect(lines.length).toBeLessThan(MAX_SKIPPED_NAME_CHARS + 60);
  });

  it("adds nothing for a mail without files", () => {
    expect(attachmentQuoteLines([], [], label)).toBe("");
  });
});
