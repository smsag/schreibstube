import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import {
  buildDrawingNote,
  checkDrawing,
  decodeBase64,
  DRAWING_ETAG_KEY,
  DRAWING_HASH_KEY,
  drawingImageFolder,
  drawingImagePath,
  drawingStateOf,
  isDrawingChange,
  MAX_DRAWING_ELEMENTS,
  retiredImages,
  sameBytes,
  withDrawingEtag,
  type Drawing
} from "./drawing-mirror";
import { hashText } from "./sync-document";
import { plainNoteText } from "./note-text";
import { vaultNoteChunks } from "./semantic/vault-retrieval";

setLanguage("en");

const PIXEL = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

function board(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [
      { id: "frame1", type: "frame", name: "M · Mac" },
      { id: "t1", type: "text", text: "Panel · Heute", originalText: "Panel · Heute" },
      { id: "t2", type: "text", text: "gone", isDeleted: true },
      { id: "img1", type: "image", fileId: "4fbd449d" }
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {
      "4fbd449d": {
        mimeType: "image/webp",
        id: "4fbd449d",
        dataURL: `data:image/webp;base64,${PIXEL}`
      }
    },
    ...overrides
  };
}

function read(source: Record<string, unknown>): Drawing {
  const result = checkDrawing(JSON.stringify(source));
  if (!result.ok) throw new Error(result.reason);
  return result.drawing;
}

describe("checkDrawing", () => {
  it("takes the pictures out of the scene and lists the texts still on it", () => {
    const drawing = read(board());
    expect(drawing.scene.files).toEqual({});
    expect(drawing.scene.elements).toHaveLength(4);
    expect(drawing.texts).toEqual([{ id: "t1", text: "Panel · Heute" }]);
    expect(drawing.images).toEqual([{ id: "4fbd449d", extension: "webp", base64: PIXEL }]);
  });

  it("refuses what is not a drawing", () => {
    const unreadable = {
      ok: false,
      reason: "The source is not an Excalidraw drawing: its JSON could not be read as one."
    };
    expect(checkDrawing("<html>")).toEqual(unreadable);
    expect(checkDrawing(JSON.stringify({ type: "file", content: "…" }))).toEqual(unreadable);
    expect(checkDrawing(JSON.stringify(board({ elements: {} })))).toEqual(unreadable);
    expect(checkDrawing(JSON.stringify(board({ files: [] })))).toEqual(unreadable);
  });

  it("refuses an id that cannot be a block reference or a file name", () => {
    const elements = [{ id: "../../etc", type: "text", text: "x" }];
    expect(checkDrawing(JSON.stringify(board({ elements }))).ok).toBe(false);

    const files = { "../x": { mimeType: "image/png", dataURL: `data:image/png;base64,${PIXEL}` } };
    expect(checkDrawing(JSON.stringify(board({ files })))).toEqual({
      ok: false,
      reason: "The drawing's picture ../x is not an image it can carry."
    });
  });

  it("refuses a picture that is not an image, or not what it says it is", () => {
    const html = { a: { mimeType: "text/html", dataURL: `data:text/html;base64,${PIXEL}` } };
    const mislabelled = {
      a: { mimeType: "image/png", dataURL: `data:image/webp;base64,${PIXEL}` }
    };
    const broken = { a: { mimeType: "image/png", dataURL: "data:image/png;base64,<svg>" } };
    for (const files of [html, mislabelled, broken]) {
      expect(checkDrawing(JSON.stringify(board({ files }))).ok).toBe(false);
    }
  });

  it("refuses a board past its bounds", () => {
    const elements = Array.from({ length: MAX_DRAWING_ELEMENTS + 1 }, (_, i) => ({
      id: `e${i}`,
      type: "rectangle"
    }));
    expect(checkDrawing(JSON.stringify(board({ elements })))).toEqual({
      ok: false,
      reason: "The drawing has more elements or pictures than a mirror takes."
    });
  });
});

describe("the state a drawing keeps in its frontmatter", () => {
  it("reads a hash and a validator, and sends no validator without a hash", () => {
    const hash = hashText("board");
    expect(drawingStateOf({ [DRAWING_HASH_KEY]: hash, [DRAWING_ETAG_KEY]: 'W/"abc"' })).toEqual({
      hash,
      etag: 'W/"abc"'
    });
    expect(drawingStateOf({ [DRAWING_ETAG_KEY]: '"abc"' })).toEqual({ hash: null, etag: "" });
    expect(drawingStateOf({ [DRAWING_HASH_KEY]: 12345678 })).toEqual({ hash: null, etag: "" });
    expect(drawingStateOf(undefined)).toEqual({ hash: null, etag: "" });
  });

  it("drops a validator that could not go back as a header", () => {
    const state = drawingStateOf({ [DRAWING_HASH_KEY]: hashText("b"), [DRAWING_ETAG_KEY]: "a\nb" });
    expect(state.etag).toBe("");
  });

  it("counts a board as changed when its text is not the one written", () => {
    expect(isDrawingChange({ hash: hashText("a"), etag: "" }, "a")).toBe(false);
    expect(isDrawingChange({ hash: hashText("a"), etag: "" }, "b")).toBe(true);
    expect(isDrawingChange({ hash: null, etag: "" }, "a")).toBe(true);
  });
});

describe("pictures", () => {
  it("live in a folder beside the drawing, named as its row reads", () => {
    expect(drawingImageFolder("Projekte/Nimbus/Atlas.excalidraw.md")).toBe("Projekte/Nimbus/Atlas");
    expect(drawingImageFolder("Atlas.excalidraw.md")).toBe("Atlas");
    expect(drawingImagePath("Atlas", { id: "4fbd", extension: "webp", base64: "" })).toBe(
      "Atlas/4fbd.webp"
    );
  });

  it("are given up only when the mirror named them and the board dropped them", () => {
    const paths = [
      "Atlas/keep.webp",
      "Atlas/gone.webp",
      "Atlas/Notizen.md",
      "Atlas/mein bild.png",
      "Atlas/sub/gone.png",
      "Other/gone.webp"
    ];
    expect(retiredImages(paths, "Atlas", new Set(["Atlas/keep.webp"]))).toEqual([
      "Atlas/gone.webp"
    ]);
  });

  it("are decoded to their bytes and compared byte for byte", () => {
    const bytes = decodeBase64("AAEC");
    expect([...bytes]).toEqual([0, 1, 2]);
    expect(sameBytes(new Uint8Array([0, 1, 2]).buffer, bytes)).toBe(true);
    expect(sameBytes(new Uint8Array([0, 1, 3]).buffer, bytes)).toBe(false);
    expect(sameBytes(new Uint8Array([0, 1]).buffer, bytes)).toBe(false);
  });
});

describe("buildDrawingNote", () => {
  const source = JSON.stringify(board());
  const note = (noteText: string, etag = '"v1"'): string =>
    buildDrawingNote({
      noteText,
      drawing: read(board()),
      imagePaths: new Map([["4fbd449d", "Atlas/4fbd449d.webp"]]),
      sourceText: source,
      etag,
      now: new Date(2026, 10, 2, 9, 5, 0)
    });

  it("writes the plugin's layout, with the pictures as links and the JSON without them", () => {
    const text = note("---\nschreibstubeSyncedFrom: https://x/a.excalidraw\n---\nold body\n");
    expect(text).toBe(
      [
        "---",
        "schreibstubeSyncedFrom: https://x/a.excalidraw",
        "excalidraw-plugin: parsed",
        `schreibstubeSourceHash: "${hashText(source)}"`,
        'schreibstubeSourceEtag: "\\"v1\\""',
        "updatedAt: 2026-11-02T09:05:00",
        "---",
        "# Excalidraw Data",
        "",
        "## Text Elements",
        "Panel · Heute ^t1",
        "",
        "## Embedded Files",
        "4fbd449d: [[Atlas/4fbd449d.webp]]",
        "",
        "%%",
        "## Drawing",
        "```json",
        JSON.stringify({ ...board(), files: {} }),
        "```",
        "%%",
        ""
      ].join("\n")
    );
  });

  it("keeps the note's other keys as they were spelled, and replaces its own", () => {
    const before = [
      "---",
      "excalidraw-plugin: parsed",
      "tags: [excalidraw]",
      'schreibstubeSourceHash: "00000000"',
      "schreibstubeSourceEtag:",
      "  - stray",
      "schreibstubeSyncedFrom: https://x/a.excalidraw",
      "---",
      ""
    ].join("\n");
    const head = note(before, "").split("\n# Excalidraw Data")[0];
    expect(head).toBe(
      [
        "---",
        "excalidraw-plugin: parsed",
        "tags: [excalidraw]",
        `schreibstubeSourceHash: "${hashText(source)}"`,
        "schreibstubeSyncedFrom: https://x/a.excalidraw",
        "updatedAt: 2026-11-02T09:05:00",
        "---"
      ].join("\n")
    );
  });

  it("leaves out a text that would end its section or the comment around the drawing", () => {
    const elements = [
      { id: "a", type: "text", text: "50 %% done" },
      { id: "b", type: "text", text: "## not a heading" },
      { id: "c", type: "text", text: "fine" }
    ];
    const text = buildDrawingNote({
      noteText: "---\n---\n",
      drawing: read(board({ elements, files: {} })),
      imagePaths: new Map(),
      sourceText: "x",
      etag: "",
      now: new Date(0)
    });
    expect(text).toContain("## Text Elements\nfine ^c\n\n%%");
    expect(text).not.toContain("## Embedded Files");
  });

  it("is indexed for its texts, not for its JSON or its picture list", () => {
    const text = note("---\nschreibstubeSyncedFrom: https://x/a.excalidraw\n---\n");
    expect(plainNoteText(text)).not.toContain("viewBackgroundColor");
    expect(vaultNoteChunks(text).join("\n")).toContain("Panel · Heute");
    expect(vaultNoteChunks(text).join("\n")).not.toContain("excalidraw.com");
  });
});

describe("withDrawingEtag", () => {
  it("writes the validator alone, and nothing when the note already has it", () => {
    const text = '---\nschreibstubeSourceEtag: "a"\n---\nbody\n';
    expect(withDrawingEtag(text, "b")).toBe('---\nschreibstubeSourceEtag: "b"\n---\nbody\n');
    expect(withDrawingEtag(text, "a")).toBeNull();
    expect(withDrawingEtag("no frontmatter", "a")).toBeNull();
  });
});
