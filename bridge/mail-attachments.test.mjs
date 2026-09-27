import { describe, expect, it } from "vitest";
import {
  checkAttachments,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  maxSendBodyBytes
} from "./mail-attachments.mjs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function png(size = PNG.length) {
  const bytes = Buffer.alloc(size);
  PNG.copy(bytes);
  return bytes.toString("base64");
}

const picture = (overrides = {}) => ({
  filename: "abbildung-1.png",
  contentType: "image/png",
  content: png(),
  ...overrides
});

describe("checkAttachments", () => {
  it("takes none when a plugin sends no field, as one before protocol 5 does", () => {
    expect(checkAttachments(undefined)).toEqual({ attachments: [] });
  });

  it("decodes a picture", () => {
    const { attachments } = checkAttachments([picture()]);
    expect(attachments).toEqual([
      {
        filename: "abbildung-1.png",
        contentType: "image/png",
        content: Buffer.from(png(), "base64")
      }
    ]);
  });

  it.each([
    ["a name with a path", { filename: "../../etc/passwd.png" }],
    ["a name that is no picture", { filename: "invoice.exe" }],
    ["a name with a line break", { filename: "a\r\nBcc: x@y.de.png" }],
    ["another type", { contentType: "application/pdf" }],
    ["content that is not base64", { content: "not base64!" }],
    ["bytes that are not a PNG", { content: Buffer.from("GIF89a....").toString("base64") }],
    ["empty content", { content: "" }]
  ])("refuses %s", (_label, overrides) => {
    expect(checkAttachments([picture(overrides)]).problem).toBeTruthy();
  });

  it("refuses a field that is not a list", () => {
    expect(checkAttachments({ filename: "a.png" }).problem).toBeTruthy();
  });

  it("refuses the same name twice, which a mail client would overwrite", () => {
    expect(checkAttachments([picture(), picture({ filename: "Abbildung-1.png" })]).problem).toMatch(
      /twice/
    );
  });

  it("refuses more pictures than a mail carries", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, index) =>
      picture({ filename: `abbildung-${index + 1}.png` })
    );
    expect(checkAttachments(many).problem).toMatch(/at most/);
  });

  it("refuses a picture over the limit before decoding it", () => {
    const tooLarge = "A".repeat(Math.ceil(((MAX_ATTACHMENT_BYTES + 10) * 4) / 3 / 4) * 4);
    expect(checkAttachments([picture({ content: tooLarge })]).problem).toMatch(/larger/);
  });

  it("refuses pictures that come to more than the whole allowance", () => {
    const size = Math.floor(MAX_ATTACHMENT_BYTES * 0.9);
    const count = Math.ceil(MAX_ATTACHMENTS_TOTAL_BYTES / size) + 1;
    const pictures = Array.from({ length: count }, (_, index) =>
      picture({ filename: `abbildung-${index + 1}.png`, content: png(size) })
    );
    expect(checkAttachments(pictures).problem).toMatch(/more than/);
  });
});

describe("maxSendBodyBytes", () => {
  it("leaves room for every picture at its limit, in base64, beside the text", () => {
    expect(maxSendBodyBytes(1_000_000)).toBeGreaterThan(
      1_000_000 + (MAX_ATTACHMENTS_TOTAL_BYTES * 4) / 3
    );
  });
});
