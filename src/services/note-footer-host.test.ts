// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { noteFooterHost, watchViewMode } from "./workspace-internals";

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
