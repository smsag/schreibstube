import { describe, expect, it } from "vitest";
import {
  chooseImportAttachments,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_ATTACHMENTS,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_NAME_BYTES,
  MAX_NAME_CHARS
} from "./mail-import.mjs";
import { PROTOCOL_VERSION } from "./config.mjs";
import {
  MAIL_IMPORT_PROTOCOL,
  MAX_IMPORT_ATTACHMENT_BYTES as PLUGIN_MAX_BYTES,
  MAX_IMPORT_ATTACHMENTS as PLUGIN_MAX_COUNT,
  MAX_IMPORT_TOTAL_BYTES as PLUGIN_MAX_TOTAL,
  parseAttachmentsResult
} from "../src/services/mail-protocol.ts";
import {
  MAX_ATTACHMENT_NAME_BYTES,
  MAX_ATTACHMENT_NAME_CHARS
} from "../src/services/mail-import.ts";

/** Bytes that begin as a file of the name's kind does, which the bridge checks. */
function headed(filename) {
  const extension = /\.([a-z]+)$/i.exec(filename)[1].toLowerCase();
  const zip = [0x50, 0x4b, 0x03, 0x04];
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const headers = {
    pdf: Buffer.from("%PDF-1.7"),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    gif: Buffer.from("GIF87a"),
    webp: Buffer.from("RIFF\x10\x00\x00\x00WEBP"),
    heic: Buffer.from("\x00\x00\x00\x18ftypmif1"),
    doc: Buffer.from(ole),
    xls: Buffer.from(ole),
    ppt: Buffer.from(ole),
    docx: Buffer.from(zip),
    xlsx: Buffer.from(zip),
    pptx: Buffer.from(zip),
    odt: Buffer.from(zip),
    ods: Buffer.from(zip),
    odp: Buffer.from(zip)
  };
  return headers[extension];
}

/**
 * A received mail's files, handed over by the bridge and taken by the plugin:
 * the same limits on both sides, and every file the bridge keeps is one the
 * plugin writes under the same name.
 */
describe("imported attachments, bridge and plugin", () => {
  it("share their limits", () => {
    expect(PLUGIN_MAX_COUNT).toBe(MAX_IMPORT_ATTACHMENTS);
    expect(PLUGIN_MAX_BYTES).toBe(MAX_IMPORT_ATTACHMENT_BYTES);
    expect(PLUGIN_MAX_TOTAL).toBe(MAX_IMPORT_TOTAL_BYTES);
    expect(MAX_ATTACHMENT_NAME_CHARS).toBe(MAX_NAME_CHARS);
    expect(MAX_ATTACHMENT_NAME_BYTES).toBe(MAX_NAME_BYTES);
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(MAIL_IMPORT_PROTOCOL);
  });

  it("agree on every kind and name the bridge keeps", () => {
    const names = [
      "Protokoll 2025.pdf",
      "Foto.JPG",
      "Bild.jpeg",
      "a.png",
      "a.gif",
      "a.webp",
      "a.heic",
      "Brief.doc",
      "Brief.docx",
      "Tabelle.xls",
      "Tabelle.xlsx",
      "Folien.ppt",
      "Folien.pptx",
      "Text.odt",
      "Rechnung.ods",
      "Vortrag.odp",
      "Rechnung #12 [Kopie].pdf",
      `${"x".repeat(300)}.pdf`,
      `${"x".repeat(300)}.pdf`,
      `${"文".repeat(100)}.pdf`,
      `${"文".repeat(100)}.pdf`,
      `${"😀".repeat(100)}.docx`,
      "Rechnung\u202Eexe.pdf",
      "CON.pdf",
      "nul.tar.xlsx"
    ];
    // One mail holds at most MAX_IMPORT_ATTACHMENTS, so the names go in two.
    for (const mail of [names.slice(0, 15), names.slice(15)]) {
      const { kept } = chooseImportAttachments(
        mail.map((filename) => ({ filename, contentType: "", content: headed(filename) }))
      );
      expect(kept).toHaveLength(mail.length);

      const taken = parseAttachmentsResult({
        attachments: kept.map((entry) => ({
          filename: entry.filename,
          contentType: entry.contentType,
          content: entry.content.toString("base64")
        })),
        skipped: []
      });

      expect(taken.skipped).toEqual([]);
      expect(taken.attachments.map((entry) => entry.filename)).toEqual(
        kept.map((entry) => entry.filename)
      );
    }
  });
});
