/**
 * Task counting for the task summary ribbon and the per-heading badges.
 *
 * Only two states exist: a task is open when its checkbox is `[ ]`, and done
 * for any other single-character marker (`[x]`, `[X]`, `[-]`, `[~]`, ...).
 */

export const TASK_SUMMARY_LANGUAGE = "schreibstube-tasks";
export const TASK_SUMMARY_SNIPPET = "```" + TASK_SUMMARY_LANGUAGE + "\n```";

export interface TaskCount {
  total: number;
  open: number;
}

export interface SectionTaskCount extends TaskCount {
  /** Zero-based line number of the heading that owns these tasks. */
  headingLine: number;
}

export interface TaskSummary extends TaskCount {
  /**
   * One entry per heading, in document order. A heading counts only the tasks
   * between itself and the next heading of any level; tasks under a
   * sub-heading belong to that sub-heading alone. Tasks before the first
   * heading contribute to the totals but to no section.
   */
  sections: SectionTaskCount[];
}

const TASK_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\](?:\s|$)/;
const HEADING_PATTERN = /^(#{1,6})\s+\S/;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

function fenceInfoLanguage(info: string): string {
  return info.trim().split(/\s+/)[0] ?? "";
}

/**
 * Walks the document line by line, skipping fenced code blocks, and reports
 * every heading and task line to the visitor.
 */
function scanLines(
  content: string,
  visit: (kind: "heading" | "task" | "fence", lineNumber: number, detail: string) => void
): void {
  const lines = content.split(/\r?\n/);
  let openFence: { char: string; length: number } | null = null;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const fence = line.match(FENCE_PATTERN);

    if (openFence) {
      if (
        fence &&
        fence[1][0] === openFence.char &&
        fence[1].length >= openFence.length &&
        fence[2].trim() === ""
      ) {
        openFence = null;
      }
      continue;
    }

    if (fence) {
      openFence = { char: fence[1][0], length: fence[1].length };
      visit("fence", lineNumber, fenceInfoLanguage(fence[2]));
      continue;
    }

    if (HEADING_PATTERN.test(line)) {
      visit("heading", lineNumber, line);
      continue;
    }

    const task = line.match(TASK_PATTERN);
    if (task) {
      visit("task", lineNumber, task[1]);
    }
  }
}

export function summarizeTasks(content: string): TaskSummary {
  const summary: TaskSummary = { total: 0, open: 0, sections: [] };
  let current: SectionTaskCount | null = null;

  scanLines(content, (kind, lineNumber, detail) => {
    if (kind === "heading") {
      current = { headingLine: lineNumber, total: 0, open: 0 };
      summary.sections.push(current);
      return;
    }

    if (kind !== "task") {
      return;
    }

    const isOpen = detail === " ";
    summary.total += 1;
    if (current) current.total += 1;
    if (isOpen) {
      summary.open += 1;
      if (current) current.open += 1;
    }
  });

  return summary;
}

/** True when the document contains a task summary ribbon block. */
export function hasTaskSummaryBlock(content: string): boolean {
  let found = false;
  scanLines(content, (kind, _lineNumber, detail) => {
    if (kind === "fence" && detail === TASK_SUMMARY_LANGUAGE) {
      found = true;
    }
  });
  return found;
}

/** Badge text shown after a heading, e.g. "3 of 3 open". */
export function formatSectionBadge(count: TaskCount): string {
  return `${count.open} of ${count.total} open`;
}

/** Plain-text form of the ribbon line, e.g. "20 open of 21". */
export function formatRibbonText(count: TaskCount): string {
  if (count.total === 0) {
    return "No tasks";
  }
  return `${count.open} open of ${count.total}`;
}

/**
 * Builds the text to insert at the cursor so the ribbon block always sits on
 * its own lines, whatever surrounds the cursor.
 */
export function buildTaskSummaryInsertion(textBeforeCursor: string, textAfterCursor: string): string {
  const prefix = textBeforeCursor.trim().length > 0 ? "\n" : "";
  const suffix = textAfterCursor.trim().length > 0 ? "\n" : "";
  return `${prefix}${TASK_SUMMARY_SNIPPET}\n${suffix}`;
}
