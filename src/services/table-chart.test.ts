import { describe, expect, it } from "vitest";
import { numberFormatFor } from "./amounts";
import {
  CHART_MARKER,
  MAX_BARS,
  MAX_CHART_ROWS,
  axisRange,
  chartAbove,
  chartBlock,
  chartOffer,
  isFigure,
  placeChart,
  plainText,
  readDate,
  readTable,
  suggestCharts,
  tableAt,
  type ChartLabels,
  type PlainTable
} from "./table-chart";

const de = numberFormatFor("comma", "de");
const en = numberFormatFor("point", "en");

const labels: ChartLabels = {
  other: "Other",
  byGroup: (value, group) => `${value} by ${group}`,
  byGroups: (value, outer, inner) => `${value} by ${outer} and ${inner}`,
  perDay: (value) => `${value} per day`,
  perMonth: (value) => `${value} per month`,
  perYear: (value) => `${value} per year`
};

function table(header: string[], rows: string[][]): PlainTable {
  return { header, rows };
}

function suggestions(t: PlainTable, format = de) {
  const result = suggestCharts(t, format, labels);
  if (!result.ok) throw new Error(result.reason);
  return result.suggestions;
}

/** A bank statement's extract, the way the CSV view copies one. */
const STATEMENT = [
  "Some text above.",
  "",
  "| Datum      | Kategorie    | Empfänger | Betrag     |",
  "| ---------- | ------------ | --------- | ---------: |",
  "| 03.01.2026 | Lebensmittel | Rewe      | -45,90 €   |",
  "| 15.01.2026 | Wohnen       | Vonovia   | -980,00 €  |",
  "| 20.01.2026 | Lebensmittel | Edeka     | -32,10 €   |",
  "| 02.03.2026 | Mobilität    | DB        | -59,90 €   |",
  "| 15.03.2026 | Wohnen       | Vonovia   | -980,00 €  |",
  "| **Summe**  |              |           | **=sum**   |",
  "",
  "Text below."
];

describe("tableAt", () => {
  it("widens a selection inside a table to the whole table", () => {
    expect(tableAt(STATEMENT, 6, 6)).toEqual({ from: 2, to: 9 });
    expect(tableAt(STATEMENT, 2, 2)).toEqual({ from: 2, to: 9 });
    expect(tableAt(STATEMENT, 3, 3)).toEqual({ from: 2, to: 9 });
  });

  it("finds the table when the selection starts above it", () => {
    expect(tableAt(STATEMENT, 0, 5)).toEqual({ from: 2, to: 9 });
  });

  it("finds nothing outside a table", () => {
    expect(tableAt(STATEMENT, 0, 1)).toBeNull();
    expect(tableAt(STATEMENT, 11, 11)).toBeNull();
  });

  it("wants a header, a delimiter and a row", () => {
    expect(tableAt(["| a | b |", "| --- | --- |"], 0, 1)).toBeNull();
    expect(tableAt(["| a | b |", "| 1 | 2 |"], 0, 1)).toBeNull();
  });
});

describe("readTable", () => {
  it("leaves out the totals row and reads the cells as plain text", () => {
    const read = readTable(STATEMENT, { from: 2, to: 9 });
    expect(read.header).toEqual(["Datum", "Kategorie", "Empfänger", "Betrag"]);
    expect(read.rows).toHaveLength(5);
    expect(read.rows[0]).toEqual(["03.01.2026", "Lebensmittel", "Rewe", "-45,90 €"]);
  });

  it("pads short rows and skips empty ones", () => {
    const lines = ["| a | b |", "|---|---|", "| x |", "|  |  |", "| y | 2 |"];
    expect(readTable(lines, { from: 0, to: 4 }).rows).toEqual([
      ["x", ""],
      ["y", "2"]
    ]);
  });
});

describe("plainText", () => {
  it("keeps the words of links and formatting", () => {
    expect(plainText("**Rent** for [[Flat|the flat]]")).toBe("Rent for the flat");
    expect(plainText("[Rewe](https://rewe.de) `x`")).toBe("Rewe x");
    expect(plainText("A\\|B<br>C")).toBe("A|B C");
    expect(plainText("_food_")).toBe("food");
  });
});

describe("isFigure", () => {
  it("takes a number with its sign and currency, and nothing more", () => {
    for (const cell of [
      "-45,90 €",
      "€ 20",
      "1.234,50",
      "$1,200.00",
      "20,-",
      "300 EUR",
      "(12.50)",
      "R$ 9,90"
    ]) {
      expect(isFigure(cell), cell).toBe(true);
    }
    for (const cell of ["Shop 12", "Q1 2026", "2 × Milch 1,50 €", "€", "", "abc"]) {
      expect(isFigure(cell), cell).toBe(false);
    }
  });
});

describe("readDate", () => {
  it("reads the ways a table writes a date", () => {
    expect(readDate("2026-03-15", false)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("2026-03-15T10:00", false)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("2026-03", false)).toEqual({ year: 2026, month: 3, day: 1 });
    expect(readDate("15.03.2026", false)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("15.03.26", false)).toEqual({ year: 2026, month: 3, day: 15 });
  });

  it("settles slashes by a part above twelve, then by the number format", () => {
    expect(readDate("03/15/2026", true)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("15/03/2026", false)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("03/04/2026", true)).toEqual({ year: 2026, month: 4, day: 3 });
    expect(readDate("03/04/2026", false)).toEqual({ year: 2026, month: 3, day: 4 });
  });

  it("refuses what is not a day", () => {
    expect(readDate("31.02.2026", true)).toBeNull();
    expect(readDate("2026-13-01", true)).toBeNull();
    expect(readDate("Rewe", true)).toBeNull();
    expect(readDate("12,50", true)).toBeNull();
  });
});

describe("suggestCharts", () => {
  it("offers a statement over time and by category, spending drawn as positive", () => {
    const [time, share] = suggestions(readTable(STATEMENT, { from: 2, to: 9 }));
    expect(time?.kind).toBe("time");
    expect(time?.title).toBe("Betrag per month");
    expect(time?.source.split("\n")[0]).toBe(CHART_MARKER);
    // January to March, February empty but on the axis.
    expect(time?.source).toContain("x-axis [");
    expect(time?.source).toMatch(/x-axis \[("[^"]+", ){2}"[^"]+"\]/);
    expect(time?.source).toContain('y-axis "Betrag (EUR)" 0 --> 1200');
    expect(time?.source).toContain("bar [1058, 0, 1039.9]");

    expect(share?.kind).toBe("pie");
    expect(share?.title).toBe("Betrag by Kategorie");
    expect(share?.source).toContain("pie showData\n    title Betrag by Kategorie");
    expect(share?.source).toContain('"Wohnen" : 1960');
    expect(share?.source).toContain('"Lebensmittel" : 78');
    expect(share?.source).toContain('"Mobilität" : 59.9');
  });

  it("charts a summary table with one row per group as a pie", () => {
    const list = suggestions(
      table(
        ["Category", "Amount"],
        [
          ["Rent", "$1,200.00"],
          ["Food", "$410.50"],
          ["Travel", "$95.00"]
        ]
      ),
      en
    );
    expect(list.map((s) => s.kind)).toEqual(["pie"]);
    expect(list[0]?.source).toContain('"Food" : 410.5');
  });

  it("ranks many groups as bars and adds up the rest", () => {
    const rows = Array.from({ length: 20 }, (_, i) => [`Shop ${i + 1}`, String(100 - i)]);
    const [bars] = suggestions(table(["Shop", "Spent"], rows), en);
    expect(bars?.kind).toBe("bars");
    expect(bars?.source).toContain("xychart-beta horizontal");
    const values =
      /bar \[([^\]]+)\]/
        .exec(bars?.source ?? "")?.[1]
        ?.split(", ")
        .map(Number) ?? [];
    expect(values).toHaveLength(MAX_BARS);
    expect(values[0]).toBe(100);
    // The 12th bar is the rest: shops 12 to 20.
    expect(values[MAX_BARS - 1]).toBe([89, 88, 87, 86, 85, 84, 83, 82, 81].reduce((a, b) => a + b));
    expect(bars?.source).toContain('"Other"');
  });

  it("draws gains and losses as bars, never as slices", () => {
    const [bars] = suggestions(
      table(
        ["Project", "Result"],
        [
          ["A", "120"],
          ["B", "-40"],
          ["C", "15"]
        ]
      ),
      en
    );
    expect(bars?.kind).toBe("bars");
    expect(bars?.source).toContain("bar [120, 15, -40]");
  });

  it("offers a treemap for two columns of groups and no dates", () => {
    const list = suggestions(
      table(
        ["Shop", "Category", "Amount"],
        [
          ["Rewe", "Food", "45,90 €"],
          ["Edeka", "Food", "32,10 €"],
          ["Vonovia", "Housing", "980,00 €"],
          ["Rewe", "Food", "12,00 €"]
        ]
      )
    );
    expect(list.map((s) => s.kind)).toEqual(["pie", "treemap"]);
    const treemap = list[1]?.source ?? "";
    expect(treemap).toContain('treemap-beta\n"Amount by Category and Shop"');
    // The column with fewer values is the outer one.
    expect(treemap).toContain('    "Housing"\n        "Vonovia": 980');
    expect(treemap).toContain('    "Food"\n        "Rewe": 57.9\n        "Edeka": 32.1');
  });

  it("reads a column of years as time", () => {
    const [time] = suggestions(
      table(
        ["Jahr", "Umsatz"],
        [
          ["2023", "10.000 €"],
          ["2025", "14.500 €"]
        ]
      )
    );
    expect(time?.kind).toBe("time");
    expect(time?.title).toBe("Umsatz per year");
    expect(time?.source).toContain('x-axis ["2023", "2024", "2025"]');
    expect(time?.source).toContain("bar [10000, 0, 14500]");
  });

  it("draws a short stretch day by day", () => {
    const [time] = suggestions(
      table(
        ["Date", "Amount"],
        [
          ["2026-03-01", "10"],
          ["2026-03-03", "5"]
        ]
      ),
      en
    );
    expect(time?.title).toBe("Amount per day");
    expect(time?.source).toContain("bar [10, 0, 5]");
  });

  it("prefers the amount over a running balance", () => {
    const [share] = suggestions(
      table(
        ["Kategorie", "Betrag", "Saldo"],
        [
          ["Wohnen", "-980,00 €", "1.020,00 €"],
          ["Essen", "-45,90 €", "974,10 €"]
        ]
      )
    );
    expect(share?.source).toContain('"Wohnen" : 980');
  });

  it("keeps labels Mermaid can read", () => {
    const [pie] = suggestions(
      table(
        ["Item", "Price"],
        [
          ['The "big" one', "10"],
          ["x".repeat(60), "5"]
        ]
      ),
      en
    );
    expect(pie?.source).toContain(`"The 'big' one" : 10`);
    expect(pie?.source).toContain(`"${"x".repeat(39)}…" : 5`);
  });

  it("adds up the smaller groups of a treemap as one", () => {
    const rows = Array.from({ length: 14 }, (_, i) => [
      `Group ${i + 1}`,
      `Item ${i + 1}`,
      String(100 - i)
    ]);
    const both = [...rows, ...rows.map(([group, item, value]) => [group!, `${item} b`, value!])];
    const [, treemap] = suggestions(table(["Group", "Item", "Amount"], both), en);
    expect(treemap?.kind).toBe("treemap");
    const groups = (treemap?.source ?? "").split("\n").filter((line) => /^ {4}"/.test(line));
    expect(groups).toHaveLength(MAX_BARS);
    expect(groups[MAX_BARS - 1]).toBe('    "Other"');
  });

  it("charts a year by month and a longer stretch by year", () => {
    const months = suggestions(
      table(
        ["Date", "Amount"],
        [
          ["2025-01-10", "5"],
          ["2025-12-10", "7"]
        ]
      ),
      en
    );
    expect(months[0]?.title).toBe("Amount per month");
    const years = suggestions(
      table(
        ["Date", "Amount"],
        [
          ["2019-01-10", "5"],
          ["2025-12-10", "7"]
        ]
      ),
      en
    );
    expect(years[0]?.title).toBe("Amount per year");
    expect(years[0]?.source).toContain('"2019", "2020"');
  });

  it("gives an empty group cell a name", () => {
    const [pie] = suggestions(
      table(
        ["Kind", "Amount"],
        [
          ["", "5"],
          ["Food", "7"],
          ["Rent", "9"]
        ]
      ),
      en
    );
    expect(pie?.source).toContain('"–" : 5');
  });

  it("says why a table offers nothing", () => {
    const words = table(["Name", "City"], [["Ada", "London"]]);
    expect(suggestCharts(words, en, labels)).toEqual({ ok: false, reason: "no-amounts" });
    const lone = table(["Amount"], [["10"], ["20"]]);
    expect(suggestCharts(lone, en, labels)).toEqual({ ok: false, reason: "no-groups" });
    const mixed = table(
      ["Item", "Price"],
      [
        ["A", "10 €"],
        ["B", "$20"]
      ]
    );
    expect(suggestCharts(mixed, en, labels)).toEqual({ ok: false, reason: "mixed-currencies" });
    const zeros = table(["Item", "Price"], [["A", "0"]]);
    expect(suggestCharts(zeros, en, labels)).toEqual({ ok: false, reason: "no-amounts" });
    const long = table(
      ["Item", "Price"],
      Array.from({ length: MAX_CHART_ROWS + 1 }, () => ["A", "1"])
    );
    expect(suggestCharts(long, en, labels)).toEqual({ ok: false, reason: "too-long" });
  });
});

describe("axisRange", () => {
  it("runs from zero to a round number past the largest bar", () => {
    expect(axisRange([1058, 1065, 1070])).toBe("0 --> 1200");
    expect(axisRange([0.45, 0.3])).toBe("0 --> 0.5");
    expect(axisRange([200, 110])).toBe("0 --> 200");
    expect(axisRange([7])).toBe("0 --> 8");
  });

  it("reaches below zero for a negative bar, and never collapses", () => {
    expect(axisRange([130, -40])).toBe("-40 --> 150");
    expect(axisRange([-3.5])).toBe("-4 --> 0");
    expect(axisRange([0, 0])).toBe("0 --> 1");
  });
});

describe("placing a chart", () => {
  it("goes above the table with a blank line on either side", () => {
    const offer = chartOffer(STATEMENT, 5, 5, de, labels);
    if (!offer.ok) throw new Error(offer.reason);
    expect(offer.replaces).toBeNull();
    const edit = placeChart(STATEMENT, offer, offer.suggestions[0]!);
    expect(edit.from).toBe(2);
    expect(edit.to).toBeNull();
    expect(edit.text.startsWith("```mermaid\n%% schreibstube chart\n")).toBe(true);
    expect(edit.text.endsWith("```\n\n")).toBe(true);
  });

  it("puts a blank line under text that touches the table", () => {
    const lines = ["Text", "| a | b |", "|---|---|", "| x | 2 |", "| y | 3 |"];
    const offer = chartOffer(lines, 3, 3, en, labels);
    if (!offer.ok) throw new Error(offer.reason);
    expect(placeChart(lines, offer, offer.suggestions[0]!).text.startsWith("\n```mermaid")).toBe(
      true
    );
  });

  it("replaces the chart it made before", () => {
    const offer = chartOffer(STATEMENT, 5, 5, de, labels);
    if (!offer.ok) throw new Error(offer.reason);
    const block = chartBlock(offer.suggestions[0]!).split("\n");
    const lines = [...STATEMENT.slice(0, 2), ...block, "", ...STATEMENT.slice(2)];
    const again = chartOffer(lines, lines.length - 4, lines.length - 4, de, labels);
    if (!again.ok) throw new Error(again.reason);
    expect(again.replaces).toEqual({ from: 2, to: 1 + block.length });
    const edit = placeChart(lines, again, again.suggestions[1]!);
    expect(edit).toMatchObject({ from: 2, to: 1 + block.length });
  });

  it("leaves a Mermaid block someone wrote alone", () => {
    const lines = [
      "```mermaid",
      "pie",
      '  "A" : 1',
      "```",
      "",
      "| a | b |",
      "|---|---|",
      "| x | 2 |"
    ];
    expect(chartAbove(lines, 5)).toBeNull();
    const code = ["```js", "x", "```", "| a | b |", "|---|---|", "| x | 2 |"];
    expect(chartAbove(code, 3)).toBeNull();
    const unclosed = ["x", "y", "z", "```", "", "| a | b |"];
    expect(chartAbove(unclosed, 5)).toBeNull();
    const tilde = ["~~~mermaid", CHART_MARKER, "pie", "~~~", "| a | b |"];
    expect(chartAbove(tilde, 4)).toEqual({ from: 0, to: 3 });
    expect(chartAbove(["| a |"], 0)).toBeNull();
  });

  it("says when there is no table to chart", () => {
    expect(chartOffer(["Just text"], 0, 0, en, labels)).toEqual({ ok: false, reason: "no-table" });
  });
});
