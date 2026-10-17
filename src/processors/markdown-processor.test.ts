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

function readingView(): { view: HTMLElement; scroller: HTMLElement; section: HTMLElement } {
  const leaf = document.body.appendChild(document.createElement("div"));
  const view = leaf.appendChild(document.createElement("div"));
  view.className = "markdown-reading-view";
  const scroller = view.appendChild(document.createElement("div"));
  scroller.className = "markdown-preview-view";
  const section = scroller.appendChild(document.createElement("div"));
  return { view, scroller, section };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the reading post-processor", () => {
  it("attaches to a view once, however many sections it renders", () => {
    const { processor } = createReadingPostProcessor(vi.fn());
    const { scroller, section } = readingView();
    const listen = vi.spyOn(scroller, "addEventListener");

    void processor(section, ctx);
    void processor(section, ctx);

    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("lets go of a view whose leaf has left the document, so it can attach again", () => {
    const { processor, sweep } = createReadingPostProcessor(vi.fn());
    const { view, scroller, section } = readingView();
    const listen = vi.spyOn(scroller, "addEventListener");
    const unlisten = vi.spyOn(scroller, "removeEventListener");
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
    const { scroller, section } = readingView();
    const unlisten = vi.spyOn(scroller, "removeEventListener");
    void processor(section, ctx);

    sweep();

    expect(unlisten).not.toHaveBeenCalled();
  });

  it("sweeps on the next render, whether or not the layout event has arrived", () => {
    const { processor } = createReadingPostProcessor(vi.fn());
    const closed = readingView();
    const unlisten = vi.spyOn(closed.scroller, "removeEventListener");
    void processor(closed.section, ctx);
    closed.view.parentElement?.remove();

    const open = readingView();
    void processor(open.section, ctx);

    expect(unlisten).toHaveBeenCalledWith("scroll", expect.any(Function));
  });

  it("hears the page scroll, which happens inside the view and does not bubble out of it", () => {
    const onScroll = vi.fn();
    const { processor } = createReadingPostProcessor(onScroll);
    const { scroller, section } = readingView();
    void processor(section, ctx);
    onScroll.mockClear();

    scroller.dispatchEvent(new Event("scroll"));

    expect(onScroll).toHaveBeenCalledTimes(1);
  });
});
