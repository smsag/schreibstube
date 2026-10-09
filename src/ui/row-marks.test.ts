import { describe, expect, it } from "vitest";
import { DUE_SLOT_CLASS } from "./due-date-label";
import { drawRowMarks, MARKS_CLASS } from "./row-marks";
import { TASK_PILL_CLASS } from "./task-count-label";

/**
 * A row with one mark keeps the pill it always had; a row with both draws one
 * pill. No DOM is loaded; the fake is what the renderers do to an element.
 */
interface Drawn {
  cls: string;
  text?: string | undefined;
  children: Drawn[];
  attrs: Record<string, string>;
  data: Record<string, string>;
}

function element(node: Drawn): HTMLElement {
  return {
    createSpan: ({ cls, text }: { cls: string; text?: string }) => {
      const child: Drawn = { cls, text, children: [], attrs: {}, data: {} };
      node.children.push(child);
      return element(child);
    },
    dataset: new Proxy<Record<string, string>>(
      {},
      {
        set: (target, key, value) => {
          node.data[String(key)] = String(value);
          return Reflect.set(target, key, value);
        }
      }
    ),
    setAttribute: (key: string, value: string) => {
      node.attrs[key] = value;
    }
  } as unknown as HTMLElement;
}

function fakeRow(): { row: HTMLElement; drawn: Drawn[] } {
  const root: Drawn = { cls: "", children: [], attrs: {}, data: {} };
  return { row: element(root), drawn: root.children };
}

const SOME_OPEN = { open: 9, total: 12 };
const DUE = { text: "Oct 12", state: "overdue" as const, long: "October 12, 2026" };

describe("drawRowMarks", () => {
  it("draws the task pill alone as it always was", () => {
    const { row, drawn } = fakeRow();
    drawRowMarks(row, SOME_OPEN, null);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.cls.split(" ")).toEqual(["schreibstube-explorer-tasks", TASK_PILL_CLASS]);
  });

  it("draws the due pill alone as it always was", () => {
    const { row, drawn } = fakeRow();
    drawRowMarks(row, null, DUE);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.cls.split(" ")).toEqual([DUE_SLOT_CLASS, TASK_PILL_CLASS]);
    expect(drawn[0]?.text).toBe("Oct 12");
  });

  it("draws nothing for a note with neither, nor for one whose tasks are nought", () => {
    const { row, drawn } = fakeRow();
    drawRowMarks(row, null, null);
    drawRowMarks(row, { open: 0, total: 0 }, null);
    expect(drawn).toEqual([]);
  });

  it("draws one pill for a note with both, count then day, in the row's smaller size", () => {
    const { row, drawn } = fakeRow();
    drawRowMarks(row, SOME_OPEN, DUE);

    expect(drawn).toHaveLength(1);
    const pill = drawn[0];
    expect(pill?.cls.split(" ")).toEqual([MARKS_CLASS, DUE_SLOT_CLASS, TASK_PILL_CLASS]);
    expect(pill?.children.map((c) => `${c.cls}:${c.text}`)).toEqual([
      `${TASK_PILL_CLASS}-done:3`,
      `${TASK_PILL_CLASS}-total:/12`,
      `${MARKS_CLASS}-sep:·`,
      `${MARKS_CLASS}-due:Oct 12`
    ]);
  });

  it("colours the one pill by the day's state and dims the figures of a finished note", () => {
    const { row, drawn } = fakeRow();
    drawRowMarks(row, { open: 0, total: 4 }, DUE);
    expect(drawn[0]?.data).toEqual({ state: "overdue", tasks: "done" });

    const other = fakeRow();
    drawRowMarks(other.row, SOME_OPEN, { ...DUE, state: "today" });
    expect(other.drawn[0]?.data).toEqual({ state: "today" });
  });

  it("says both in words for a screen reader", () => {
    const { row, drawn } = fakeRow();
    drawRowMarks(row, SOME_OPEN, DUE);
    expect(drawn[0]?.attrs["aria-label"]).toBe(
      "3 of 12 tasks done, Overdue, was due October 12, 2026"
    );
  });

  it("falls back to the lone due pill when the tasks are nought", () => {
    const { row, drawn } = fakeRow();
    drawRowMarks(row, { open: 0, total: 0 }, DUE);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.cls.split(" ")).toEqual([DUE_SLOT_CLASS, TASK_PILL_CLASS]);
  });
});
