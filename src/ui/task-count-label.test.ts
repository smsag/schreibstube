import { describe, expect, it } from "vitest";
import { drawTaskCount, TASK_PILL_CLASS } from "./task-count-label";

/**
 * The tally's two surfaces read one tally and must draw one pill.
 *
 * The look lives in a single stylesheet rule, `.schreibstube-tasks`, and every
 * element this renderer makes has to wear it — a surface's own class carries
 * nothing but size and alignment. Dropping the shared class here would leave
 * the figures unstyled while every stylesheet guard still passed, so the seam
 * is tested from this end too.
 *
 * No DOM is loaded for it: the fake below is the three things this renderer
 * does to an element — make a span in it, set its state, label it — which is
 * enough to read back what it drew.
 */
interface Drawn {
  cls: string;
  text?: string | undefined;
  children: Drawn[];
  attrs: Record<string, string>;
  state?: string;
}

function element(node: Drawn): HTMLElement {
  return {
    createSpan: ({ cls, text }: { cls: string; text?: string }) => {
      const child: Drawn = { cls, text, children: [], attrs: {} };
      node.children.push(child);
      return element(child);
    },
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
  } as unknown as HTMLElement;
}

/** A host whose children are readable: `pill(drawn)` is the pill it drew. */
function fakeHost(): { host: HTMLElement; drawn: Drawn[] } {
  const root: Drawn = { cls: "", children: [], attrs: {} };
  return { host: element(root), drawn: root.children };
}

/** The one element the renderer should have made, or a failure naming that. */
function pill(drawn: Drawn[]): Drawn {
  expect(drawn).toHaveLength(1);
  const only = drawn[0];
  if (!only) return expect.fail("nothing was drawn");
  return only;
}

const SOME_OPEN = { open: 9, total: 12 };

describe("drawTaskCount", () => {
  it("wears the shared pill class alongside the surface's own", () => {
    const { host, drawn } = fakeHost();
    drawTaskCount(host, SOME_OPEN, "schreibstube-explorer-tasks");

    expect(pill(drawn).cls.split(" ")).toEqual(["schreibstube-explorer-tasks", TASK_PILL_CLASS]);
  });

  it("draws the same pill on both surfaces, differing only in that one class", () => {
    const pane = fakeHost();
    const cards = fakeHost();
    drawTaskCount(pane.host, SOME_OPEN, "schreibstube-explorer-tasks");
    drawTaskCount(cards.host, SOME_OPEN, "schreibstube-tag-card-tasks");

    const figures = (d: Drawn) => d.children.map((c) => `${c.cls}:${c.text}`);
    expect(figures(pill(pane.drawn))).toEqual(figures(pill(cards.drawn)));
    expect(pill(pane.drawn).attrs).toEqual(pill(cards.drawn).attrs);
    expect(pill(cards.drawn).cls.split(" ")).toEqual([
      "schreibstube-tag-card-tasks",
      TASK_PILL_CLASS
    ]);
  });

  it("names the two figures with the classes the one rule set styles, done first", () => {
    const { host, drawn } = fakeHost();
    drawTaskCount(host, SOME_OPEN, "schreibstube-explorer-tasks");

    expect(pill(drawn).children.map((c) => c.cls)).toEqual([
      `${TASK_PILL_CLASS}-done`,
      `${TASK_PILL_CLASS}-total`
    ]);
    expect(pill(drawn).children.map((c) => c.text)).toEqual(["3", "/12"]);
  });

  it("marks a finished note on the element that shows it", () => {
    const { host, drawn } = fakeHost();
    drawTaskCount(host, { open: 0, total: 12 }, "schreibstube-explorer-tasks");

    expect(pill(drawn).state).toBe("done");
  });

  it("leaves a note with work left unmarked, so only the fill says so", () => {
    const { host, drawn } = fakeHost();
    drawTaskCount(host, SOME_OPEN, "schreibstube-explorer-tasks");

    expect(pill(drawn).state).toBeUndefined();
  });

  it("says the tally in words for a screen reader, which two figures cannot", () => {
    const { host, drawn } = fakeHost();
    drawTaskCount(host, SOME_OPEN, "schreibstube-explorer-tasks");

    expect(pill(drawn).attrs["aria-label"]).toBe("3 of 12 tasks done");
  });

  it("draws nothing for a note with no tasks in it", () => {
    const { host, drawn } = fakeHost();
    drawTaskCount(host, { open: 0, total: 0 }, "schreibstube-explorer-tasks");

    expect(drawn).toEqual([]);
  });
});
