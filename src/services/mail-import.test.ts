import { describe, expect, it } from "vitest";
import {
  attachmentQuoteLines,
  isImageAttachment,
  MAX_ATTACHMENT_NAME_CHARS,
  safeAttachmentName
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
    expect(attachmentQuoteLines([], ["setup.exe (Dateityp)", "Film.mov (zu groß)"], label)).toBe(
      ">\n> Nicht übernommen: setup.exe (Dateityp), Film.mov (zu groß)"
    );
  });

  it("adds nothing for a mail without files", () => {
    expect(attachmentQuoteLines([], [], label)).toBe("");
  });
});
