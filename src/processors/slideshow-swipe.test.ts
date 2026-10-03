// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../testing/obsidian-dom";
import { wireSwipe } from "./slideshow";

/**
 * On a phone, a page turned by a sideways swipe left the note unable to
 * scroll down: the block kept the lift that ended the swipe to itself, so
 * Obsidian, which had heard the finger land, never heard it go and went on
 * treating the next finger as part of the same gesture.
 */

type Point = { clientX: number; clientY: number };

/** `down` is every finger still on the glass once this event has happened. */
function touch(el: HTMLElement, type: string, at: Point, down: Point[] = [at]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: down });
  Object.defineProperty(event, "changedTouches", { value: [at] });
  el.dispatchEvent(event);
  return event;
}

function swipe(el: HTMLElement, from: Point, to: Point): Event[] {
  return [touch(el, "touchstart", from), touch(el, "touchmove", to), touch(el, "touchend", to, [])];
}

/** A stage inside a note that records which of the stage's touches reach it. */
function stageInNote(onSwipe = vi.fn()): { stage: HTMLElement; heard: string[] } {
  const note = document.body.createDiv();
  const stage = note.createDiv();
  wireSwipe(stage, onSwipe);
  const heard: string[] = [];
  for (const type of ["touchstart", "touchmove", "touchend"]) {
    note.addEventListener(type, () => heard.push(type));
  }
  return { stage, heard };
}

beforeAll(() => installObsidianDom());

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a swipe on the slideshow's stage", () => {
  it("turns the page against the direction of the finger", () => {
    const onSwipe = vi.fn();
    const { stage } = stageInNote(onSwipe);

    swipe(stage, { clientX: 200, clientY: 100 }, { clientX: 100, clientY: 105 });

    expect(onSwipe).toHaveBeenCalledWith(1);
  });

  it("keeps its sideways moves from the note but lets the lift through", () => {
    const { stage, heard } = stageInNote();

    const [, move] = swipe(stage, { clientX: 200, clientY: 100 }, { clientX: 100, clientY: 105 });

    expect(move?.defaultPrevented).toBe(true);
    expect(heard).toEqual(["touchstart", "touchend"]);
  });

  it("leaves a scroll of the note entirely alone", () => {
    const onSwipe = vi.fn();
    const { stage, heard } = stageInNote(onSwipe);

    const [, move] = swipe(stage, { clientX: 100, clientY: 300 }, { clientX: 105, clientY: 100 });

    expect(move?.defaultPrevented).toBe(false);
    expect(heard).toEqual(["touchstart", "touchmove", "touchend"]);
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("keeps a sideways drag claimed when it curves up or down afterwards", () => {
    const { stage, heard } = stageInNote();

    touch(stage, "touchstart", { clientX: 200, clientY: 100 });
    touch(stage, "touchmove", { clientX: 170, clientY: 102 });
    const curved = touch(stage, "touchmove", { clientX: 160, clientY: 220 });

    expect(curved.defaultPrevented).toBe(true);
    expect(heard).toEqual(["touchstart"]);
  });

  it("turns no page for a pinch, and does not restart a swipe for its second finger", () => {
    const onSwipe = vi.fn();
    const { stage } = stageInNote(onSwipe);
    const first = { clientX: 200, clientY: 100 };
    const second = { clientX: 300, clientY: 100 };

    touch(stage, "touchstart", first);
    touch(stage, "touchstart", second, [first, second]);
    const move = touch(stage, "touchmove", { clientX: 140, clientY: 100 }, [
      { clientX: 140, clientY: 100 },
      second
    ]);
    touch(stage, "touchend", { clientX: 140, clientY: 100 }, [second]);
    touch(stage, "touchend", second, []);

    expect(move.defaultPrevented).toBe(false);
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
