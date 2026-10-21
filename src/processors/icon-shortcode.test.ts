// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import type { Plugin } from "obsidian";
import { installObsidianDom } from "../testing/obsidian-dom";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createIconShortcodeExtension,
  registerIconShortcodePostProcessor,
  setTextWithIcons
} from "./icon-shortcode";

/**
 * Both halves of `:folder:`: which rendered text becomes a glyph in Reading
 * view, and which source text becomes one in Live Preview. Where a shortcode
 * counts in the source is tested in `services/icon-shortcode.test.ts`.
 */

type PostProcessor = (el: HTMLElement) => void;

function readingView(enabled = true): (html: string) => HTMLElement {
  let processor: PostProcessor = () => undefined;
  const plugin = {
    registerMarkdownPostProcessor: (handler: PostProcessor) => {
      processor = handler;
    }
  } as unknown as Plugin;
  registerIconShortcodePostProcessor(plugin, () => enabled);
  return (html) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    processor(el);
    return el;
  };
}

const glyphs = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll(".schreibstube-icon-shortcode")).map((span) =>
    (span as HTMLElement).title.replace(/:/g, "")
  );

beforeAll(() => {
  installObsidianDom();
  // Obsidian gives every node its document as `doc`, for popout windows.
  if (!("doc" in Node.prototype)) {
    Object.defineProperty(Node.prototype, "doc", {
      get(this: Node) {
        return this.ownerDocument ?? document;
      }
    });
  }
});

describe("shortcodes in Live Preview", () => {
  const NOTE = "## Werkzeugkasten [:timeline:](#x)\n\n:timeline:\n\nText :folder: und `:star:`";

  function editor(cursor: number, enabled = true): { view: EditorView; drawn: () => string[] } {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: NOTE,
        selection: EditorSelection.cursor(cursor),
        extensions: createIconShortcodeExtension(() => enabled)
      }),
      parent
    });
    return { view, drawn: () => glyphs(parent) };
  }

  it("draws every shortcode the editor shows, a link's label and a heading's included", () => {
    const { view, drawn } = editor(NOTE.length);
    expect(drawn()).toEqual(["timeline", "timeline", "folder"]);
    view.destroy();
  });

  it("shows the words of the one the cursor is on, and draws it again when it leaves", () => {
    const onSecond = NOTE.indexOf(":timeline:\n") + 3;
    const { view, drawn } = editor(onSecond);
    expect(drawn()).toEqual(["timeline", "folder"]);
    view.dispatch({ selection: EditorSelection.cursor(NOTE.length) });
    expect(drawn()).toEqual(["timeline", "timeline", "folder"]);
    view.destroy();
  });

  it("draws them when the editor reckons nothing is on screen", () => {
    // What a theme whose scroll containers CodeMirror misreads leaves it with:
    // every line drawn, and no range it counts as visible.
    const { view, drawn } = editor(NOTE.length);
    Object.defineProperty(view, "visibleRanges", { get: () => [] });
    view.dispatch({ changes: { from: NOTE.length, insert: " " } });
    expect(drawn()).toEqual(["timeline", "timeline", "folder"]);
    view.destroy();
  });

  it("draws nothing while the setting is off", () => {
    const { view, drawn } = editor(NOTE.length, false);
    expect(drawn()).toEqual([]);
    view.destroy();
  });
});

describe("shortcodes in Reading view", () => {
  const render = readingView();

  it("draws one in a heading", () => {
    const el = render("<h2>Werkzeugkasten :folder:</h2>");
    expect(glyphs(el)).toEqual(["folder"]);
    expect(el.querySelector("h2")?.textContent).not.toContain(":folder:");
  });

  it("draws one in a link's label, Markdown or wikilink", () => {
    const el = render(
      '<p><a class="external-link" href="https://x.de">:folder: Ablage</a> und ' +
        '<a class="internal-link" href="Ablage" data-href="Ablage">:star: Ablage</a></p>'
    );
    expect(glyphs(el)).toEqual(["folder", "star"]);
  });

  it("draws one in a link inside a heading", () => {
    const el = render('<h2>Werkzeugkasten <a href="https://x.de">:folder:</a></h2>');
    expect(glyphs(el)).toEqual(["folder"]);
  });

  it("leaves a link that shows its own address alone", () => {
    const el = render(
      '<p><a href="https://x.de/:folder:/">https://x.de/:folder:/</a> ' +
        '<a href="mailto:a:folder:@x.de">a:folder:@x.de</a></p>'
    );
    expect(glyphs(el)).toEqual([]);
  });

  it("leaves code alone", () => {
    expect(glyphs(render("<p><code>:folder:</code></p><pre>:folder:</pre>"))).toEqual([]);
  });

  it("draws nothing with the setting off", () => {
    expect(glyphs(readingView(false)("<p>:folder:</p>"))).toEqual([]);
  });
});

describe("text the plugin draws itself", () => {
  it("has its shortcodes drawn, the words around them kept", () => {
    const el = document.createElement("a");
    setTextWithIcons(el, "Werkzeugkasten :folder:", true);
    expect(glyphs(el)).toEqual(["folder"]);
    expect(el.textContent.startsWith("Werkzeugkasten ")).toBe(true);
  });

  it("is plain text with the setting off, or without a shortcode", () => {
    const off = document.createElement("a");
    setTextWithIcons(off, "Werkzeugkasten :folder:", false);
    expect(off.textContent).toBe("Werkzeugkasten :folder:");

    const plain = document.createElement("a");
    plain.textContent = "alt";
    setTextWithIcons(plain, "Lage", true);
    expect(plain.textContent).toBe("Lage");
  });
});
