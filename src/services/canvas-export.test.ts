import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import {
  CANVAS_EXPORT_VERSION,
  canvasExportApi,
  checkExportResult,
  exportErrorCode,
  NO_ENRICH_CLASS,
  noEnrichClass
} from "./workspace-internals";

/** A plugin registry holding whatever a test wants to offer as an API. */
function appWith(api: unknown): App {
  return { plugins: { plugins: { vizardry: { api } } } } as unknown as App;
}

const complete = {
  version: CANVAS_EXPORT_VERSION,
  getCanvases: () => [],
  whenSettled: () => Promise.resolve(),
  exportCanvas: () => Promise.resolve({})
};

describe("canvasExportApi", () => {
  it("takes an API that answers every call the contract names", () => {
    expect(canvasExportApi(appWith(complete), "vizardry")).toBe(complete);
  });

  it("takes a later version, because the calls themselves are checked", () => {
    const later = { ...complete, version: CANVAS_EXPORT_VERSION + 5 };
    expect(canvasExportApi(appWith(later), "vizardry")).toBe(later);
  });

  it("refuses a version below the one this plugin knows", () => {
    expect(canvasExportApi(appWith({ ...complete, version: 0 }), "vizardry")).toBeNull();
    expect(canvasExportApi(appWith({ ...complete, version: "1" }), "vizardry")).toBeNull();
  });

  it("refuses a version that is missing any one of the calls", () => {
    for (const missing of ["getCanvases", "whenSettled", "exportCanvas"]) {
      const partial: Record<string, unknown> = { ...complete };
      delete partial[missing];
      expect(canvasExportApi(appWith(partial), "vizardry")).toBeNull();
    }
  });

  it("refuses a plugin that is absent, or offers nothing", () => {
    expect(canvasExportApi(appWith(undefined), "vizardry")).toBeNull();
    expect(canvasExportApi(appWith("an api, honestly"), "vizardry")).toBeNull();
    expect(canvasExportApi({} as App, "vizardry")).toBeNull();
    expect(canvasExportApi(appWith(complete), "something-else")).toBeNull();
  });
});

describe("checkExportResult", () => {
  const answer = {
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    width: 800,
    height: 600,
    scale: 2,
    format: "png",
    title: "Wardley"
  };

  it("takes an answer that is shaped the way the contract describes", () => {
    expect(checkExportResult(answer)).toEqual(answer);
  });

  it("keeps the scale that was used, which may be below the one asked for", () => {
    expect(checkExportResult({ ...answer, scale: 0.5 })?.scale).toBe(0.5);
  });

  it("refuses an answer carrying no picture", () => {
    expect(checkExportResult({ ...answer, blob: undefined })).toBeNull();
    expect(checkExportResult({ ...answer, blob: "data:image/png;base64,..." })).toBeNull();
    expect(checkExportResult({ ...answer, blob: new Blob([]) })).toBeNull();
  });

  it("refuses a picture with no size, which would place as nothing", () => {
    expect(checkExportResult({ ...answer, width: 0 })).toBeNull();
    expect(checkExportResult({ ...answer, height: -1 })).toBeNull();
    expect(checkExportResult({ ...answer, scale: Number.NaN })).toBeNull();
    expect(checkExportResult({ ...answer, width: "800" })).toBeNull();
  });

  it("fills in what it can do without, rather than refusing the picture", () => {
    const bare = checkExportResult({ ...answer, format: undefined, title: undefined });
    expect(bare).toMatchObject({ format: "png", title: "" });
  });

  it("refuses a picture that is not the format the page was promised", () => {
    expect(checkExportResult({ ...answer, format: "svg" })).toBeNull();
    expect(checkExportResult({ ...answer, format: "PNG" })).toBeNull();
    expect(checkExportResult({ ...answer, format: 1 })).toBeNull();
  });

  it("refuses anything that is not an answer at all", () => {
    expect(checkExportResult(null)).toBeNull();
    expect(checkExportResult("ok")).toBeNull();
  });
});

describe("exportErrorCode", () => {
  it("takes the code the contract rejects with", () => {
    expect(exportErrorCode({ code: "too-large", message: "8000 px exceeded" })).toBe("too-large");
    expect(exportErrorCode({ code: "not-rendered" })).toBe("not-rendered");
  });

  it("says the drawing failed when the rejection says nothing useful", () => {
    expect(exportErrorCode(new Error("boom"))).toBe("capture-failed");
    expect(exportErrorCode({ code: "" })).toBe("capture-failed");
    expect(exportErrorCode({ code: 7 })).toBe("capture-failed");
    expect(exportErrorCode(undefined)).toBe("capture-failed");
  });
});

describe("the no-enrich class", () => {
  it("is a plain class name, since it goes on an element before any API exists", () => {
    expect(NO_ENRICH_CLASS).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("falls back to the pinned name when there is no plugin to ask", () => {
    expect(noEnrichClass(null)).toBe(NO_ENRICH_CLASS);
    expect(noEnrichClass(canvasExportApi(appWith(complete), "vizardry"))).toBe(NO_ENRICH_CLASS);
  });

  it("prefers the name the plugin publishes, so a rename there needs no release here", () => {
    const renamed = canvasExportApi(
      appWith({ ...complete, noEnrichClass: "vzd-no-net" }),
      "vizardry"
    );
    expect(noEnrichClass(renamed)).toBe("vzd-no-net");
  });

  it("refuses a name that would add a second class or break the attribute", () => {
    for (const bad of ["two classes", "", "-leading", 'x" onload="', 42, null]) {
      const api = canvasExportApi(appWith({ ...complete, noEnrichClass: bad }), "vizardry");
      expect(noEnrichClass(api)).toBe(NO_ENRICH_CLASS);
    }
  });
});
