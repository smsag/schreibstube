import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Editor, Menu } from "obsidian";
import { Notice, TFile } from "../testing/obsidian-stub";
import { DEFAULT_SETTINGS } from "../services/plugin-settings";
import { RATES_MAX_AGE_MS, RATES_RETRY_MS, type ExchangeRates } from "../services/exchange-rates";
import { createLogger } from "../services/logger";
import { setLanguage } from "../i18n";
import type { SchreibstubeSettings } from "../types";
import { NO_FORMULAS, SumsController } from "./sums-controller";

const fetchEcbRates = vi.fn<(now: number) => Promise<ExchangeRates>>();
vi.mock("../platform/rates-client", () => ({
  fetchEcbRates: (now: number) => fetchEcbRates(now)
}));

const RATES: ExchangeRates = { date: "2026-09-26", fetchedAt: 0, rates: { USD: 1.25 } };
const logger = createLogger(() => false);
const plain = (text: string) => text.replace(/\u00a0|\u202f/g, " ");

const TABLE = "| A |\n|---|\n| 300 € |\n| 20 € |\n| =sum(fixed) |";
const MIXED = "| A |\n|---|\n| 300 € |\n| 25 $ |\n| =sum |";

interface Fixture {
  controller: SumsController;
  settings: SchreibstubeSettings;
  files: Map<string, string>;
  saved: ExchangeRates[];
  clock: { now: number };
  /** How often the vault was read or written, for the cases that must do neither. */
  touched: { count: number };
}

function fixture(patch: Partial<SchreibstubeSettings> = {}): Fixture {
  const settings: SchreibstubeSettings = {
    ...DEFAULT_SETTINGS,
    sumsNumberStyle: "comma",
    ...patch
  };
  const files = new Map<string, string>();
  const saved: ExchangeRates[] = [];
  const clock = { now: 1_000_000 };
  const touched = { count: 0 };
  const app = {
    vault: {
      read: async (file: TFile) => {
        touched.count++;
        return files.get(file.path) ?? "";
      },
      process: async (file: TFile, change: (data: string) => string) => {
        touched.count++;
        files.set(file.path, change(files.get(file.path) ?? ""));
      }
    }
  } as unknown as App;
  const controller = new SumsController(
    app,
    () => settings,
    async (rates) => {
      saved.push(rates);
      settings.sumsRates = rates;
    },
    logger,
    () => clock.now
  );
  return { controller, settings, files, saved, clock, touched };
}

beforeEach(() => {
  setLanguage("en");
  Notice.shown = [];
  fetchEcbRates.mockReset();
});

describe("a note on its way out", () => {
  it("leaves with each formula's result in its cell", async () => {
    const { controller } = fixture();
    expect(plain((await controller.forExport(TABLE)).text)).toContain("| 320 € |");
  });

  it("leaves a note without formulas exactly as it is", async () => {
    const { controller } = fixture();
    expect(await controller.forExport("Just prose, 300 €.")).toEqual({
      text: "Just prose, 300 €.",
      freezes: []
    });
  });

  it("puts a result without a number into words", async () => {
    const { controller } = fixture();
    const note = "| A |\n|---|\n| 1 € |\n| 2 $ |\n| =avg |";
    expect((await controller.forExport(note)).text).toContain("| mixed currencies |");
  });

  it("freezes a fixed total at what the copy that left said, not at the note's later state", async () => {
    const { controller, files } = fixture();
    const file = new TFile("a.md") as never;
    const sent = await controller.forExport(TABLE);
    // Changed while the upload or the typesetting ran.
    files.set("a.md", TABLE.replace("20 €", "80 €"));

    expect(await controller.freeze(file, sent.freezes)).toBe(1);
    expect(plain(files.get("a.md") ?? "")).toContain("| =sum(fixed: 320 €) |");
  });

  it("freezes nothing, and says why, when the note's formulas changed since", async () => {
    const { controller, files } = fixture();
    const sent = await controller.forExport(TABLE);
    files.set("a.md", TABLE.replace("=sum(fixed)", "=avg(fixed)"));

    await expect(controller.freeze(new TFile("a.md") as never, sent.freezes)).rejects.toThrow(
      "changed since it was sent"
    );
    expect(files.get("a.md")).toContain("=avg(fixed)");
  });

  it("does not touch a note with nothing to freeze", async () => {
    const { controller, files, touched } = fixture();
    const note = "Write =sum(fixed) in a table cell.";
    files.set("a.md", note);

    const sent = await controller.forExport(note);
    expect(await controller.freeze(new TFile("a.md") as never, sent.freezes)).toBe(0);
    expect(touched.count).toBe(0);
  });

  it("offers nothing to freeze when nobody gave it formulas", async () => {
    expect(await NO_FORMULAS.forExport(TABLE)).toEqual({ text: TABLE, freezes: [] });
    expect(await NO_FORMULAS.freeze(new TFile("a.md") as never, [])).toBe(0);
  });

  it("says how many totals the command froze", async () => {
    const { controller, files } = fixture();
    files.set("a.md", TABLE);
    await controller.freezeNote(new TFile("a.md") as never);
    expect(Notice.shown.join(" ")).toContain("1 total frozen");
  });
});

describe("exchange rates", () => {
  const converting = { sumsConvert: true, sumsDefaultCurrency: "EUR" };

  it("are fetched for a note that mixes currencies, and kept", async () => {
    const f = fixture(converting);
    fetchEcbRates.mockResolvedValue({ ...RATES, fetchedAt: f.clock.now });

    const resolved = plain((await f.controller.forExport(MIXED)).text);

    expect(fetchEcbRates).toHaveBeenCalledTimes(1);
    expect(f.saved).toHaveLength(1);
    expect(resolved).toContain("≈ 320,00 € · ECB 26.09.2026");
  });

  it("are not fetched while converting is off, or for a note in one currency", async () => {
    await fixture().controller.forExport(MIXED);
    await fixture(converting).controller.forExport(TABLE);
    expect(fetchEcbRates).not.toHaveBeenCalled();
  });

  it("are not fetched again while the kept ones are fresh", async () => {
    const f = fixture({ ...converting, sumsRates: { ...RATES, fetchedAt: 1_000_000 } });
    f.clock.now += RATES_MAX_AGE_MS - 1;
    await f.controller.forExport(MIXED);
    expect(fetchEcbRates).not.toHaveBeenCalled();
  });

  it("are not asked for again soon after a failure, and the total gives subtotals", async () => {
    const f = fixture(converting);
    fetchEcbRates.mockRejectedValue(new Error("offline"));

    expect(plain((await f.controller.forExport(MIXED)).text)).toContain("| 300 € + 25 $ |");
    await f.controller.forExport(MIXED);
    expect(fetchEcbRates).toHaveBeenCalledTimes(1);

    f.clock.now += RATES_RETRY_MS + 1;
    await f.controller.forExport(MIXED);
    expect(fetchEcbRates).toHaveBeenCalledTimes(2);
  });

  it("say how it went when a person asked for them", async () => {
    const f = fixture();
    fetchEcbRates.mockResolvedValueOnce(RATES).mockRejectedValueOnce(new Error("offline"));

    await f.controller.updateRates(true);
    expect(Notice.shown.pop()).toContain("exchange rates of 26.09.2026 fetched");
    await f.controller.updateRates(true);
    expect(Notice.shown.pop()).toContain("could not be fetched: offline");
  });

  it("answer a person who asks while a fetch is already running", async () => {
    // The bug: "Update now" pressed during a background fetch said nothing.
    const f = fixture();
    let release: (rates: ExchangeRates) => void = () => undefined;
    fetchEcbRates.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

    const background = f.controller.updateRates(false);
    const asked = f.controller.updateRates(true);
    release(RATES);
    await Promise.all([background, asked]);

    expect(fetchEcbRates).toHaveBeenCalledTimes(1);
    expect(Notice.shown).toHaveLength(1);
    expect(Notice.shown[0]).toContain("fetched");
  });

  it("are asked for by a table on screen that needs them, without waiting", async () => {
    const f = fixture(converting);
    fetchEcbRates.mockResolvedValue(RATES);
    const redraw = vi.fn();
    f.controller.useRedraw(redraw);
    f.controller.seen([{ kind: "mixed" }]);
    await vi.waitFor(() => expect(redraw).toHaveBeenCalledTimes(1));
    expect(f.saved).toHaveLength(1);
  });
});

describe("the selection", () => {
  function editor(selection: string): Editor {
    return { getSelection: () => selection } as unknown as Editor;
  }

  it("is summed into a notice by the command", () => {
    const { controller } = fixture();
    controller.sumSelection(editor("Groceries 300 €\nCar 20 €"));
    expect(plain(Notice.shown.pop() ?? "")).toContain("320 € (2 amounts)");
  });

  it("says when it holds no amounts", () => {
    const { controller } = fixture();
    controller.sumSelection(editor("no figures here"));
    expect(Notice.shown.pop()).toContain("no amounts in the selection");
  });

  it("offers its total in the editor's menu, and nothing without amounts", () => {
    const { controller } = fixture();
    const titles: string[] = [];
    const item = {
      setTitle: (title: string) => (titles.push(title), item),
      setIcon: () => item,
      setSection: () => item,
      onClick: () => item
    };
    const menu = { addItem: (build: (i: typeof item) => void) => build(item) } as unknown as Menu;

    controller.addMenuItem(menu, editor("300 €"));
    controller.addMenuItem(menu, editor("nothing"));

    expect(titles.map(plain)).toEqual(["Copy sum: 300 €"]);
  });

  it("shows in the status bar from two amounts, and hides again", () => {
    const { controller } = fixture();
    const classes = new Set<string>();
    let text = "";
    const el = {
      addClass: (...names: string[]) => names.forEach((name) => classes.add(name)),
      setAttr: () => undefined,
      addEventListener: () => undefined,
      setText: (value: string) => (text = value),
      toggleClass: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name))
    } as unknown as HTMLElement;

    vi.useFakeTimers();
    // The controller's timers are the window's, as they are in Obsidian.
    vi.stubGlobal("window", globalThis);
    try {
      controller.startStatusBar(el);
      expect(classes.has("is-hidden")).toBe(true);

      const extension = controller.editorExtension() as unknown as {
        value: (update: unknown) => void;
      };
      const selected = "Groceries 300 €\nCar 20 €";
      extension.value({
        selectionSet: true,
        docChanged: false,
        view: {
          state: {
            selection: { ranges: [{ empty: false, from: 0, to: selected.length }] },
            sliceDoc: (from: number, to: number) => selected.slice(from, to)
          }
        }
      });
      vi.runAllTimers();
      expect(plain(text)).toBe("∑ 320 € · 2 amounts");
      expect(classes.has("is-hidden")).toBe(false);

      controller.clearSelection();
      expect(classes.has("is-hidden")).toBe(true);

      // Prose with numbers in it is no list of figures.
      const prose = "Im Jahr 2024 schrieb sie das Buch,\nund Kapitel 3 kam zuletzt.";
      extension.value({
        selectionSet: true,
        docChanged: false,
        view: {
          state: {
            selection: { ranges: [{ empty: false, from: 0, to: prose.length }] },
            sliceDoc: (from: number, to: number) => prose.slice(from, to)
          }
        }
      });
      vi.runAllTimers();
      expect(classes.has("is-hidden")).toBe(true);
    } finally {
      controller.stop();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
