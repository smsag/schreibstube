// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isElementLike, isNodeLike, noteFooterHost, watchViewMode } from "./workspace-internals";

function view(html: string, previewMode?: unknown) {
  const contentEl = document.createElement("div");
  contentEl.innerHTML = html;
  return { contentEl, ...(previewMode === undefined ? {} : { previewMode }) };
}

describe("noteFooterHost", () => {
  it("puts the footer at the end of the editor's content while editing", () => {
    const v = view(`<div class="cm-sizer"></div><div class="markdown-preview-sizer"></div>`);
    expect(noteFooterHost(v, false)?.className).toBe("cm-sizer");
  });

  it("finds the editor's sizer in a pop-out window too", () => {
    const { contentEl } = view(
      '<div class="cm-sizer"><div class="cm-contentContainer"></div></div>'
    );
    // A pop-out window's elements are not of the main window's classes.
    vi.stubGlobal("HTMLElement", class PopoutHasItsOwn {});
    try {
      expect(noteFooterHost({ contentEl }, false)?.className).toBe("cm-sizer");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads the renderer's footer section while reading, even while it is detached", () => {
    // A long note detaches the sections off screen: the footer is in no page.
    const section = document.createElement("div");
    section.className = "mod-footer mod-ui";
    const v = view(`<div class="markdown-preview-sizer"></div>`, {
      renderer: { footer: { el: section } }
    });
    expect(noteFooterHost(v, true)).toBe(section);
  });

  it("finds the footer section in the page when the renderer is not reachable", () => {
    const v = view(
      `<div class="markdown-preview-sizer"><div class="section"></div><div class="mod-footer mod-ui"></div></div>`
    );
    expect(noteFooterHost(v, true)?.classList.contains("mod-footer")).toBe(true);
  });

  it("never uses the reading sizer itself, which is redrawn on every scroll", () => {
    const v = view(`<div class="markdown-preview-sizer"></div>`);
    expect(noteFooterHost(v, true)).toBeNull();
  });
});

describe("watchViewMode", () => {
  it("calls back when the view switches between editing and reading", async () => {
    const container = document.createElement("div");
    container.setAttribute("data-mode", "source");
    const onChange = vi.fn();
    const stop = watchViewMode(container, onChange);

    container.setAttribute("data-mode", "preview");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    container.setAttribute("data-mode", "source");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("watches nothing on a view without the attribute", () => {
    const onChange = vi.fn();
    const stop = watchViewMode(document.createElement("div"), onChange);
    expect(typeof stop).toBe("function");
  });
});

describe("isElementLike and isNodeLike", () => {
  it("take a pop-out window's element and node for what they are", () => {
    const el = document.createElement("div");
    const text = document.createTextNode("x");
    vi.stubGlobal("HTMLElement", class PopoutHasItsOwn {});
    vi.stubGlobal("Node", class PopoutHasItsOwn {});
    try {
      expect(isElementLike(el)).toBe(true);
      expect(isNodeLike(el)).toBe(true);
      expect(isNodeLike(text)).toBe(true);
      expect(isElementLike(text)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuse what is not one", () => {
    for (const value of [
      null,
      undefined,
      1,
      "div",
      {},
      { nodeType: 1 },
      { nodeType: "1", ownerDocument: null }
    ]) {
      expect(isElementLike(value)).toBe(false);
      expect(isNodeLike(value)).toBe(false);
    }
  });
});
