import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { de } from "../i18n/de";
import { buildHeadingIndex } from "./heading-index";
import {
  DEFAULT_INDEX_DEPTH,
  MAX_INDEX_DEPTH,
  MAX_INDEX_ENTRIES,
  parseNoteIndexOptions,
  planNoteIndex
} from "./note-index";

/**
 * The index block is read here, in the vault, and again by the bridge for the
 * published site. The examples are shared, so an index the note shows and the
 * page lays out differently fails on whichever side moved.
 */
interface Run {
  level: number;
  count: number;
  then?: Run;
}

interface PlanCase {
  name: string;
  levels?: number[];
  repeat?: Run;
  depth: number;
  expect:
    | { kind: "entries"; indents?: number[]; count?: number }
    | { kind: "empty" }
    | { kind: "too-long"; count: number; fits: number | null };
}

const table = JSON.parse(readFileSync("contracts/index-cases.json", "utf8")) as {
  options: { name: string; source: string; expect: unknown }[];
  plans: PlanCase[];
  headings: { name: string; source: string; levels: number[]; texts?: string[] }[];
  limits: { defaultDepth: number; maxDepth: number; maxEntries: number };
  labels: { summary: string; summaryOne: string };
};

function levelsOf(test: PlanCase): number[] {
  const levels = [...(test.levels ?? [])];
  for (let run = test.repeat; run; run = run.then) {
    for (let i = 0; i < run.count; i += 1) levels.push(run.level);
  }
  return levels;
}

describe("the shared index contract, in the plugin", () => {
  for (const { name, source, expect: wanted } of table.options) {
    it(`reads the block: ${name}`, () => {
      expect(parseNoteIndexOptions(source)).toEqual(wanted);
    });
  }

  for (const test of table.plans) {
    it(`plans the list: ${test.name}`, () => {
      const headings = levelsOf(test).map((level, lineNumber) => ({
        level,
        text: `H${lineNumber}`,
        lineNumber
      }));
      const plan = planNoteIndex(headings, test.depth);
      const wanted = test.expect;
      expect(plan.kind).toBe(wanted.kind);
      if (plan.kind === "entries" && wanted.kind === "entries") {
        if (wanted.indents) expect(plan.entries.map((e) => e.indent)).toEqual(wanted.indents);
        if (wanted.count !== undefined) expect(plan.entries).toHaveLength(wanted.count);
      }
      if (plan.kind === "too-long" && wanted.kind === "too-long") {
        expect(plan.count).toBe(wanted.count);
        expect(plan.fits).toBe(wanted.fits);
      }
    });
  }

  for (const { name, source, levels, texts } of table.headings) {
    it(`finds the headings: ${name}`, () => {
      const headings = buildHeadingIndex(source);
      expect(headings.map((heading) => heading.level)).toEqual(levels);
      if (texts) expect(headings.map((heading) => heading.text)).toEqual(texts);
    });
  }

  it("applies the same limits", () => {
    expect(DEFAULT_INDEX_DEPTH).toBe(table.limits.defaultDepth);
    expect(MAX_INDEX_DEPTH).toBe(table.limits.maxDepth);
    expect(MAX_INDEX_ENTRIES).toBe(table.limits.maxEntries);
  });

  it("speaks the site's German: the plugin's strings are the shared ones", () => {
    expect(de.noteIndex.summary(12)).toBe(table.labels.summary.replace("{n}", "12"));
    expect(de.noteIndex.summary(1)).toBe(table.labels.summaryOne);
  });
});
