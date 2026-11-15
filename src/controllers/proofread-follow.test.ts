// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import type { App } from "obsidian";
import { editorInfoField } from "../testing/obsidian-stub";
import { fakeVault } from "../testing/fake-app";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import type { Logger } from "../services/logger";
import type { Suggestion } from "../services/suggestion";
import type { ReviewState } from "../ui/review-panel";
import { createReviewFollowExtension } from "../processors/review-follow";
import { ProofreadController, type SyncStore } from "./proofread-controller";

/**
 * The queue against a real editor: the editor's transactions reach the
 * controller through the same extension the plugin registers, so a card moves
 * exactly as it would while a person types.
 */

const GLOSSARY = `---
schreibstubeGlossary: true
---

| Concept | Term      | Status     | Match |
|---------|-----------|------------|-------|
| objekt  | Objekt    | preferred  | word  |
| objekt  | Immobilie | deprecated | word  |
`;

const NOTE = "Die Immobilie steht. Die Immobilie wackelt.";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

async function setup(extraPane = false) {
  const vault = fakeVault({
    notes: [
      { path: "Glossary.md", content: GLOSSARY, frontmatter: { schreibstubeGlossary: true } },
      { path: "Note.md", content: NOTE }
    ]
  });
  const file = vault.file("Note.md");
  let controller: ProofreadController | null = null;
  const editorFor = (parent: HTMLElement): EditorView => {
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: NOTE,
        extensions: [
          editorInfoField.init(() => ({ file })),
          createReviewFollowExtension((path, dom, map) => controller?.followEdit(path, dom, map))
        ]
      })
    });
    views.push(view);
    return view;
  };
  const contentEl = document.createElement("div");
  const cm = editorFor(contentEl);
  // Only what the controller reaches for on the note's view.
  const markdown = {
    file,
    contentEl,
    editor: {
      getValue: () => cm.state.doc.toString(),
      offsetToPos: (offset: number) => offset,
      transaction: ({ changes }: { changes: Array<{ from: number; to: number; text: string }> }) =>
        cm.dispatch({ changes: changes.map(({ from, to, text }) => ({ from, to, insert: text })) })
    }
  };
  // A second pane on the same note, as Obsidian keeps it in step: the same
  // edit is dispatched to it.
  const other = extraPane ? editorFor(document.createElement("div")) : null;

  const app = {
    ...vault.app,
    workspace: {
      getActiveFile: () => file,
      getActiveViewOfType: () => markdown,
      getLeavesOfType: () => [{ view: markdown }]
    }
  } as unknown as App;
  const records = new Map();
  const store: SyncStore = {
    get: (path) => records.get(path),
    set: async (path, record) => void records.set(path, record),
    setMany: async () => {},
    forget: async (path) => void records.delete(path),
    all: () => Object.fromEntries(records),
    update: async () => {}
  };
  const quiet = () => {};
  const logger = { debug: quiet, info: quiet, warn: quiet, error: quiet } as unknown as Logger;
  controller = new ProofreadController(
    app,
    () => ({ ...DEFAULT_SETTINGS, glossaryDefault: ["Glossary.md"] }),
    logger,
    store
  );

  const handlers = controller.handlers();
  handlers.onGlossaryCheck();
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Asked afresh each time: a move that changes no status is not drawn, so
  // the last state the panel was sent can hold the old offsets.
  const cards = (): Suggestion[] => {
    let state: ReviewState | null = null;
    controller.onStateChange((next) => (state = next))();
    return (state as ReviewState | null)?.suggestions ?? [];
  };
  expect(cards().map((card) => [card.from, card.to, card.status])).toEqual([
    [4, 13, "pending"],
    [25, 34, "pending"]
  ]);

  const type = (from: number, insert: string, to = from): void => {
    const spec = { changes: { from, to, insert } };
    for (const view of views.slice(0, other ? 2 : 1)) view.dispatch(spec);
  };
  return { cards, handlers, text: () => markdown.editor.getValue(), type };
}

describe("the review queue while the note is edited", () => {
  it("keeps two cards on a repeated word pending and on their own copies through typing in front", async () => {
    const { cards, text, type } = await setup();
    type(0, "Heute: ");
    expect(cards().map((card) => card.status)).toEqual(["pending", "pending"]);
    for (const card of cards()) expect(text().slice(card.from, card.to)).toBe("Immobilie");
    expect(cards().map((card) => card.from)).toEqual([11, 32]);
  });

  it("accepts the copy the card was on, after typing", async () => {
    const { cards, handlers, text, type } = await setup();
    type(0, "Heute: ");
    handlers.onAccept(cards()[1]!.id);
    expect(text()).toBe("Heute: Die Immobilie steht. Die Objekt wackelt.");
  });

  it("moves the next card once, not twice, after one is accepted", async () => {
    const { cards, handlers, text } = await setup();
    handlers.onAccept(cards()[0]!.id);
    expect(text()).toBe("Die Objekt steht. Die Immobilie wackelt.");
    const [accepted, next] = cards();
    expect(accepted?.status).toBe("accepted");
    expect([next?.status, next?.from, next?.to]).toEqual(["pending", 22, 31]);
    handlers.onAccept(next!.id);
    expect(text()).toBe("Die Objekt steht. Die Objekt wackelt.");
  });

  it("follows the pane the queue applies to, not a second pane on the same note", async () => {
    const { cards, text, type } = await setup(true);
    type(0, "Heute: ");
    expect(cards().map((card) => card.from)).toEqual([11, 32]);
    for (const card of cards()) expect(text().slice(card.from, card.to)).toBe("Immobilie");
  });
});
