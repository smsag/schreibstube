// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { installObsidianDom } from "../testing/obsidian-dom";
import { fakeViewApp } from "../testing/fake-item-view";
import { TFile } from "../testing/obsidian-stub";
import { setLanguage } from "../i18n";
import { CsvView } from "./csv-view";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FileView: (await import("../testing/fake-item-view")).FakeItemView
}));

beforeAll(() => {
  installObsidianDom();
  setLanguage("en");
});

async function shown(text: string) {
  const app = Object.assign(fakeViewApp(), {
    vault: { on: () => ({}), cachedRead: async () => text }
  });
  const view = new CsvView({ app } as unknown as WorkspaceLeaf, {
    copy: async () => undefined,
    formulaContext: () => ({
      format: { locale: "en", decimal: ".", spaceGroups: false },
      defaultCurrency: "",
      rates: null
    }),
    unavailable: () => ""
  });
  await view.onLoadFile(new TFile("Liste.csv") as never);
  const label = (column: number) =>
    view.contentEl.querySelectorAll<HTMLElement>(".schreibstube-csv-sort")[column]!;
  return { view, label };
}

describe("CsvView, sorting from the keyboard", () => {
  it("keeps the focus on the header that was pressed, so the next Enter sorts again", async () => {
    const { view, label } = await shown("Name,Menge\nBirne,2\nApfel,3\n");
    label(1).focus();
    label(1).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(view.contentEl.ownerDocument.activeElement).toBe(label(1));
    expect(label(1).classList.contains("is-sorted-asc")).toBe(true);
  });
});
