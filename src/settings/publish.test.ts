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
      setCta: () => self,
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

function mount(
  extra: SchreibstubeSettings["publishAccounts"] = [],
  secrets: Record<string, string> = { publish: "token" },
  secretName = "publish"
): SettingsContext {
  const plugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      publishBridgeUrl: "https://bridge.example",
      publishTokenSecretName: secretName,
      publishAccounts: [
        {
          id: "a",
          name: "Blog",
          folder: "Blog",
          target: "alt",
          writeBack: true,
          aiDescription: false,
          headerTags: []
        },
        ...extra
      ]
    } as SchreibstubeSettings,
    saveSettings: async () => undefined,
    aiReady: () => false
  };
  const ctx = {
    app: {
      secretStorage: {
        getSecret: (name: string) => secrets[name] ?? null,
        setSecret: (name: string, value: string) => void (secrets[name] = value)
      },
      vault: { getAbstractFileByPath: () => null }
    },
    plugin,
    containerEl: document.body.createDiv(),
    update: async (patch: Partial<SchreibstubeSettings>) => {
      plugin.settings = { ...plugin.settings, ...patch };
    },
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
    await find((c) => c.placeholder === t().publish.targetPlaceholder).change?.("neu");
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
    await find((c) => c.placeholder === t().publish.targetPlaceholder).change?.("neu");
    await find((c) => c.label === t().publish.setupCopy).click?.();
    expect(copied[0]).toContain("PUBLISH_TARGETS=neu");
  });
});

describe("a site's card", () => {
  const site = (id: string, name: string, folder: string, target: string) => ({
    id,
    name,
    folder,
    target,
    writeBack: true,
    aiDescription: false,
    headerTags: []
  });

  it("opens on what to check, naming the other site", () => {
    const ctx = mount([site("b", "Notes", "Notes", "alt")]);
    const cards = Array.from(ctx.containerEl.querySelectorAll("details")).filter((el) =>
      el.classList.contains("schreibstube-publish-site")
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]?.open).toBe(true);
    expect(cards[0]?.textContent).toContain(t().publish.problemSameTarget("Notes"));
    expect(cards[0]?.textContent).toContain("Blog → alt");
  });

  it("stops naming a clash on the other card once one side has moved", async () => {
    const ctx = mount([site("b", "Notes", "Notes", "alt")]);
    const [first] = Array.from(ctx.containerEl.querySelectorAll("details"));
    expect(first?.textContent).toContain(t().publish.problemSameTarget("Notes"));

    await drawn.controls
      .filter((c) => c.placeholder === t().publish.targetPlaceholder)[1]
      ?.change?.("notes");
    // The field saves without being awaited; the cards are redrawn after the save.
    await new Promise((resolve) => setTimeout(resolve));
    expect(first?.textContent).not.toContain(t().publish.problemSameTarget("Notes"));
  });

  it("says a site whose folder the settings refuse is not kept", () => {
    const ctx = mount([site("b", "Config", ".obsidian", "config")]);
    const card = Array.from(ctx.containerEl.querySelectorAll("details"))[1];
    expect(card?.textContent).toContain(t().publish.statusNotKept);
    expect(card?.textContent).toContain(t().publish.problemNotKept);
  });

  it("says a half-filled site is not saved, and stops saying so once it is complete", async () => {
    const ctx = mount([site("b", "Notes", "", "")]);
    const card = Array.from(ctx.containerEl.querySelectorAll("details"))[1];
    expect(card?.textContent).toContain(t().publish.problemNotKept);
    expect(card?.textContent).toContain(t().publish.statusNotKept);

    await drawn.controls
      .filter((c) => c.placeholder === t().publish.accountFolder)[1]
      ?.change?.("Notes");
    await drawn.controls
      .filter((c) => c.placeholder === t().publish.targetPlaceholder)[1]
      ?.change?.("notes");
    expect(card?.textContent).not.toContain(t().publish.problemNotKept);
    expect(card?.textContent).toContain(t().publish.problemFolderMissing("Notes"));
  });
});

describe("the starter set", () => {
  function clipboard(): string[] {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) }
    });
    return copied;
  }

  it("carries the token this device already holds, and leaves it as it is", async () => {
    const copied = clipboard();
    const secrets = { publish: "the-running-bridges-token" };
    mount([], secrets);
    await find((c) => c.label === t().publish.setupStarter).click?.();
    expect(copied[0]).toContain("PUBLISH_TOKEN=the-running-bridges-token");
    expect(copied[0]).toContain("PORT=8080");
    expect(copied[0]).toContain("PUBLISH_TARGETS=alt");
    expect(secrets.publish).toBe("the-running-bridges-token");
  });

  it("makes a token when there is none, and saves it before copying it", async () => {
    const copied = clipboard();
    const secrets: Record<string, string> = {};
    const ctx = mount([], secrets, "");
    await find((c) => c.label === t().publish.setupStarter).click?.();
    const token = secrets["schreibstube-publish-token"];
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(copied[0]).toContain(`PUBLISH_TOKEN=${token}`);
    expect(ctx.plugin.settings.publishTokenSecretName).toBe("schreibstube-publish-token");
  });
});
