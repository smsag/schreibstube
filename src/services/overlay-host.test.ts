import { describe, expect, it } from "vitest";
import { findOverlayHost } from "./overlay-host";

describe("findOverlayHost", () => {
  it("prefers editor scroller when available", () => {
    const editorHost = { id: "cm" } as unknown as HTMLElement;
    const readingHost = { id: "reading" } as unknown as HTMLElement;

    const container = {
      querySelector: (selector: string) => {
        if (selector === ".cm-scroller") {
          return editorHost;
        }

        if (selector === ".markdown-reading-view") {
          return readingHost;
        }

        return null;
      }
    } as unknown as ParentNode;

    expect(findOverlayHost(container)).toBe(editorHost);
  });

  it("falls back to reading host", () => {
    const readingHost = { id: "reading" } as unknown as HTMLElement;

    const container = {
      querySelector: (selector: string) => {
        if (selector === ".cm-scroller") {
          return null;
        }

        if (selector === ".markdown-reading-view") {
          return readingHost;
        }

        return null;
      }
    } as unknown as ParentNode;

    expect(findOverlayHost(container)).toBe(readingHost);
  });

  it("returns null when no supported host exists", () => {
    const container = {
      querySelector: () => null
    } as unknown as ParentNode;

    expect(findOverlayHost(container)).toBeNull();
  });
});
