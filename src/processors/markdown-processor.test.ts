// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownPostProcessorContext } from "obsidian";
import { createReadingPostProcessor } from "./markdown-processor";

/**
 * A note closed takes its reading view out of the document with the whole
 * leaf. The observer on the view's own parent never sees that, so the view
 * stayed in the processor's set, with its scroll handler, until unload.
 */

const ctx = {} as MarkdownPostProcessorContext;

function readingView(): { view: HTMLElement; section: HTMLElement } {
  const leaf = document.body.appendChild(document.createElement("div"));
  const view = leaf.appendChild(document.createElement("div"));
  view.className = "markdown-reading-view";
  const section = view.appendChild(document.createElement("div"));
  return { view, section };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the reading post-processor", () => {
  it("attaches to a view once, however many sections it renders", () => {
    const { processor } = createReadingPostProcessor(vi.fn());
    const { view, section } = readingView();
    const listen = vi.spyOn(view, "addEventListener");

    void processor(section, ctx);
    void processor(section, ctx);

    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("lets go of a view whose leaf has left the document, so it can attach again", () => {
    const { processor, sweep } = createReadingPostProcessor(vi.fn());
    const { view, section } = readingView();
    const listen = vi.spyOn(view, "addEventListener");
    const unlisten = vi.spyOn(view, "removeEventListener");
    void processor(section, ctx);

    view.parentElement?.remove();
    sweep();

    expect(unlisten).toHaveBeenCalledWith("scroll", expect.any(Function));
    document.body.appendChild(view);
    void processor(section, ctx);
    expect(listen).toHaveBeenCalledTimes(2);
  });

  it("keeps a view that is still on screen", () => {
    const { processor, sweep } = createReadingPostProcessor(vi.fn());
    const { view, section } = readingView();
    const unlisten = vi.spyOn(view, "removeEventListener");
    void processor(section, ctx);

    sweep();

    expect(unlisten).not.toHaveBeenCalled();
  });

  it("sweeps on the next render, whether or not the layout event has arrived", () => {
    const { processor } = createReadingPostProcessor(vi.fn());
    const closed = readingView();
    const unlisten = vi.spyOn(closed.view, "removeEventListener");
    void processor(closed.section, ctx);
    closed.view.parentElement?.remove();

    const open = readingView();
    void processor(open.section, ctx);

    expect(unlisten).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
