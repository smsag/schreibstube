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

function touch(el: HTMLElement, type: string, at: Point): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = type === "touchend" ? [] : [at];
  Object.defineProperty(event, "touches", { value: list });
  Object.defineProperty(event, "changedTouches", { value: [at] });
  el.dispatchEvent(event);
  return event;
}

function swipe(el: HTMLElement, from: Point, to: Point): Event[] {
  return [touch(el, "touchstart", from), touch(el, "touchmove", to), touch(el, "touchend", to)];
}

beforeAll(() => installObsidianDom());

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a swipe on the slideshow's stage", () => {
  it("turns the page against the direction of the finger", () => {
    const stage = document.body.createDiv();
    const onSwipe = vi.fn();
    wireSwipe(stage, onSwipe);

    swipe(stage, { clientX: 200, clientY: 100 }, { clientX: 100, clientY: 105 });

    expect(onSwipe).toHaveBeenCalledWith(1);
  });

  it("keeps its sideways moves from the note but lets the lift through", () => {
    const stage = document.body.createDiv();
    wireSwipe(stage, vi.fn());
    const heard: string[] = [];
    for (const type of ["touchstart", "touchmove", "touchend"]) {
      document.body.addEventListener(type, () => heard.push(type));
    }

    const [, move] = swipe(stage, { clientX: 200, clientY: 100 }, { clientX: 100, clientY: 105 });

    expect(move?.defaultPrevented).toBe(true);
    expect(heard).toEqual(["touchstart", "touchend"]);
  });

  it("leaves a scroll of the note entirely alone", () => {
    const stage = document.body.createDiv();
    const onSwipe = vi.fn();
    wireSwipe(stage, onSwipe);
    const heard: string[] = [];
    for (const type of ["touchstart", "touchmove", "touchend"]) {
      document.body.addEventListener(type, () => heard.push(type));
    }

    const [, move] = swipe(stage, { clientX: 100, clientY: 300 }, { clientX: 105, clientY: 100 });

    expect(move?.defaultPrevented).toBe(false);
    expect(heard).toEqual(["touchstart", "touchmove", "touchend"]);
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
