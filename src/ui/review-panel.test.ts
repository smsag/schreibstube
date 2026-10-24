// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { installObsidianDom } from "../testing/obsidian-dom";
import { fakeViewApp } from "../testing/fake-item-view";
import { setLanguage } from "../i18n";
import { EMPTY_REVIEW_STATE, ReviewPanelView } from "./review-panel";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ItemView: (await import("../testing/fake-item-view")).FakeItemView
}));

beforeAll(() => {
  installObsidianDom();
  (HTMLElement.prototype as unknown as Record<string, unknown>).setAttr = function (
    this: HTMLElement,
    key: string,
    value: string
  ) {
    this.setAttribute(key, value);
  };
  setLanguage("en");
});

describe("ReviewPanelView, the glossary chips", () => {
  it("says which glossaries are on, not only in colour", async () => {
    const view = new ReviewPanelView({ app: fakeViewApp() } as unknown as WorkspaceLeaf);
    await view.onOpen();
    view.updateReviewState({
      ...EMPTY_REVIEW_STATE,
      phase: "idle",
      glossary: {
        ...EMPTY_REVIEW_STATE.glossary,
        source: "session",
        selected: ["Glossar/Bau.md"],
        available: [
          { path: "Glossar/Bau.md", name: "Bau" },
          { path: "Glossar/Recht.md", name: "Recht" }
        ]
      }
    });
    const chips = Array.from(view.contentEl.querySelectorAll(".schreibstube-review-chip"));
    expect(chips.map((chip) => [chip.textContent, chip.getAttribute("aria-pressed")])).toEqual([
      ["Bau", "true"],
      ["Recht", "false"]
    ]);
  });
});
