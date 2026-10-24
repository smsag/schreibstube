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
  mayChart,
  placeChart,
  plainText,
  readDate,
  readTable,
  slashOrder,
  suggestCharts,
  tableAt,
  uniqueLabels,
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
  perYear: (value) => `${value} per year`,
  without: (title, rows) => `${title} (without ${rows})`
};

function table(header: string[], rows: string[][]): PlainTable {
  return { header, rows };
}

function suggestions(t: PlainTable, format = de) {
  const result = suggestCharts(t, format, labels);
  if (!result.ok) throw new Error(result.reason);
  return result.suggestions;
}

function offered(lines: readonly string[], line: number, format = de) {
  const offer = chartOffer(lines, line, line, format, labels);
  if (!offer.ok) throw new Error(offer.reason);
  return offer;
}

function placed(...args: Parameters<typeof placeChart>) {
  const edit = placeChart(...args);
  if (!edit) throw new Error("not placed");
  return edit;
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

  it("looks past lines with pipes that make no table", () => {
    const lines = ["a | b", "c | d", "", "| x | y |", "|---|---|", "| 1 | 2 |"];
    expect(tableAt(lines, 0, 5)).toEqual({ from: 3, to: 5 });
  });

  it("never takes a table from a code block", () => {
    const lines = ["```md", "| a | b |", "|---|---|", "| 1 | 2 |", "```"];
    expect(tableAt(lines, 0, 4)).toBeNull();
    expect(tableAt(lines, 2, 2)).toBeNull();
  });
});

describe("readTable", () => {
  it("leaves out the totals row and reads the cells as plain text", () => {
    const read = readTable(STATEMENT, { from: 2, to: 9 });
    expect(read.header).toEqual(["Datum", "Kategorie", "Empfänger", "Betrag"]);
    expect(read.rows).toHaveLength(5);
    expect(read.rows[0]).toEqual(["03.01.2026", "Lebensmittel", "Rewe", "-45,90 €"]);
  });

  it("takes a formula cell for the total, and a formula in a sentence for words", () => {
    const lines = [
      "| Item | Note | Amount |",
      "|---|---|---|",
      "| A | type =sum to add up | 5 |",
      "| B |  | 7 |",
      "| _=sum_ |  |  |"
    ];
    expect(readTable(lines, { from: 0, to: 4 }).rows.map((row) => row[0])).toEqual(["A", "B"]);
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
      "R$ 9,90"
    ]) {
      expect(isFigure(cell), cell).toBe(true);
    }
    // A bracketed loss would be read as a gain.
    for (const cell of ["Shop 12", "Q1 2026", "2 × Milch 1,50 €", "€", "", "abc", "(12.50)"]) {
      expect(isFigure(cell), cell).toBe(false);
    }
  });
});

describe("readDate", () => {
  it("reads the ways a table writes a date", () => {
    expect(readDate("2026-03-15", false)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("2026-03-15T10:00", false)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("2026-03-15 10:00:30+02:00", false)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("2026-03", false)).toEqual({ year: 2026, month: 3, day: 1 });
    expect(readDate("15.03.2026", false)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("15.03.26", false)).toEqual({ year: 2026, month: 3, day: 15 });
  });

  it("reads slashes the way it is told", () => {
    expect(readDate("03/04/2026", true)).toEqual({ year: 2026, month: 4, day: 3 });
    expect(readDate("03/04/2026", false)).toEqual({ year: 2026, month: 3, day: 4 });
    expect(readDate("15/03/2026", true)).toEqual({ year: 2026, month: 3, day: 15 });
    expect(readDate("15/03/2026", false)).toBeNull();
  });

  it("settles a column's slashes by any day above twelve, then by the number format", () => {
    expect(slashOrder(["03/04/2026", "15/04/2026"], false)).toBe(true);
    expect(slashOrder(["04/03/2026", "04/15/2026"], true)).toBe(false);
    expect(slashOrder(["03/04/2026", "2026-05-01"], true)).toBe(true);
    expect(slashOrder(["03/04/2026"], false)).toBe(false);
    expect(slashOrder(["15/04/2026", "04/15/2026"], true)).toBeNull();
  });

  it("refuses what is not a day", () => {
    expect(readDate("31.02.2026", true)).toBeNull();
    expect(readDate("2026-13-01", true)).toBeNull();
    expect(readDate("Rewe", true)).toBeNull();
    expect(readDate("12,50", true)).toBeNull();
    expect(readDate("2026-03-15 Miete", true)).toBeNull();
    expect(readDate("2026-03 bis 2026-04", true)).toBeNull();
    expect(readDate("2026-03-15Tomorrow", true)).toBeNull();
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

  it("charts the sign most rows have and says how many of the other it leaves out", () => {
    const [pie] = suggestions(
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
    expect(pie?.title).toBe("Result by Project (without 1)");
    expect(pie?.source).toContain("title Result by Project (without 1)");
    expect(pie?.source).not.toContain('"B"');
  });

  it("leaves a refund out of a statement's spending, and says so", () => {
    const refund = "| 10.03.2026 | Lebensmittel | Rewe      | 12,00 €    |";
    const lines = [...STATEMENT.slice(0, 8), refund, ...STATEMENT.slice(8)];
    const [time, share] = offered(lines, 5).suggestions;
    expect(time?.title).toBe("Betrag per month (without 1)");
    expect(time?.source).toContain("bar [1058, 0, 1039.9]");
    expect(time?.source).toContain('y-axis "Betrag (EUR)" 0 --> 1200');
    expect(share?.source).toContain('"Lebensmittel" : 78');
  });

  it("weighs a tie of signs by the amounts", () => {
    const [pie] = suggestions(
      table(
        ["Who", "Amount"],
        [
          ["A", "-500"],
          ["B", "20"]
        ]
      ),
      en
    );
    expect(pie?.source).toContain('"A" : 500');
  });

  it("charts only figures, counting the rest, and passes over a dash", () => {
    const [pie] = suggestions(
      table(
        ["Item", "Amount"],
        [
          ["A", "10"],
          ["B", "ca. 40"],
          ["C", "–"],
          ["D", "(5)"],
          ...["E", "F", "G", "H", "I", "J", "K"].map((item) => [item, "6"])
        ]
      ),
      en
    );
    expect(pie?.title).toBe("Amount by Item (without 2)");
    expect(pie?.source).not.toContain('"B"');
    expect(pie?.source).not.toContain('"D"');
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

  it("reads a column as years only when its name says so", () => {
    const counts = suggestions(
      table(
        ["Group", "Count"],
        [
          ["A", "1950"],
          ["B", "2000"]
        ]
      ),
      en
    );
    expect(counts.map((s) => s.kind)).toEqual(["pie"]);
    const [years] = suggestions(
      table(
        ["Baujahr", "Kaufpreis"],
        [
          ["1998", "300.000 €"],
          ["", "250.000 €"],
          ["2000", "410.000 €"]
        ]
      )
    );
    expect(years?.title).toBe("Kaufpreis per year (without 1)");
    expect(years?.source).toContain('x-axis ["1998", "1999", "2000"]');
  });

  it("counts a row whose date it cannot read as left out", () => {
    const rows = Array.from({ length: 10 }, (_, i) => [`2026-0${(i % 3) + 1}-10`, "5"]);
    rows.push(["soon", "100"]);
    const [time] = suggestions(table(["Date", "Amount"], rows), en);
    expect(time?.title).toBe("Amount per month (without 1)");
    expect(time?.source).not.toContain("100");
  });

  it("reads slashed dates the one way their column writes them", () => {
    const [time] = suggestions(
      table(
        ["Date", "Amount"],
        [
          ["03/04/2026", "10"],
          ["15/05/2026", "20"]
        ]
      ),
      en
    );
    // Day first, both of them: April and May, not March and May.
    expect(time?.source).toContain("bar [10, 20]");
  });

  it("does not take a column's name for an amount from inside a word", () => {
    const [pie] = suggestions(
      table(
        ["Item", "Betrag", "Wertpapiere"],
        [
          ["A", "10", "3"],
          ["B", "20", "4"]
        ]
      ),
      en
    );
    expect(pie?.source).toContain('"B" : 20');
  });

  it("knows a column's kind by the word its name ends in", () => {
    const rows = [
      ["Food", "Rent", "10", "3"],
      ["Rent", "Food", "20", "4"]
    ];
    const [pie] = suggestions(table(["Notes", "Categories", "Spending", "Count"], rows), en);
    expect(pie?.title).toBe("Spending by Categories");
  });

  it("takes the amount further right, and never a numbering", () => {
    const rows = [
      ["A", "2", "1001", "1"],
      ["B", "5", "1002", "2"],
      ["C", "3", "1003", "3"]
    ];
    const [pie] = suggestions(table(["Item", "Menge", "Objekt-Nr.", "Lfd"], rows), en);
    expect(pie?.title).toBe("Menge by Item");
    const [right] = suggestions(
      table(
        ["Item", "Q1", "Q2"],
        [
          ["A", "1", "7"],
          ["B", "2", "9"]
        ]
      ),
      en
    );
    expect(right?.title).toBe("Q2 by Item");
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

  it("keeps groups apart that share their first words, and a group called Other", () => {
    const long = "Nebenkosten Wohnung Berlin Mitte, Abrechnung";
    const rows = [
      [`${long} 2024`, "10"],
      [`${long} 2025`, "5"],
      ...Array.from({ length: 12 }, (_, i) => [i === 0 ? "Other" : `G${i}`, String(4 - i / 10)])
    ];
    const [bars] = suggestions(table(["Item", "Amount"], rows), en);
    const axis = /x-axis \[(.*)\]/.exec(bars?.source ?? "")?.[1] ?? "";
    expect(axis).toContain(`"${long.slice(0, 39)}…"`);
    expect(axis).toContain(`"${long.slice(0, 35)}… (2)"`);
    expect(axis).toContain('"Other"');
    expect(axis).toContain('"Other (2)"');
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

  it("keeps a long name whole enough in a title to say what it leaves out", () => {
    const name = "Betrag in Euro laut Kontoauszug der Hausverwaltung 2026";
    const [pie] = suggestions(
      table(
        ["Kategorie", name],
        [
          ["A", "10"],
          ["B", "x"],
          ["C", "4"],
          ["D", "4"],
          ["E", "4"]
        ]
      ),
      en
    );
    expect(pie?.title).toBe(`${name.slice(0, 39)}… by Kategorie (without 1)`);
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

  it("never collapses", () => {
    expect(axisRange([0, 0])).toBe("0 --> 1");
  });
});

describe("placing a chart", () => {
  it("goes above the table with a blank line on either side", () => {
    const offer = chartOffer(STATEMENT, 5, 5, de, labels);
    if (!offer.ok) throw new Error(offer.reason);
    expect(offer.replaces).toBeNull();
    const edit = placed(STATEMENT, offer, offer.suggestions[0]!);
    expect(edit.from).toBe(2);
    expect(edit.to).toBeNull();
    expect(edit.text.startsWith("```mermaid\n%% schreibstube chart\n")).toBe(true);
    expect(edit.text.endsWith("```\n\n")).toBe(true);
  });

  it("puts a blank line under text that touches the table", () => {
    const lines = ["Text", "| a | b |", "|---|---|", "| x | 2 |", "| y | 3 |"];
    const offer = chartOffer(lines, 3, 3, en, labels);
    if (!offer.ok) throw new Error(offer.reason);
    expect(placed(lines, offer, offer.suggestions[0]!).text.startsWith("\n```mermaid")).toBe(true);
  });

  it("replaces the chart it made before", () => {
    const offer = chartOffer(STATEMENT, 5, 5, de, labels);
    if (!offer.ok) throw new Error(offer.reason);
    const block = chartBlock(offer.suggestions[0]!).split("\n");
    const lines = [...STATEMENT.slice(0, 2), ...block, "", ...STATEMENT.slice(2)];
    const again = chartOffer(lines, lines.length - 4, lines.length - 4, de, labels);
    if (!again.ok) throw new Error(again.reason);
    expect(again.replaces).toEqual({ from: 2, to: 1 + block.length });
    const edit = placed(lines, again, again.suggestions[1]!);
    expect(edit).toMatchObject({ from: 2, to: 1 + block.length });
  });

  it("follows a table that moved while the dialog was open", () => {
    const offer = offered(STATEMENT, 5);
    const moved = ["New line", "", ...STATEMENT];
    expect(placed(moved, offer, offer.suggestions[0]!).from).toBe(4);
    // A chart made meanwhile is replaced, not stacked.
    const block = chartBlock(offer.suggestions[0]!).split("\n");
    const charted = [...STATEMENT.slice(0, 2), ...block, "", ...STATEMENT.slice(2)];
    expect(placed(charted, offer, offer.suggestions[1]!)).toMatchObject({
      from: 2,
      to: 1 + block.length
    });
  });

  it("puts no chart above a table that changed while the dialog was open", () => {
    const offer = offered(STATEMENT, 5);
    const edited = STATEMENT.map((line) => line.replace("-45,90 €", "-55,90 €"));
    expect(placeChart(edited, offer, offer.suggestions[0]!)).toBeNull();
    const row = "| 01.04.2026 | Wohnen | Vonovia | -980,00 € |";
    const longer = [...STATEMENT.slice(0, 10), row, ...STATEMENT.slice(10)];
    expect(placeChart(longer, offer, offer.suggestions[0]!)).toBeNull();
    expect(placeChart(["Gone"], offer, offer.suggestions[0]!)).toBeNull();
  });

  it("takes the copy of a table nearest to where it was", () => {
    const offer = offered(STATEMENT, 5);
    const twice = ["Intro", ...STATEMENT.slice(2, 10), "", "Mid", "", ...STATEMENT.slice(2, 10)];
    // The offer's table stood at line 2; the copies are at 1 and 12.
    expect(placed(twice, offer, offer.suggestions[0]!).from).toBe(1);
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

  it("pairs fences from the top, so a chart quoted in a block is not one", () => {
    const quoted = ["````md", "```mermaid", CHART_MARKER, "pie", "````", "", "| a | b |"];
    expect(chartAbove(quoted, 6)).toBeNull();
    const two = ["```js", "x", "```", "```mermaid", CHART_MARKER, "pie", "```", "| a | b |"];
    expect(chartAbove(two, 7)).toEqual({ from: 3, to: 6 });
  });

  it("says when there is no table to chart", () => {
    expect(chartOffer(["Just text"], 0, 0, en, labels)).toEqual({ ok: false, reason: "no-table" });
  });
});

describe("mayChart", () => {
  it("judges a table by its first rows", () => {
    expect(mayChart(STATEMENT, 5, 5, de, labels)).toBe(true);
    expect(mayChart(["Just text"], 0, 0, de, labels)).toBe(false);
    const names = ["| Name | City |", "|---|---|", "| Ada | London |"];
    expect(mayChart(names, 2, 2, en, labels)).toBe(false);
    // A row past the ones the menu reads changes the answer; the command says so.
    const late = [
      "| Item | Amount |",
      "|---|---|",
      ...Array.from({ length: 200 }, (_, i) => `| Item ${i % 3} | 5 € |`),
      "| Last | $5 |"
    ];
    expect(mayChart(late, 2, 2, en, labels)).toBe(true);
    expect(chartOffer(late, 2, 2, en, labels)).toEqual({ ok: false, reason: "mixed-currencies" });
  });
});

describe("uniqueLabels", () => {
  it("numbers the later of two labels alike", () => {
    expect(uniqueLabels(["Food", "Rent", "Food", "Food"])).toEqual([
      "Food",
      "Rent",
      "Food (2)",
      "Food (3)"
    ]);
    expect(uniqueLabels(['A "b"\n c'])).toEqual(["A 'b' c"]);
  });
});
