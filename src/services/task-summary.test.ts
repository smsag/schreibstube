import { describe, expect, it } from "vitest";
import {
  TASK_SUMMARY_SNIPPET,
  buildTaskSummaryInsertion,
  formatRibbonText,
  formatSectionBadge,
  hasTaskSummaryBlock,
  summarizeTasks
} from "./task-summary";

describe("summarizeTasks", () => {
  it("counts open and total tasks across the document", () => {
    const content = [
      "- [ ] one",
      "- [x] two",
      "* [X] three",
      "+ [ ] four",
      "1. [ ] five",
      "2) [x] six",
      "  - [ ] nested"
    ].join("\n");

    const summary = summarizeTasks(content);
    expect(summary.total).toBe(7);
    expect(summary.open).toBe(4);
    expect(summary.sections).toEqual([]);
  });

  it("treats any non-space marker as done", () => {
    const content = ["- [ ] open", "- [~] fixed", "- [-] dropped", "- [x] done"].join("\n");
    expect(summarizeTasks(content)).toMatchObject({ total: 4, open: 1 });
  });

  it("ignores lines that only look like tasks", () => {
    const content = [
      "-[ ] no space after bullet",
      "- [] empty brackets",
      "- [ ]tight",
      "[ ] not a list item",
      "- [ab] two chars",
      "- [ ] real"
    ].join("\n");
    expect(summarizeTasks(content)).toMatchObject({ total: 1, open: 1 });
  });

  it("assigns tasks to the nearest preceding heading only", () => {
    const content = [
      "- [ ] before any heading",
      "# Top",
      "- [ ] a",
      "- [x] b",
      "## Child",
      "- [ ] c",
      "### Leaf",
      "- [x] d",
      "- [x] e",
      "## Sibling",
      "no tasks here",
      "# Second top",
      "- [ ] f"
    ].join("\n");

    const summary = summarizeTasks(content);
    expect(summary).toMatchObject({ total: 7, open: 4 });
    expect(summary.sections).toEqual([
      { headingLine: 1, total: 2, open: 1 },
      { headingLine: 4, total: 1, open: 1 },
      { headingLine: 6, total: 2, open: 0 },
      { headingLine: 9, total: 0, open: 0 },
      { headingLine: 11, total: 1, open: 1 }
    ]);
  });

  it("skips tasks and headings inside fenced code blocks", () => {
    const content = [
      "# Real",
      "```md",
      "- [ ] inside fence",
      "# not a heading",
      "```",
      "- [ ] after fence",
      "~~~",
      "- [x] tilde fence",
      "~~~",
      "````",
      "```",
      "- [ ] still inside the four-backtick fence",
      "````",
      "- [x] last"
    ].join("\n");

    const summary = summarizeTasks(content);
    expect(summary).toMatchObject({ total: 2, open: 1 });
    expect(summary.sections).toEqual([{ headingLine: 0, total: 2, open: 1 }]);
  });

  it("handles CRLF line endings", () => {
    const summary = summarizeTasks("# H\r\n- [ ] a\r\n- [x] b\r\n");
    expect(summary.sections).toEqual([{ headingLine: 0, total: 2, open: 1 }]);
  });
});

describe("hasTaskSummaryBlock", () => {
  it("detects the ribbon fence anywhere in the document", () => {
    expect(hasTaskSummaryBlock("intro\n\n```schreibstube-tasks\n```\n\n# H")).toBe(true);
    expect(hasTaskSummaryBlock("~~~schreibstube-tasks\n~~~")).toBe(true);
    expect(hasTaskSummaryBlock("```schreibstube-tasks extra\n```")).toBe(true);
  });

  it("ignores other fences and mentions of the language", () => {
    expect(hasTaskSummaryBlock("```js\nschreibstube-tasks\n```")).toBe(false);
    expect(hasTaskSummaryBlock("use `schreibstube-tasks` for the ribbon")).toBe(false);
    expect(hasTaskSummaryBlock("```schreibstube-tasks-other\n```")).toBe(false);
    expect(hasTaskSummaryBlock("")).toBe(false);
  });

  it("does not see a ribbon fence nested inside another fence", () => {
    expect(hasTaskSummaryBlock("````md\n```schreibstube-tasks\n```\n````")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats the heading badge", () => {
    expect(formatSectionBadge({ open: 3, total: 3 })).toBe("3 of 3 open");
    expect(formatSectionBadge({ open: 0, total: 2 })).toBe("0 of 2 open");
  });

  it("formats the ribbon line", () => {
    expect(formatRibbonText({ open: 20, total: 21 })).toBe("20 open of 21");
    expect(formatRibbonText({ open: 0, total: 0 })).toBe("No tasks");
  });
});

describe("buildTaskSummaryInsertion", () => {
  it("inserts the block on its own lines when the cursor line is empty", () => {
    expect(buildTaskSummaryInsertion("", "")).toBe(`${TASK_SUMMARY_SNIPPET}\n`);
    expect(buildTaskSummaryInsertion("   ", "")).toBe(`${TASK_SUMMARY_SNIPPET}\n`);
  });

  it("breaks the line before and after when text surrounds the cursor", () => {
    expect(buildTaskSummaryInsertion("before", "")).toBe(`\n${TASK_SUMMARY_SNIPPET}\n`);
    expect(buildTaskSummaryInsertion("", "after")).toBe(`${TASK_SUMMARY_SNIPPET}\n\n`);
    expect(buildTaskSummaryInsertion("before", "after")).toBe(`\n${TASK_SUMMARY_SNIPPET}\n\n`);
  });
});
