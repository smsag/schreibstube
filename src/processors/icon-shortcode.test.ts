// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import type { Plugin } from "obsidian";
import { installObsidianDom } from "../testing/obsidian-dom";
import { registerIconShortcodePostProcessor, setTextWithIcons } from "./icon-shortcode";

/**
 * Reading view's half of `:folder:`: which rendered text becomes a glyph.
 * Where a shortcode counts in the source is tested in
 * `services/icon-shortcode.test.ts`.
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
