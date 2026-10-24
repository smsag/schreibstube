// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, t } from "../i18n";
import { checkTarget } from "../platform/publish-client";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { installObsidianDom } from "../testing/obsidian-dom";
import type { SchreibstubeSettings } from "../types";
import type { SettingsContext } from "./context";
import { renderPublish } from "./publish";

/** Every control the section draws, with what it was labelled and what it does when used. */
const drawn = vi.hoisted(() => ({
  controls: [] as {
    placeholder?: string;
    label?: string;
    change?: (value: string) => unknown;
    click?: () => unknown;
  }[]
}));

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const control = () => {
    const entry: (typeof drawn.controls)[number] = {};
    drawn.controls.push(entry);
    const inputEl = document.createElement("input");
    const self = {
      inputEl,
      setPlaceholder: (placeholder: string) => ((entry.placeholder = placeholder), self),
      setButtonText: (label: string) => ((entry.label = label), self),
      setValue: (value: unknown) => ((inputEl.value = String(value)), self),
      onChange: (change: (value: string) => unknown) => ((entry.change = change), self),
      onClick: (click: () => unknown) => ((entry.click = click), self),
      setDisabled: () => self,
      setWarning: () => self,
      addOption: () => self
    };
    return self;
  };
  class Setting {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    nameEl: HTMLElement;
    constructor(parent: HTMLElement) {
      this.settingEl = parent.createDiv();
      this.controlEl = this.settingEl.createDiv();
      this.nameEl = this.settingEl.createDiv();
    }
    setName() {
      return this;
    }
    setDesc() {
      return this;
    }
    setHeading() {
      return this;
    }
    addComponent() {
      return this;
    }
    private add(build: (component: ReturnType<typeof control>) => unknown) {
      build(control());
      return this;
    }
    addText(build: (component: ReturnType<typeof control>) => unknown) {
      return this.add(build);
    }
    addToggle(build: (component: ReturnType<typeof control>) => unknown) {
      return this.add(build);
    }
    addButton(build: (component: ReturnType<typeof control>) => unknown) {
      return this.add(build);
    }
    addDropdown(build: (component: ReturnType<typeof control>) => unknown) {
      return this.add(build);
    }
  }
  return { ...actual, Setting };
});

vi.mock("../platform/publish-client", () => ({
  listTargets: vi.fn(async () => []),
  checkTarget: vi.fn(async () => ({ ok: true, entries: 2 }))
}));

vi.mock("../controllers/bridge-trust", () => ({ confirmBridge: async () => true }));

beforeAll(() => {
  installObsidianDom();
  setLanguage("en");
});

beforeEach(() => {
  drawn.controls.length = 0;
  vi.mocked(checkTarget).mockClear();
});

function mount(): SettingsContext {
  const plugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      publishBridgeUrl: "https://bridge.example",
      publishTokenSecretName: "publish",
      publishAccounts: [
        {
          id: "a",
          name: "Blog",
          folder: "Blog",
          target: "alt",
          writeBack: true,
          aiDescription: false,
          headerTags: []
        }
      ]
    } as SchreibstubeSettings,
    saveSettings: async () => undefined,
    aiReady: () => false
  };
  const ctx = {
    app: { secretStorage: { getSecret: () => "token" } },
    plugin,
    containerEl: document.body.createDiv(),
    update: async () => undefined,
    refresh: () => undefined,
    index: [],
    onClose: () => undefined
  } as unknown as SettingsContext;
  renderPublish(ctx);
  return ctx;
}

const find = (match: (control: (typeof drawn.controls)[number]) => boolean) => {
  const found = drawn.controls.find(match);
  if (!found) throw new Error("control not drawn");
  return found;
};

describe("an account's target, just typed", () => {
  it("is the one the connection test asks about", async () => {
    mount();
    await find((c) => c.placeholder === t().publish.accountTarget).change?.("neu");
    await find((c) => c.label === t().common.testConnection).click?.();
    expect(vi.mocked(checkTarget).mock.calls[0]?.[1]).toBe("neu");
  });

  it("is the one the setup block is written for", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) }
    });
    mount();
    await find((c) => c.placeholder === t().publish.accountTarget).change?.("neu");
    await find((c) => c.label === t().publish.setupCopy).click?.();
    expect(copied[0]).toContain("PUBLISH_TARGETS=neu");
  });
});
