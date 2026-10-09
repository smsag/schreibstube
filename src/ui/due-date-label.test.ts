import { describe, expect, it } from "vitest";
import { DUE_SLOT_CLASS, drawDueDate } from "./due-date-label";
import { TASK_PILL_CLASS } from "./task-count-label";

/**
 * The due day's slot at a row's right edge: the task pill's look, a state the
 * stylesheet reads, and words for a screen reader. No DOM is loaded; the fake
 * is the three things the renderer does to an element.
 */
interface Drawn {
  cls: string;
  text?: string | undefined;
  attrs: Record<string, string>;
  state?: string;
}

function fakeHost(): { host: HTMLElement; drawn: Drawn[] } {
  const drawn: Drawn[] = [];
  const host = {
    createSpan: ({ cls, text }: { cls: string; text?: string }) => {
      const node: Drawn = { cls, text, attrs: {} };
      drawn.push(node);
      return {
        dataset: new Proxy<Record<string, string>>(
          {},
          {
            set: (target, key, value) => {
              if (key === "state") node.state = String(value);
              return Reflect.set(target, key, value);
            }
          }
        ),
        setAttribute: (key: string, value: string) => {
          node.attrs[key] = value;
        }
      };
    }
  } as unknown as HTMLElement;
  return { host, drawn };
}

function only(drawn: Drawn[]): Drawn {
  expect(drawn).toHaveLength(1);
  return drawn[0] ?? expect.fail("nothing was drawn");
}

describe("drawDueDate", () => {
  it("wears the task pill's class, so the look is one rule set", () => {
    const { host, drawn } = fakeHost();
    drawDueDate(host, { text: "Oct 12", state: "upcoming", long: "October 12, 2026" });

    expect(only(drawn).cls.split(" ")).toEqual([DUE_SLOT_CLASS, TASK_PILL_CLASS]);
  });

  it("writes the short day and puts its state where the stylesheet reads it", () => {
    for (const state of ["upcoming", "today", "overdue"] as const) {
      const { host, drawn } = fakeHost();
      drawDueDate(host, { text: "Oct 12", state, long: "October 12, 2026" });
      expect(only(drawn).text).toBe("Oct 12");
      expect(only(drawn).state).toBe(state);
    }
  });

  it("says the state in words, which a colour or an outline cannot", () => {
    const { host, drawn } = fakeHost();
    drawDueDate(host, { text: "Oct 12", state: "overdue", long: "October 12, 2026" });

    expect(only(drawn).attrs["aria-label"]).toBe("Overdue, was due October 12, 2026");
  });

  it("keeps the slot on a note without a day, empty and silent, so the columns line up", () => {
    const { host, drawn } = fakeHost();
    drawDueDate(host, null);

    expect(only(drawn).state).toBe("none");
    expect(only(drawn).text).toBeUndefined();
    expect(only(drawn).attrs).toEqual({ "aria-hidden": "true" });
  });
});
