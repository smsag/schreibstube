// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { GlossaryMatcher } from "../services/glossary-matcher";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { installObsidianDom } from "../testing/obsidian-dom";
import { GLOSSARY_CHANGED_EVENT } from "../utils/constants";
import { createGlossaryUnderlineExtension } from "./glossary-underline";

beforeAll(() => installObsidianDom());
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** A matcher that flags every "Handy" as an error, and counts how often it was asked. */
function matcher() {
  const asked = { count: 0 };
  const value: GlossaryMatcher = {
    isEmpty: () => false,
    constraints: () => [],
    findHits(text) {
      asked.count += 1;
      return [...text.matchAll(/Handy/g)].map((match) => ({
        from: match.index,
        to: match.index + 5,
        matchedText: "Handy",
        replacement: "Mobiltelefon",
        kind: "avoid",
        severity: "error"
      })) as unknown as ReturnType<GlossaryMatcher["findHits"]>;
    }
  };
  return { value, asked };
}

function editor(doc: string, glossary: GlossaryMatcher): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        createGlossaryUnderlineExtension({
          getSettings: () => ({ ...DEFAULT_SETTINGS, glossaryLiveUnderline: true }),
          getMatcher: () => glossary
        })
      ]
    }),
    parent: document.body.createDiv()
  });
}

const underlined = (view: EditorView): string[] =>
  Array.from(view.dom.querySelectorAll(".schreibstube-glossary-hit"), (el) => el.textContent);

describe("the live glossary underline", () => {
  it("stays on its word while the note is typed into, before the rescan", () => {
    const view = editor("Das Handy klingelt.", matcher().value);
    expect(underlined(view)).toEqual(["Handy"]);

    view.dispatch({ changes: { from: 0, insert: "Heute: " } });
    expect(underlined(view)).toEqual(["Handy"]);
  });

  it("does not point past the end of a note that was cut short", () => {
    const view = editor("Text davor. Das Handy", matcher().value);
    expect(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length } })).not.toThrow();
    expect(underlined(view)).toEqual([]);
  });

  it("reads the note once for a burst of glossary changes", async () => {
    const glossary = matcher();
    const view = editor("Das Handy klingelt.", glossary.value);
    glossary.asked.count = 0;

    for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(1000);

    expect(glossary.asked.count).toBe(1);
    expect(underlined(view)).toEqual(["Handy"]);
    view.destroy();
  });
});
