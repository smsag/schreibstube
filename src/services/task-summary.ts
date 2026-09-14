/**
 * Task counting for the task summary ribbon and the per-heading badges.
 *
 * Two states only. A task is open when its box is `[ ]` and done for any other
 * single-character marker: `[x]`, `[X]`, `[-]`, `[~]` and whatever else a
 * theme or another plugin gives a meaning to. Distinguishing those would be
 * a task model, and the ribbon is a count.
 */
import { fenceMarker } from "./markdown-fence";

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
   * between itself and the next heading of any level, so a sub-heading's
   * tasks are the sub-heading's. Tasks before the first heading are in the
   * totals and in no section.
   */
  sections: SectionTaskCount[];
}

const TASK_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\](?:\s|$)/;
const HEADING_PATTERN = /^#{1,6}\s+\S/;

type LineKind = "heading" | "task" | "fence";

/**
 * Walks the note line by line and reports every heading, task and fence
 * opening, skipping whatever a fence encloses: a `- [ ]` in a code sample is
 * a code sample.
 */
function scanLines(
  content: string,
  visit: (kind: LineKind, lineNumber: number, detail: string) => void
): void {
  const lines = content.split(/\r?\n/);
  let fence: string | null = null;

  for (const [lineNumber, line] of lines.entries()) {
    const marker = fenceMarker(line);

    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }

    if (marker) {
      fence = marker;
      const info = line.trimStart().slice(marker.length).trim();
      visit("fence", lineNumber, info.split(/\s+/)[0] ?? "");
      continue;
    }

    if (HEADING_PATTERN.test(line)) {
      visit("heading", lineNumber, line);
      continue;
    }

    const task = TASK_PATTERN.exec(line);
    if (task) visit("task", lineNumber, task[1] ?? "");
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

    if (kind !== "task") return;

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

/** Whether the note carries a ribbon block, which is what switches the badges on. */
export function hasTaskSummaryBlock(content: string): boolean {
  let found = false;
  scanLines(content, (kind, _lineNumber, detail) => {
    if (kind === "fence" && detail === TASK_SUMMARY_LANGUAGE) found = true;
  });
  return found;
}

/**
 * The text to insert at the cursor so the block lands on lines of its own,
 * whatever is on either side of the cursor.
 */
export function buildTaskSummaryInsertion(
  textBeforeCursor: string,
  textAfterCursor: string
): string {
  const prefix = textBeforeCursor.trim().length > 0 ? "\n" : "";
  const suffix = textAfterCursor.trim().length > 0 ? "\n" : "";
  return `${prefix}${TASK_SUMMARY_SNIPPET}\n${suffix}`;
}
