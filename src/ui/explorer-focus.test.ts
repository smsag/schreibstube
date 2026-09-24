// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { wireListFocus } from "./explorer-gestures";

/**
 * The list hands the focus Tab brings to a row, and scrolling to that row is
 * what focusing it does. A press on a row that cannot hold the focus itself
 * brought the same focus, and the scroll carried the pressed row away before
 * the button came up, so the note never opened.
 */

let unwire: () => void = () => {};

function pane() {
  document.body.innerHTML = `
    <div class="list" tabindex="0">
      <div class="recent">karussell-product-vision</div>
      <div class="row" tabindex="-1">Erste</div>
      <div class="row is-active" tabindex="-1">Letzte Änderungen</div>
    </div>`;
  const list = document.querySelector<HTMLElement>(".list")!;
  const active = document.querySelector<HTMLElement>(".row.is-active")!;
  unwire = wireListFocus(list, () => active);
  return { list, active, recent: document.querySelector<HTMLElement>(".recent")! };
}

afterEach(() => {
  unwire();
  document.body.innerHTML = "";
});

describe("wireListFocus", () => {
  it("hands focus that arrives by Tab to the open note's row", () => {
    const { list, active } = pane();
    list.focus();
    expect(document.activeElement).toBe(active);
  });

  it("leaves focus that a press brought on the list, so nothing scrolls under the press", () => {
    const { list, recent } = pane();
    recent.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    list.focus();
    expect(document.activeElement).toBe(list);
  });

  it("hands focus on again once the press has ended", () => {
    const { list, active, recent } = pane();
    recent.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    list.blur();
    list.focus();
    expect(document.activeElement).toBe(active);
  });

  it("counts a press the browser called off as ended", () => {
    const { list, active, recent } = pane();
    recent.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointercancel"));
    list.focus();
    expect(document.activeElement).toBe(active);
  });

  it("leaves a row that took the focus itself alone", () => {
    const { active } = pane();
    const first = document.querySelector<HTMLElement>(".row")!;
    first.focus();
    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(active);
  });

  it("stops listening when unwired", () => {
    const { list } = pane();
    unwire();
    list.focus();
    expect(document.activeElement).toBe(list);
  });
});
