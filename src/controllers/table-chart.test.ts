import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Editor } from "obsidian";
import { Notice } from "../testing/obsidian-stub";
import { setLanguage, t } from "../i18n";
import type { ChartSuggestion } from "../services/table-chart";
import { chartSelectedTable, refusalText, selectionMayChart } from "./table-chart";

interface Opened {
  suggestions: readonly ChartSuggestion[];
  replaces: boolean;
  choose: (suggestion: ChartSuggestion) => void;
}

const opened: Opened[] = [];
vi.mock("../ui/table-chart-modal", () => ({
  TableChartModal: class {
    constructor(
      _app: unknown,
      _path: string,
      suggestions: readonly ChartSuggestion[],
      replaces: boolean,
      choose: (suggestion: ChartSuggestion) => void
    ) {
      opened.push({ suggestions, replaces, choose });
    }
    open(): void {}
  }
}));

/** An editor over a string, with a selection from one line to another. */
class FakeEditor {
  constructor(
    public text: string,
    private readonly selection: { from: number; to: number }
  ) {}

  getValue(): string {
    return this.text;
  }

  getCursor(which: "from" | "to"): { line: number; ch: number } {
    return { line: this.selection[which], ch: 0 };
  }

  getLine(line: number): string {
    return this.text.split("\n")[line] ?? "";
  }

  replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) {
    this.text = this.text.slice(0, this.offset(from)) + text + this.text.slice(this.offset(to));
  }

  private offset(pos: { line: number; ch: number }): number {
    const lines = this.text.split("\n").slice(0, pos.line);
    return lines.reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
  }
}

const TABLE = [
  "Spending:",
  "| Category | Amount |",
  "|---|---|",
  "| Rent | 980 € |",
  "| Food | 45 € |"
].join("\n");

const app = {} as App;

function open(text: string, line = 3): { editor: FakeEditor; dialog: Opened | undefined } {
  const editor = new FakeEditor(text, { from: line, to: line });
  chartSelectedTable(app, editor as unknown as Editor, "Note.md", "point");
  return { editor, dialog: opened[opened.length - 1] };
}

describe("charting the selected table", () => {
  beforeEach(() => {
    setLanguage("en");
    opened.length = 0;
    Notice.shown = [];
  });

  it("asks which chart, and puts the chosen one above the table", () => {
    const { editor, dialog } = open(TABLE);
    expect(dialog?.replaces).toBe(false);
    dialog?.choose(dialog.suggestions[0]!);
    const lines = editor.text.split("\n");
    expect(lines[0]).toBe("Spending:");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("```mermaid");
    expect(lines[3]).toBe("%% schreibstube chart");
    expect(editor.text.endsWith(`\`\`\`\n\n${TABLE.split("\n").slice(1).join("\n")}`)).toBe(true);
  });

  it("replaces the chart it made before", () => {
    const first = open(TABLE);
    first.dialog?.choose(first.dialog.suggestions[0]!);
    const once = first.editor.text;
    const again = open(once, once.split("\n").length - 1);
    expect(again.dialog?.replaces).toBe(true);
    again.dialog?.choose(again.dialog.suggestions[0]!);
    expect(again.editor.text).toBe(once);
  });

  it("says so, and writes nothing, when the table changed while the dialog was open", () => {
    const { editor, dialog } = open(TABLE);
    editor.text = editor.text.replace("45 €", "55 €");
    dialog?.choose(dialog.suggestions[0]!);
    expect(editor.text).not.toContain("mermaid");
    expect(Notice.shown).toEqual([t().common.notice(t().chart.changed)]);
  });

  it("says why a selection offers no chart", () => {
    const { dialog } = open("Just text", 0);
    expect(dialog).toBeUndefined();
    expect(Notice.shown).toEqual([t().common.notice(refusalText("no-table"))]);
  });

  it("offers the menu item only where a chart can be made", () => {
    const at = (text: string, line: number) =>
      selectionMayChart(
        new FakeEditor(text, { from: line, to: line }) as unknown as Editor,
        "point"
      );
    expect(at(TABLE, 3)).toBe(true);
    expect(at(TABLE, 0)).toBe(false);
    expect(at("| Name | City |\n|---|---|\n| Ada | London |", 2)).toBe(false);
  });

  it("words every refusal", () => {
    for (const reason of [
      "no-table",
      "too-long",
      "no-amounts",
      "no-groups",
      "mixed-currencies"
    ] as const) {
      expect(refusalText(reason)).not.toBe("");
    }
    expect(refusalText("too-long")).toContain("5,000");
  });
});
