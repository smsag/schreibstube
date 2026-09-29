// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { pressable, pressKeys } from "./pressable";

function control(options?: { stop?: boolean }) {
  const parent = document.createElement("div");
  const el = document.createElement("span");
  parent.appendChild(el);
  document.body.appendChild(parent);
  const run = vi.fn();
  const reached = vi.fn();
  parent.addEventListener("click", reached);
  parent.addEventListener("keydown", reached);
  pressable(el, run, options);
  return { el, run, reached };
}

function key(el: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pressable", () => {
  it("runs on a click and hands the event over", () => {
    const { el, run } = control();
    el.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
  });

  it("runs on Enter and on Space, and keeps the key from scrolling", () => {
    const { el, run } = control();
    expect(key(el, "Enter").defaultPrevented).toBe(true);
    expect(key(el, " ").defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("leaves every other key to whoever is listening above", () => {
    const { el, run, reached } = control();
    expect(key(el, "Tab").defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it("lets a plain press reach the element around it", () => {
    const { el, reached } = control();
    el.click();
    key(el, "Enter");
    expect(reached).toHaveBeenCalledTimes(2);
  });

  it("stops the press at the element when asked, click and key alike", () => {
    const { el, run, reached } = control({ stop: true });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(click);
    key(el, " ");
    expect(click.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(reached).not.toHaveBeenCalled();
  });
});

describe("pressKeys", () => {
  it("answers the keyboard only, for an element whose click another gesture owns", () => {
    const el = document.body.appendChild(document.createElement("div"));
    const run = vi.fn();
    pressKeys(el, run);
    el.click();
    expect(run).not.toHaveBeenCalled();
    key(el, "Enter");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
