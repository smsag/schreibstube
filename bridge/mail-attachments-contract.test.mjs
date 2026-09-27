import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  checkAttachments
} from "./mail-attachments.mjs";
import { PROTOCOL_VERSION } from "./config.mjs";
import {
  MAIL_ATTACHMENTS_PROTOCOL,
  MAX_MAIL_ATTACHMENT_BYTES,
  MAX_MAIL_ATTACHMENTS,
  MAX_MAIL_ATTACHMENTS_TOTAL_BYTES,
  toBase64
} from "../src/services/mail-protocol.ts";
import { mailFigures, MAIL_DIAGRAM_LANGUAGES } from "../src/services/mail-figures.ts";
import { findDiagramFences } from "../src/services/publish-diagrams.ts";

/**
 * The plugin builds a mail the bridge will take: the same limits on both
 * sides, and the attachments it writes pass the bridge's checks as they are.
 */
describe("mail attachments, plugin and bridge", () => {
  it("share their limits", () => {
    expect(MAX_MAIL_ATTACHMENTS).toBe(MAX_ATTACHMENTS);
    expect(MAX_MAIL_ATTACHMENT_BYTES).toBe(MAX_ATTACHMENT_BYTES);
    expect(MAX_MAIL_ATTACHMENTS_TOTAL_BYTES).toBe(MAX_ATTACHMENTS_TOTAL_BYTES);
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(MAIL_ATTACHMENTS_PROTOCOL);
  });

  it("agree on what the plugin writes", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const note = "```vizardry\na\n```\n```mermaid\nb\n```";
    const { attachments } = mailFigures(
      note,
      findDiagramFences(note, MAIL_DIAGRAM_LANGUAGES),
      new Map([
        [0, { pictures: [png], title: "" }],
        [1, { pictures: [png], title: "" }]
      ]),
      { figure: "Abbildung", attached: (name) => name }
    );

    const checked = checkAttachments(
      attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: "image/png",
        content: toBase64(attachment.bytes)
      }))
    );

    expect(checked.problem).toBeUndefined();
    expect(checked.attachments).toHaveLength(2);
  });
});
