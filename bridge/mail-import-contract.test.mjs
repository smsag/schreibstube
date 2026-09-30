import { describe, expect, it } from "vitest";
import {
  chooseImportAttachments,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_ATTACHMENTS,
  MAX_IMPORT_TOTAL_BYTES,
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
import { MAX_ATTACHMENT_NAME_CHARS } from "../src/services/mail-import.ts";

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
      `${"x".repeat(300)}.pdf`
    ];
    const { kept } = chooseImportAttachments(
      names.map((filename) => ({ filename, contentType: "", content: Buffer.from("x") }))
    );
    expect(kept).toHaveLength(names.length);

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
  });
});
