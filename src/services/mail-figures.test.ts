import { describe, expect, it } from "vitest";
import { MAIL_DIAGRAM_LANGUAGES, mailFigures, type DrawnFigure } from "./mail-figures";
import { markdownToPlainText } from "./mail-body";
import {
  MAX_MAIL_ATTACHMENT_BYTES,
  MAX_MAIL_ATTACHMENTS,
  MAX_MAIL_ATTACHMENTS_TOTAL_BYTES,
  toBase64
} from "./mail-protocol";
import { findDiagramFences } from "./publish-diagrams";

const words = { figure: "Abbildung", attached: (name: string) => `im Anhang: ${name}` };
const bytes = (size = 4) => new Uint8Array(size);

function figures(note: string, drawn: Record<number, DrawnFigure>) {
  const fences = findDiagramFences(note, MAIL_DIAGRAM_LANGUAGES);
  return mailFigures(
    note,
    fences,
    new Map(Object.entries(drawn).map(([k, v]) => [Number(k), v])),
    words
  );
}

describe("mailFigures", () => {
  it("numbers each picture, names its file, and says so where the diagram stood", () => {
    const note = [
      "Hallo,",
      "",
      "```vizardry",
      "type: swot",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "```"
    ].join("\n");

    const out = figures(note, {
      0: { pictures: [bytes()], title: "SWOT" },
      1: { pictures: [bytes()], title: "" }
    });

    expect(out.attachments.map((attachment) => attachment.filename)).toEqual([
      "abbildung-1.png",
      "abbildung-2.png"
    ]);
    expect(out.markdown).toBe(
      [
        "Hallo,",
        "",
        "[Abbildung 1: SWOT — im Anhang: abbildung-1.png]",
        "",
        "[Abbildung 2 — im Anhang: abbildung-2.png]"
      ].join("\n")
    );
    expect(out.undrawn).toBe(0);
  });

  it("reads the same after the plain-text conversion the body goes through", () => {
    const out = figures("```vizardry\nx\n```", { 0: { pictures: [bytes()], title: "Plan [Q3]" } });

    expect(markdownToPlainText(out.markdown)).toBe(
      "[Abbildung 1: Plan (Q3) — im Anhang: abbildung-1.png]"
    );
  });

  it("gives every panel of a carousel its own figure", () => {
    const out = figures("```vizardry\nx\n```", {
      0: { pictures: [bytes(), bytes()], title: "Map" }
    });

    expect(out.markdown.split("\n")).toEqual([
      "[Abbildung 1: Map — im Anhang: abbildung-1.png]",
      "",
      "[Abbildung 2: Map — im Anhang: abbildung-2.png]"
    ]);
  });

  it("sends a diagram it could not draw as its source, and counts it", () => {
    const note = "```vizardry\ntype: swot\n```";

    const out = figures(note, {});

    expect(out.markdown).toBe(note);
    expect(out.attachments).toEqual([]);
    expect(out.undrawn).toBe(1);
  });

  it("stops attaching at the bridge's count, whole diagrams only", () => {
    const note = Array.from({ length: 3 }, () => "```vizardry\nx\n```").join("\n");
    const four = Array.from({ length: 4 }, () => bytes());

    const out = figures(note, {
      0: { pictures: four, title: "" },
      1: { pictures: four, title: "" },
      2: { pictures: four, title: "" }
    });

    expect(out.attachments.length).toBeLessThanOrEqual(MAX_MAIL_ATTACHMENTS);
    expect(out.attachments).toHaveLength(8);
    expect(out.undrawn).toBe(1);
  });

  it("stops attaching at the bridge's weight", () => {
    // Each under the limit for one picture; three together are over the total.
    const heavy = bytes(Math.floor(MAX_MAIL_ATTACHMENTS_TOTAL_BYTES / 3) + 1);
    const note = Array.from({ length: 3 }, () => "```vizardry\nx\n```").join("\n");

    const out = figures(note, {
      0: { pictures: [heavy], title: "" },
      1: { pictures: [heavy], title: "" },
      2: { pictures: [heavy], title: "" }
    });

    expect(heavy.byteLength).toBeLessThan(MAX_MAIL_ATTACHMENT_BYTES);
    expect(out.attachments).toHaveLength(2);
    expect(out.undrawn).toBe(1);
  });

  it("refuses one picture over the bridge's limit", () => {
    const out = figures("```vizardry\nx\n```", {
      0: { pictures: [bytes(MAX_MAIL_ATTACHMENT_BYTES + 1)], title: "" }
    });

    expect(out.undrawn).toBe(1);
  });

  it("names the file after the figure word, as a mail client saves it", () => {
    const out = mailFigures(
      "```vizardry\nx\n```",
      findDiagramFences("```vizardry\nx\n```", MAIL_DIAGRAM_LANGUAGES),
      new Map([[0, { pictures: [bytes()], title: "" }]]),
      { figure: "Größe Ü", attached: (name) => name }
    );

    expect(out.attachments[0]?.filename).toBe("grosse-u-1.png");
  });
});

describe("toBase64", () => {
  it("encodes bytes as base64", () => {
    expect(toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("iVBORw==");
  });

  it("encodes a picture of megabytes without overflowing the stack", () => {
    const large = new Uint8Array(3_000_000).fill(65);
    expect(toBase64(large)).toHaveLength(4_000_000);
  });
});
