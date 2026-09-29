/**
 * A thing that is pressed: a click, and Enter or Space while it has the focus.
 *
 * Every row, control and tile in the plugin that is not a `<button>` — drawn
 * as a div or a span so that no theme's idea of a button arrives on it — has
 * to answer the keyboard the way a button does, and each used to wire the
 * same three lines. Enter and Space are always prevented, or Space would
 * scroll the pane and Enter would reach whatever sits underneath. The click
 * is prevented, and both are stopped, only where the caller asks: a control
 * standing on a pressable header must not press the header as well, while a
 * row that opens a note has nothing underneath to keep the press from.
 */
export interface PressableOptions {
  /** Prevent the default and stop the press at this element, click and key alike. */
  stop?: boolean;
}

export type PressHandler = (event: MouseEvent | KeyboardEvent) => void;

export function pressable(
  el: HTMLElement,
  run: PressHandler,
  options: PressableOptions = {}
): void {
  el.addEventListener("click", (event) => {
    if (options.stop) {
      event.preventDefault();
      event.stopPropagation();
    }
    run(event);
  });
  pressKeys(el, run, options);
}

/** The keyboard half alone, for an element whose click another gesture answers. */
export function pressKeys(
  el: HTMLElement,
  run: PressHandler,
  options: PressableOptions = {}
): void {
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (options.stop) event.stopPropagation();
    run(event);
  });
}
