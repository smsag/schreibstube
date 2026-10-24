// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { installObsidianDom } from "../testing/obsidian-dom";
import type { SettingsContext } from "./context";
import { renderSemantic } from "./semantic";

/** A settings row that draws an element, which is all the section needs of one. */
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Setting {
    settingEl: HTMLElement;
    controlEl: HTMLElement;
    constructor(parent: HTMLElement) {
      this.settingEl = parent.createDiv();
      this.controlEl = this.settingEl.createDiv();
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
    addToggle() {
      return this;
    }
    addText() {
      return this;
    }
    addButton() {
      return this;
    }
  }
  return { ...actual, Setting };
});

beforeAll(() => {
  installObsidianDom();
  setLanguage("en");
});

function mount() {
  const listeners = new Set<() => void>();
  const engine = {
    downloadMb: () => 0,
    status: async () => ({
      state: "ready",
      count: 3,
      done: 3,
      total: 3,
      error: null,
      outOfMemory: false,
      backend: null
    }),
    report: async () => null,
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sources: { registered: () => [] },
    settingsChanged: () => undefined,
    buildNow: () => undefined,
    rebuild: () => undefined
  };
  const register = vi.fn();
  const closers: Array<() => void> = [];
  const ctx = {
    app: {},
    plugin: {
      settings: { ...DEFAULT_SETTINGS, semanticSearchEnabled: true },
      semantic: engine,
      register,
      textSearchStats: () => null
    },
    containerEl: document.body.createDiv(),
    update: async () => undefined,
    refresh: () => undefined,
    index: [],
    onClose: (release: () => void) => closers.push(release)
  } as unknown as SettingsContext;
  renderSemantic(ctx);
  return { listeners, register, close: () => closers.forEach((release) => release()) };
}

describe("the search-by-meaning status in the settings", () => {
  it("stops listening to the index when the tab closes", () => {
    const { listeners, close } = mount();
    expect(listeners.size).toBe(1);
    close();
    expect(listeners.size).toBe(0);
  });

  it("leaves nothing with the plugin that would keep the tab alive until it unloads", () => {
    const { register } = mount();
    expect(register).not.toHaveBeenCalled();
  });
});
