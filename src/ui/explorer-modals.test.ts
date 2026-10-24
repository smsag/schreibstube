// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { installObsidianDom } from "../testing/obsidian-dom";
import { setLanguage } from "../i18n";
import { PromptModal } from "./explorer-modals";

vi.mock("obsidian", async (importOriginal) => {
  const stub = await importOriginal<typeof import("../testing/obsidian-stub")>();
  /** A dialogue whose content is a plain element a test can type into. */
  class Modal extends stub.Modal {
    contentEl = document.body.createDiv();
  }
  return { ...stub, Modal };
});

beforeAll(() => {
  installObsidianDom();
  const proto = HTMLElement.prototype as unknown as Record<string, () => void>;
  proto.show = function (this: HTMLElement) {
    this.style.display = "";
  };
  proto.hide = function (this: HTMLElement) {
    this.style.display = "none";
  };
  setLanguage("en");
});

function prompt() {
  const submitted = vi.fn();
  const modal = new PromptModal({} as App, { title: "Rename", submitLabel: "Rename" }, submitted);
  modal.onOpen();
  const input = modal.contentEl.querySelector("input")!;
  input.value = "日本";
  const enter = (isComposing: boolean) =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing }));
  return { submitted, enter };
}

describe("PromptModal", () => {
  it("submits on Enter", () => {
    const { submitted, enter } = prompt();
    enter(false);
    expect(submitted).toHaveBeenCalledWith("日本");
  });

  it("leaves the Enter that takes a word from an input method to the input method", () => {
    const { submitted, enter } = prompt();
    enter(true);
    expect(submitted).not.toHaveBeenCalled();
  });
});
