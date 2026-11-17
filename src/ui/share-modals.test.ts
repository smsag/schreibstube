import { beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { setLanguage, t } from "../i18n";
import type { SharedLink } from "../services/share-link";

/** The dialog's fields and buttons, by what they say, so a test can press them. */
const controls = vi.hoisted(() => ({
  field: { value: "" },
  buttons: new Map<string, () => void>()
}));

vi.mock("obsidian", async (importOriginal) => {
  const stub = await importOriginal<typeof import("../testing/obsidian-stub")>();
  const element = (): unknown => ({ empty() {}, createEl: () => element(), setText() {} });
  class Modal extends stub.Modal {
    contentEl = element();
  }
  class Setting extends stub.Setting {
    override addText(build?: (text: unknown) => void): this {
      const text = {
        setValue: (value: string) => ((controls.field.value = value), text),
        onChange: () => text
      };
      build?.(text);
      return this;
    }
    override addButton(build?: (button: unknown) => void): this {
      let label = "";
      const button = {
        setButtonText: (value: string) => ((label = value), button),
        setCta: () => button,
        setWarning: () => button,
        onClick: (click: () => void) => (controls.buttons.set(label, click), button)
      };
      build?.(button);
      return this;
    }
    override addDropdown(build?: (dropdown: unknown) => void): this {
      const dropdown = {
        addOption: () => dropdown,
        setValue: () => dropdown,
        onChange: () => dropdown
      };
      build?.(dropdown);
      return this;
    }
  }
  return { ...stub, Modal, Setting };
});

const { ShareModal } = await import("./share-modals");

beforeAll(() => setLanguage("en"));

const PROTECTED: SharedLink = {
  code: "apple-cloud",
  url: "https://blog.example.com/s/apple-cloud/",
  title: "Angebot",
  sourcePath: "Kunden/Angebot.md",
  createdAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-19T12:00:00.000Z",
  expiresAt: null,
  protected: true
};

describe("ShareModal", () => {
  it("still makes a protected link after an update that waited for the old password", () => {
    const submitted = vi.fn();
    new ShareModal({} as App, "Angebot", [PROTECTED], submitted, () => {}).onOpen();

    controls.buttons.get(t().share.update)?.();
    expect(submitted).not.toHaveBeenCalled();
    expect(controls.field.value).not.toBe("");

    controls.buttons.get(t().share.create)?.();
    expect(submitted).toHaveBeenCalledWith(
      expect.objectContaining({ password: controls.field.value })
    );
    expect(submitted.mock.calls[0]?.[0]).not.toHaveProperty("code");
  });
});
