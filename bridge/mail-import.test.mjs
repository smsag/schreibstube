import { describe, expect, it } from "vitest";
import {
  chooseImportAttachments,
  isSignatureImage,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_ATTACHMENTS,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_NAME_CHARS,
  safeFilename,
  SIGNATURE_IMAGE_BYTES
} from "./mail-import.mjs";

function part(filename, contentType, bytes, extra = {}) {
  return { filename, contentType, content: Buffer.alloc(bytes, 1), ...extra };
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
});
