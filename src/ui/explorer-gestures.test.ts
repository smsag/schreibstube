// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom } from "../testing/obsidian-dom";
import { DragGesture, LONG_PRESS_MS, ROW_CONTROL_ATTR, wirePress } from "./explorer-gestures";

/**
 * A finger rests on a row, and before the hold has elapsed the pane redraws:
 * the row under the finger is thrown away and another drawn in its place.
 * The timer the old row started still fires, and used to open a menu for a
 * file nobody was pressing, or arm a drag nothing could release.
 */

function row(): HTMLElement {
  const el = document.body.createDiv({ cls: "schreibstube-explorer-row" });
  // happy-dom has no pointer capture; the gesture asks for it on every press.
  el.setPointerCapture = () => undefined;
  return el;
}

function touchStart(el: HTMLElement): void {
  const event = new Event("touchstart", { bubbles: true });
  Object.defineProperty(event, "touches", { value: [{ clientX: 12, clientY: 34 }] });
  el.dispatchEvent(event);
}

beforeAll(() => installObsidianDom());

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("a finger held on a row", () => {
  it("opens the menu where the finger rests once the hold has elapsed", () => {
    const el = row();
    const showMenu = vi.fn();
    wirePress(el, { isDragging: () => false, activate: vi.fn(), showMenu });

    touchStart(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(showMenu).toHaveBeenCalledWith({ x: 12, y: 34 });
  });

  it("opens nothing for a row a redraw threw away in the meantime", () => {
    const el = row();
    const showMenu = vi.fn();
    wirePress(el, { isDragging: () => false, activate: vi.fn(), showMenu });

    touchStart(el);
    el.remove();
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(showMenu).not.toHaveBeenCalled();
  });
});

describe("a finger held on a row before a drag", () => {
  const press = (el: HTMLElement): void => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", { pointerType: "touch", button: 0, pointerId: 1 })
    );
  };
  const handlers = () => ({
    path: "a.md",
    onStart: vi.fn(),
    onMove: vi.fn(),
    onDrop: vi.fn(),
    onEnd: vi.fn()
  });

  it("arms the drag once the hold has elapsed", () => {
    const el = row();
    new DragGesture(() => null, vi.fn()).wire(el, handlers());

    press(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(el.classList.contains("is-dragging")).toBe(true);
  });

  it("arms nothing for a row a redraw threw away in the meantime", () => {
    const el = row();
    new DragGesture(() => null, vi.fn()).wire(el, handlers());

    press(el);
    el.remove();
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(el.classList.contains("is-dragging")).toBe(false);
  });
});

describe("a press on a control inside a row", () => {
  it("takes no pointer capture, so the click reaches the control and not the row", () => {
    const el = row();
    const capture = vi.fn();
    el.setPointerCapture = capture;
    const mark = el.createSpan();
    mark.setAttribute(ROW_CONTROL_ATTR, "");
    new DragGesture(() => null, vi.fn()).wire(el, {
      path: "a.md",
      onStart: vi.fn(),
      onMove: vi.fn(),
      onDrop: vi.fn(),
      onEnd: vi.fn()
    });

    mark.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerType: "mouse",
        button: 0,
        pointerId: 1
      })
    );
    expect(capture).not.toHaveBeenCalled();

    // The row itself still takes it: a drag starts from anywhere else on it.
    el.dispatchEvent(
      new PointerEvent("pointerdown", { pointerType: "mouse", button: 0, pointerId: 1 })
    );
    expect(capture).toHaveBeenCalledOnce();
  });
});
