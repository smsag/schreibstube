import { describe, expect, it } from "vitest";
import {
  chooseImportAttachments,
  contentMatches,
  displayName,
  isSignatureImage,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_ATTACHMENTS,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_NAME_BYTES,
  MAX_NAME_CHARS,
  safeFilename,
  SIGNATURE_IMAGE_BYTES
} from "./mail-import.mjs";

/** How real files of each kind begin, written out here rather than taken from
 *  the module, so a wrong signature there is a failure here. */
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HEADERS = {
  pdf: Buffer.from("%PDF-1.7\n"),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
  gif: Buffer.from("GIF89a"),
  webp: Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 "),
  heic: Buffer.from("\x00\x00\x00\x18ftypheic"),
  doc: Buffer.from(OLE),
  xls: Buffer.from(OLE),
  ppt: Buffer.from(OLE),
  docx: Buffer.from(ZIP),
  xlsx: Buffer.from(ZIP),
  pptx: Buffer.from(ZIP),
  odt: Buffer.from(ZIP),
  ods: Buffer.from(ZIP),
  odp: Buffer.from(ZIP)
};
const BY_TYPE = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

/** A part whose bytes begin as its kind's do, padded to `bytes`. */
function filled(extension, bytes) {
  const content = Buffer.alloc(bytes, 1);
  HEADERS[extension]?.copy(content);
  return content;
}

function part(filename, contentType, bytes, extra = {}) {
  const extension =
    /\.([a-z0-9]+)$/i.exec(filename ?? "")?.[1]?.toLowerCase() ??
    BY_TYPE[String(contentType).split(";")[0]];
  return { filename, contentType, content: filled(extension, bytes), ...extra };
}

function names(result) {
  return result.kept.map((entry) => entry.filename);
}

describe("chooseImportAttachments", () => {
  it("keeps the PDFs a mail was sent with", () => {
    const result = chooseImportAttachments([
      part("Protokoll 2025.pdf", "application/pdf", 200_000),
      part("Protokollsammlung.pdf", "application/octet-stream", 900_000)
    ]);
    expect(names(result)).toEqual(["Protokoll 2025.pdf", "Protokollsammlung.pdf"]);
    expect(result.kept[1].contentType).toBe("application/pdf");
    expect(result.skipped).toEqual([]);
  });

  it("keeps pictures and office files", () => {
    const result = chooseImportAttachments([
      part("Foto.JPG", "image/jpeg", 2_000_000),
      part("Abrechnung.xlsx", "application/octet-stream", 30_000),
      part("Brief.docx", "application/octet-stream", 30_000),
      part("Folien.odp", "application/octet-stream", 30_000)
    ]);
    expect(names(result)).toEqual(["Foto.jpg", "Abrechnung.xlsx", "Brief.docx", "Folien.odp"]);
  });

  it("leaves a signature's small inline logos out without naming them", () => {
    const result = chooseImportAttachments([
      part("image001.png", "image/png", 6_000, { related: true, cid: "image001.png@01DD" }),
      part("linkedin.png", "image/png", 2_000, { contentDisposition: "inline" }),
      part("Protokoll.pdf", "application/pdf", 50_000)
    ]);
    expect(names(result)).toEqual(["Protokoll.pdf"]);
    expect(result.skipped).toEqual([]);
  });

  it("keeps a large picture shown inside the text: a photo, not a logo", () => {
    const result = chooseImportAttachments([
      part("image002.jpg", "image/jpeg", 800_000, { related: true, cid: "image002" })
    ]);
    expect(names(result)).toEqual(["image002.jpg"]);
  });

  it("keeps a small picture sent as an attachment of its own", () => {
    const result = chooseImportAttachments([part("Skizze.png", "image/png", 3_000)]);
    expect(names(result)).toEqual(["Skizze.png"]);
  });

  it("leaves an S/MIME signature out without naming it", () => {
    const result = chooseImportAttachments([
      part("smime.p7s", "application/pkcs7-signature", 4_000)
    ]);
    expect(result).toEqual({ kept: [], skipped: [] });
  });

  it("names a kind of file it does not hand over", () => {
    const result = chooseImportAttachments([
      part("setup.exe", "application/pdf", 10_000),
      part("Termin.ics", "text/calendar", 1_000),
      part("", "application/zip", 1_000)
    ]);
    expect(result.kept).toEqual([]);
    expect(result.skipped).toEqual([
      { filename: "setup.exe", reason: "type" },
      { filename: "Termin.ics", reason: "type" },
      { filename: "Anhang 3", reason: "type" }
    ]);
  });

  it("takes the kind from the type when the name has none", () => {
    const result = chooseImportAttachments([part("Scan", "application/pdf; name=Scan", 1_000)]);
    expect(names(result)).toEqual(["Scan.pdf"]);
  });

  it("names a file over the size limit", () => {
    const result = chooseImportAttachments([
      part("Riesig.pdf", "application/pdf", MAX_IMPORT_ATTACHMENT_BYTES + 1)
    ]);
    expect(result.skipped).toEqual([{ filename: "Riesig.pdf", reason: "size" }]);
  });

  it("stops at the total and names what did not fit", () => {
    const each = MAX_IMPORT_ATTACHMENT_BYTES;
    const count = Math.ceil(MAX_IMPORT_TOTAL_BYTES / each) + 1;
    const parts = Array.from({ length: count }, (_, i) => part(`Teil ${i}.pdf`, "", each));
    const result = chooseImportAttachments(parts);
    const kept = result.kept.reduce((sum, entry) => sum + entry.content.length, 0);
    expect(kept).toBeLessThanOrEqual(MAX_IMPORT_TOTAL_BYTES);
    expect(result.skipped.every((entry) => entry.reason === "limit")).toBe(true);
    expect(result.kept.length + result.skipped.length).toBe(count);
  });

  it("stops at the count and names what did not fit", () => {
    const parts = Array.from({ length: MAX_IMPORT_ATTACHMENTS + 2 }, (_, i) =>
      part(`Bild ${i}.png`, "image/png", 100_000)
    );
    const result = chooseImportAttachments(parts);
    expect(result.kept).toHaveLength(MAX_IMPORT_ATTACHMENTS);
    expect(result.skipped).toHaveLength(2);
  });

  it("gives two files of one name two names", () => {
    const result = chooseImportAttachments([
      part("Scan.pdf", "application/pdf", 1_000),
      part("scan.pdf", "application/pdf", 1_000),
      part("Scan.pdf", "application/pdf", 1_000)
    ]);
    expect(names(result)).toEqual(["Scan.pdf", "scan 2.pdf", "Scan 3.pdf"]);
  });

  it("names a file whose bytes are not of the kind its name and type claim", () => {
    const program = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(5_000, 1)]);
    const result = chooseImportAttachments([
      { filename: "Rechnung.pdf", contentType: "application/pdf", content: program },
      { filename: "Foto.jpg", contentType: "image/jpeg", content: filled("png", 5_000) },
      { filename: "Brief.docx", contentType: "", content: filled("doc", 5_000) },
      { filename: "Brief.doc", contentType: "", content: filled("docx", 5_000) },
      part("Echt.pdf", "application/pdf", 5_000)
    ]);
    expect(names(result)).toEqual(["Echt.pdf"]);
    expect(result.skipped).toEqual([
      { filename: "Rechnung.pdf", reason: "content" },
      { filename: "Foto.jpg", reason: "content" },
      { filename: "Brief.docx", reason: "content" },
      { filename: "Brief.doc", reason: "content" }
    ]);
  });

  it("keeps every kind it hands over when the bytes are that kind's", () => {
    const kinds = Object.keys(HEADERS);
    const result = chooseImportAttachments(
      kinds.map((extension) => part(`Datei.${extension}`, "", 100))
    );
    expect(result.skipped).toEqual([]);
    expect(result.kept).toHaveLength(kinds.length);
  });

  it("finds a PDF's header after a little junk, as readers do, but not after a kilobyte", () => {
    expect(contentMatches(Buffer.from("\r\n%PDF-1.4"), "pdf")).toBe(true);
    const late = Buffer.concat([Buffer.alloc(1024, 0x20), Buffer.from("%PDF-1.4")]);
    expect(contentMatches(late, "pdf")).toBe(false);
  });

  it("matches nothing too short to hold its kind's signature, and no kind it does not know", () => {
    expect(contentMatches(Buffer.from([0x89, 0x50]), "png")).toBe(false);
    expect(contentMatches(Buffer.from("RIFF"), "webp")).toBe(false);
    expect(contentMatches(Buffer.from("MZ"), "exe")).toBe(false);
  });

  it("names a left-out file with the characters a file name may have, and only its own name", () => {
    const result = chooseImportAttachments([
      part("../../Rechnung\u202Efdp.exe", "application/octet-stream", 100),
      part("a\u0085b[[x]]|#^.ics", "text/calendar", 100)
    ]);
    expect(result.skipped).toEqual([
      { filename: "Rechnungfdp.exe", reason: "type" },
      { filename: "ab--x-----.ics", reason: "type" }
    ]);
  });

  it("ignores what is not an attachment with content", () => {
    expect(chooseImportAttachments(undefined)).toEqual({ kept: [], skipped: [] });
    expect(chooseImportAttachments([{ filename: "a.pdf" }, null])).toEqual({
      kept: [],
      skipped: []
    });
  });
});

describe("isSignatureImage", () => {
  it("is only ever a picture", () => {
    expect(isSignatureImage({ related: true }, "application/pdf", 100)).toBe(false);
  });

  it("is small and inline", () => {
    expect(isSignatureImage({ cid: "x" }, "image/png", SIGNATURE_IMAGE_BYTES - 1)).toBe(true);
    expect(isSignatureImage({ cid: "x" }, "image/png", SIGNATURE_IMAGE_BYTES)).toBe(false);
    expect(isSignatureImage({}, "image/png", 10)).toBe(false);
  });
});

describe("safeFilename", () => {
  it("keeps only the last part of a path", () => {
    expect(safeFilename("../../etc/passwd.pdf", "pdf")).toBe("passwd.pdf");
    expect(safeFilename("C:\\Users\\x\\Scan.pdf", "pdf")).toBe("Scan.pdf");
  });

  it("replaces what breaks a link or a file system", () => {
    expect(safeFilename('Rechnung #12 [Kopie] a|b "c"?.pdf', "pdf")).toBe(
      "Rechnung -12 -Kopie- a-b -c--.pdf"
    );
  });

  it("is never hidden and never empty", () => {
    expect(safeFilename(".hidden.pdf", "pdf")).toBe("hidden.pdf");
    expect(safeFilename("...pdf", "pdf", 4)).toBe("Anhang 5.pdf");
    expect(safeFilename(undefined, "png")).toBe("Anhang 1.png");
  });

  it("keeps a dot that is not the extension", () => {
    expect(safeFilename("Rechnung v1.2", "pdf")).toBe("Rechnung v1.2.pdf");
  });

  it("drops control characters and bounds the length", () => {
    expect(safeFilename("a\u0000b\nc.pdf", "pdf")).toBe("abc.pdf");
    expect(safeFilename(`${"x".repeat(500)}.pdf`, "pdf")).toBe(`${"x".repeat(MAX_NAME_CHARS)}.pdf`);
  });

  it("writes the extension of the kind, whatever case it came in", () => {
    expect(safeFilename("Foto.JPEG", "jpeg")).toBe("Foto.jpeg");
  });

  it("drops the characters that make a name read as another, and C1 controls", () => {
    // U+202E turns the rest around on screen: this showed as "Rechnungexe.pdf".
    expect(safeFilename("Rechnung\u202Eexe.pdf", "pdf")).toBe("Rechnungexe.pdf");
    expect(safeFilename("a\u200Bb\u2066c\uFEFF.pdf", "pdf")).toBe("abc.pdf");
    expect(safeFilename("a\u0085b\u009Fc.pdf", "pdf")).toBe("abc.pdf");
  });

  it("bounds a name in bytes, cutting between characters, extension included", () => {
    const wide = safeFilename(`${"文".repeat(100)}.pdf`, "pdf");
    expect(Buffer.byteLength(wide)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(wide).toBe(`${"文".repeat(65)}.pdf`);
    const emoji = safeFilename(`${"😀".repeat(100)}.pdf`, "pdf");
    expect(Buffer.byteLength(emoji)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(emoji).toBe(`${"😀".repeat(49)}.pdf`);
    expect(emoji).not.toContain("�");
  });

  it("keeps a second name of the same file inside the byte bound", () => {
    const long = `${"文".repeat(100)}.pdf`;
    const result = chooseImportAttachments([
      part(long, "application/pdf", 10),
      part(long, "application/pdf", 10)
    ]);
    for (const entry of result.kept) {
      expect(Buffer.byteLength(entry.filename)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    }
    expect(result.kept[1].filename.endsWith(" 2.pdf")).toBe(true);
  });

  it("renames a name Windows keeps for a device, with any extension", () => {
    expect(safeFilename("CON.pdf", "pdf")).toBe("_CON.pdf");
    expect(safeFilename("nul.tar.pdf", "pdf")).toBe("_nul.tar.pdf");
    expect(safeFilename("com1.pdf", "pdf")).toBe("_com1.pdf");
    expect(safeFilename("LPT9.docx", "docx")).toBe("_LPT9.docx");
    expect(safeFilename("Aux .pdf", "pdf")).toBe("_Aux.pdf");
    expect(safeFilename("Contract.pdf", "pdf")).toBe("Contract.pdf");
    expect(safeFilename("COM10.pdf", "pdf")).toBe("COM10.pdf");
  });
});

describe("displayName", () => {
  it("is the last part of the name, cleaned like a file name and bounded in bytes", () => {
    expect(displayName("x/y/Termin\u202E.ics", 0)).toBe("Termin.ics");
    expect(Buffer.byteLength(displayName("文".repeat(300), 0))).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(displayName("\u202E\u0000", 2)).toBe("Anhang 3");
  });
});
