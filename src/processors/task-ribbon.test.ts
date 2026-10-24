// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownPostProcessorContext, Plugin } from "obsidian";
import { MarkdownRenderChild, MarkdownView, TFile } from "../testing/obsidian-stub";
import { setLanguage } from "../i18n";
import { installObsidianDom } from "../testing/obsidian-dom";
import { registerTaskRibbon } from "./task-ribbon";

type Handler = (...args: unknown[]) => void;

class Emitter {
  readonly refs = new Set<{ e: Emitter; name: string; handler: Handler }>();
  on(name: string, handler: Handler) {
    const ref = { e: this, name, handler };
    this.refs.add(ref);
    return ref;
  }
  offref(ref: { e: Emitter; name: string; handler: Handler }): void {
    this.refs.delete(ref);
  }
  trigger(name: string, ...args: unknown[]): void {
    for (const ref of this.refs) if (ref.name === name) ref.handler(...args);
  }
}

/** The ribbon in a note open in an editor, whose buffer a test types into. */
function mount(initial: string) {
  let buffer = initial;
  const view = Object.assign(new MarkdownView(), {
    file: new TFile("Note.md"),
    getMode: () => "source",
    editor: { getValue: () => buffer }
  });
  const workspace = Object.assign(new Emitter(), {
    getLeavesOfType: () => [{ view }]
  });
  const app = { workspace, metadataCache: new Emitter(), vault: {} };

  let processor: (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) => void = () => undefined;
  registerTaskRibbon({
    app,
    registerMarkdownCodeBlockProcessor: (_language: string, handler: typeof processor) => {
      processor = handler;
    }
  } as unknown as Plugin);

  const el = document.body.createDiv();
  processor("", el, {
    sourcePath: "Note.md",
    addChild: (child: MarkdownRenderChild) => child.load()
  } as unknown as MarkdownPostProcessorContext);

  const type = async (next: string) => {
    buffer = next;
    workspace.trigger("editor-change", view.editor, { file: view.file });
    await vi.advanceTimersByTimeAsync(100);
  };
  return { el, type };
}

beforeAll(() => {
  installObsidianDom();
  setLanguage("en");
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the task ribbon, kept current", () => {
  it("follows a tick", async () => {
    const { el, type } = mount("- [ ] a\n- [ ] b");
    await vi.advanceTimersByTimeAsync(0);
    expect(el.textContent).toBe("2 of 2 open");

    await type("- [x] a\n- [ ] b");
    expect(el.textContent).toBe("1 of 2 open");
  });

  it("leaves its line alone while a keystroke changes no count", async () => {
    const { el, type } = mount("- [ ] a\n\nText");
    await vi.advanceTimersByTimeAsync(0);
    const line = el.firstElementChild;

    await type("- [ ] a\n\nText, more of it");
    expect(el.firstElementChild).toBe(line);
  });
});
