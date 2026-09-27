// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { MarkdownRenderer } from "../testing/obsidian-stub";
import { installObsidianDom } from "../testing/obsidian-dom";
import { createLogger, type LogSink } from "../services/logger";
import { NO_ENRICH_CLASS, type CanvasExportOptions } from "../services/workspace-internals";
import { DiagramCapture } from "./diagram-capture";

const MAX_BYTES = 1024;
const block = { index: 0, language: "vizardry", source: "type: swot" };

let warnings: string[];
let hostClassAtRender: string;

function sink(): LogSink {
  const quiet = (): void => {};
  return {
    debug: quiet,
    info: quiet,
    warn: (...parts: unknown[]) => warnings.push(parts.map(String).join(" ")),
    error: quiet
  };
}

function png(bytes = 16): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

function answer(blob: Blob, title = "") {
  return { blob, width: 10, height: 10, scale: 2, format: "png", title };
}

/** An app with a canvas plugin whose api the test decides. */
function appWith(api: Record<string, unknown> | undefined): App {
  return { plugins: { plugins: { vizardry: api ? { api } : undefined } } } as unknown as App;
}

function canvasApi(canvasCount: number, exportCanvas: (el: HTMLElement) => Promise<unknown>) {
  return {
    version: 1,
    getCanvases: (root: HTMLElement) =>
      Array.from({ length: canvasCount }, () => root.appendChild(document.createElement("div"))),
    whenSettled: () => Promise.resolve(),
    exportCanvas: vi.fn((el: HTMLElement, _options?: CanvasExportOptions) => exportCanvas(el))
  };
}

function capture(app: App): DiagramCapture {
  return new DiagramCapture(
    app,
    createLogger(() => false, sink()),
    "print",
    MAX_BYTES
  );
}

beforeAll(() => installObsidianDom());

beforeEach(() => {
  warnings = [];
  hostClassAtRender = "";
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
    hostClassAtRender = (args[2] as HTMLElement).className;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("DiagramCapture through the drawing plugin's own export", () => {
  it("takes every canvas of the fence, light and without its title row", async () => {
    const api = canvasApi(2, () => Promise.resolve(answer(png(), "SWOT Analysis")));

    const drawn = await capture(appWith(api)).capture(block, "note.md");

    expect(drawn.expected).toBe(2);
    expect(drawn.pictures).toHaveLength(2);
    expect(drawn.title).toBe("SWOT Analysis");
    expect(api.exportCanvas.mock.calls[0]?.[1]).toMatchObject({
      format: "png",
      light: true,
      header: false
    });
  });

  it("asks the plugin to stay offline before the drawing renders, and leaves nothing behind", async () => {
    await capture(appWith(canvasApi(1, () => Promise.resolve(answer(png()))))).capture(
      block,
      "note.md"
    );

    expect(hostClassAtRender).toContain(NO_ENRICH_CLASS);
    expect(hostClassAtRender).toContain("theme-light");
    expect(document.body.children).toHaveLength(0);
  });

  it("keeps the canvases that exported when one of them fails, and counts the lost one", async () => {
    let call = 0;
    const api = canvasApi(2, () => {
      call += 1;
      return call === 1
        ? Promise.reject(Object.assign(new Error("boom"), { code: "capture-failed" }))
        : Promise.resolve(answer(png()));
    });

    const drawn = await capture(appWith(api)).capture(block, "note.md");

    expect(drawn.pictures).toHaveLength(1);
    expect(drawn.expected).toBe(2);
    expect(
      warnings.some((line) => line.includes("print: vizardry") && line.includes("capture-failed"))
    ).toBe(true);
  });

  it("refuses a picture over the caller's limit rather than carrying it", async () => {
    const api = canvasApi(1, () => Promise.resolve(answer(png(MAX_BYTES + 1))));

    const drawn = await capture(appWith(api)).capture(block, "note.md");

    expect(drawn.pictures).toHaveLength(0);
    expect(drawn.expected).toBe(1);
  });

  it("refuses an answer in a shape the contract does not describe", async () => {
    const api = canvasApi(1, () => Promise.resolve({ blob: png(), format: "jpeg" }));

    const drawn = await capture(appWith(api)).capture(block, "note.md");

    expect(drawn.pictures).toHaveLength(0);
  });

  it("falls back to the drawing itself when the plugin cannot list its canvases", async () => {
    const api = { ...canvasApi(0, () => Promise.resolve(null)), getCanvases: () => "nope" };

    const drawn = await capture(appWith(api)).capture(block, "note.md");

    // Nothing was drawn into the stub's document, so there is nothing to fall back to.
    expect(drawn).toEqual({ pictures: [], expected: 0, title: "" });
    expect(warnings.some((line) => line.includes("did not answer with a list"))).toBe(true);
  });

  it("captures without a plugin export when the plugin offers none", async () => {
    const drawn = await capture(appWith(undefined)).capture(block, "note.md");

    expect(drawn).toEqual({ pictures: [], expected: 0, title: "" });
    expect(hostClassAtRender).toContain(NO_ENRICH_CLASS);
  });
});
