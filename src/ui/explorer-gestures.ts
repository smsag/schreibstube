/**
 * The two gestures a row of the file pane answers to.
 *
 * A press-hold-move that carries the row somewhere, and a press held still
 * that opens its menu. On a phone they begin as the same press, and which one
 * it becomes is decided by whether the finger moves. Both are wired here, with
 * no idea of what a row is or where it may land: a row hands over what to do
 * at each step, and the pane owns everything else.
 */
import { isLongPressEcho } from "../services/explorer-menu";

/** How long a finger rests on a row before the press means "hold". */
export const LONG_PRESS_MS = 500;

/**
 * How far a finger may wander during a long press before it is a scroll.
 * A finger never holds perfectly still.
 */
const LONG_PRESS_MOVE_PX = 10;

/** How far a mouse moves before a press is a drag. */
const DRAG_THRESHOLD_PX = 4;

/**
 * The same for a finger, which rests further and rolls further as it lifts.
 * More than half a row: a hand on its way somewhere rather than a hand
 * staying put.
 */
const DRAG_TOUCH_THRESHOLD_PX = 16;

/**
 * How long a redraw waits on a drag at most.
 *
 * Longer than any gesture, shorter than anything worth calling a freeze: a
 * flag that somehow outlives its gesture cannot hold every redraw back with it.
 */
const DRAG_DEFER_MAX_MS = 5_000;

/** How near an edge of the list a drag has to rest to scroll it, and how fast. */
const EDGE_SCROLL_PX = 48;
const EDGE_SCROLL_MAX_PX = 12;

/** What a row hands the shared drag gesture. */
export interface DragHandlers {
  /** Identifies the drag in progress, so one row's release cannot end another's. */
  path: string;
  /** Called once, when a press has become a drag. */
  onStart: () => void;
  onMove: (clientX: number, clientY: number) => void;
  onDrop: (clientX: number, clientY: number) => void;
  onEnd: () => void;
}

/**
 * One drag at a time, for the whole pane.
 *
 * Holds the one piece of state every row shares — which row is being carried
 * — and the loop that scrolls the list while a drag rests near its edge.
 */
export class DragGesture {
  /** Path of the row being dragged, or null when nothing is being dragged. */
  active: string | null = null;

  /** When the drag in progress began. */
  private startedAt = 0;
  private handlers: DragHandlers | null = null;
  /** Where the pointer is during a drag. */
  private pointer = { x: 0, y: 0 };
  /** The frame loop that scrolls the list while the pointer rests near an edge. */
  private scrollFrame: number | null = null;
  /** A redraw a drag held back, to be run as soon as the drag has ended. */
  private deferred = false;

  constructor(
    /** The list that scrolls, if it is on screen. */
    private readonly scroller: () => HTMLElement | null,
    /** Run the redraw a drag held back. */
    private readonly onRelease: () => void
  ) {}

  /**
   * Whether a redraw should wait, and if so remember that one is waiting.
   *
   * A redraw throws away the row the pointer is holding, and with it the
   * gesture: the capture is lost, the drop never arrives, and the move the
   * person was making silently does not happen. The vault raises events
   * throughout a drag — a note saving itself is enough — so the redraw waits
   * for the button to come up instead.
   *
   * Only for as long as a drag can plausibly last. Holding redraws is worth it
   * for the seconds a gesture takes and never worth a pane that has stopped
   * answering because a flag was left standing.
   */
  holdsRedraw(): boolean {
    if (this.active === null || Date.now() - this.startedAt >= DRAG_DEFER_MAX_MS) return false;
    this.deferred = true;
    return true;
  }

  /** A redraw is throwing the rows away, and the drag they held with them. */
  reset(): void {
    this.active = null;
    this.deferred = false;
  }

  /**
   * Let go of a drag, and run the redraw it held back.
   *
   * A tick late, because the click the release raises has to find the flag
   * still set: that click is on the row the drag just moved, and acting on it
   * would open the file that was being filed away.
   */
  end(): void {
    if (this.active === null && !this.deferred) return;

    window.setTimeout(() => {
      this.active = null;
      if (!this.deferred) return;
      this.deferred = false;
      this.onRelease();
    }, 0);
  }

  /**
   * The press-hold-move gesture both drags are built on.
   *
   * A mouse begins as soon as the pointer leaves the row it pressed. A finger
   * has to hold first, because on a touch surface a short drag down a list is
   * how a person scrolls, and taking that gesture would make the pane
   * impossible to move.
   *
   * The pointer is captured on the press rather than when the drag begins, so
   * the release always comes back to this row. Without that, a press that ends
   * somewhere else leaves the row armed, and the next pointer to merely pass
   * over it starts a drag with no button held.
   */
  wire(row: HTMLElement, handlers: DragHandlers): void {
    let startX = 0;
    let startY = 0;
    let armed = false;
    let holdTimer: number | null = null;

    const clearHold = (): void => {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      holdTimer = null;
    };

    const finish = (): void => {
      clearHold();
      armed = false;
      this.stopEdgeScroll();
      this.handlers = null;
      row.removeClass("is-dragging");
      handlers.onEnd();
      // The click that follows a pointerup would otherwise act on the row the
      // drag just moved, so the flag outlives the release by a tick.
      this.end();
    };

    row.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;

      startX = event.clientX;
      startY = event.clientY;

      // Captured now, so pointerup and pointercancel cannot be delivered
      // anywhere else and leave this row armed for ever.
      row.setPointerCapture(event.pointerId);

      if (event.pointerType === "touch") {
        holdTimer = window.setTimeout(() => {
          armed = true;
          row.addClass("is-dragging");
        }, LONG_PRESS_MS);
      } else {
        armed = true;
      }
    });

    // Once the hold has armed, the finger is dragging rather than scrolling.
    // The listener has to be non-passive to be allowed to say so, and the
    // gesture is only taken after the hold, so a plain swipe still scrolls.
    row.addEventListener(
      "touchmove",
      (event: TouchEvent) => {
        if (armed) event.preventDefault();
      },
      { passive: false }
    );

    row.addEventListener("pointermove", (event: PointerEvent) => {
      // A mouse with nothing held down is hovering, not dragging.
      if (event.pointerType !== "touch" && event.buttons === 0) {
        if (this.active === null) armed = false;
        return;
      }

      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      const threshold = event.pointerType === "touch" ? DRAG_TOUCH_THRESHOLD_PX : DRAG_THRESHOLD_PX;

      // A finger that moves before the hold has elapsed is scrolling the pane.
      if (!armed) {
        if (moved > threshold) clearHold();
        return;
      }
      if (this.active === null && moved <= threshold) return;

      if (this.active === null) {
        this.active = handlers.path;
        this.startedAt = Date.now();
        this.handlers = handlers;
        row.addClass("is-dragging");
        handlers.onStart();
        this.startEdgeScroll();
      }

      this.pointer = { x: event.clientX, y: event.clientY };
      handlers.onMove(event.clientX, event.clientY);
    });

    row.addEventListener("pointerup", (event: PointerEvent) => {
      if (this.active !== handlers.path) {
        finish();
        return;
      }

      const x = event.clientX;
      const y = event.clientY;
      finish();
      handlers.onDrop(x, y);
    });

    row.addEventListener("pointercancel", finish);
    // A redraw mid-drag destroys the row, and with it the capture. Without
    // this the gesture never ends and every later click is swallowed.
    row.addEventListener("lostpointercapture", () => {
      if (this.active === handlers.path) finish();
    });
  }

  /**
   * Scroll the list while a drag rests near its top or bottom edge.
   *
   * Without it only what is already on screen can be dropped on, which on a
   * phone is a folder or two. The loop runs per frame rather than per move,
   * because a finger held at the edge is not moving and would otherwise scroll
   * nothing, and it re-marks the target as the list slides underneath it.
   */
  private startEdgeScroll(): void {
    if (this.scrollFrame !== null) return;

    const step = (): void => {
      const body = this.scroller();
      if (!body || this.active === null) {
        this.scrollFrame = null;
        return;
      }

      this.scrollFrame = window.requestAnimationFrame(step);

      const box = body.getBoundingClientRect();
      const above = this.pointer.y - box.top;
      const below = box.bottom - this.pointer.y;
      const speed = (distance: number): number =>
        Math.ceil(((EDGE_SCROLL_PX - distance) / EDGE_SCROLL_PX) * EDGE_SCROLL_MAX_PX);

      let moved = 0;
      if (above < EDGE_SCROLL_PX) moved = -speed(Math.max(0, above));
      else if (below < EDGE_SCROLL_PX) moved = speed(Math.max(0, below));
      if (moved === 0) return;

      const before = body.scrollTop;
      body.scrollTop += moved;
      // The rows moved under a finger that did not: what it is over now is not
      // what it was over a frame ago.
      if (body.scrollTop !== before) {
        this.handlers?.onMove(this.pointer.x, this.pointer.y);
      }
    };

    this.scrollFrame = window.requestAnimationFrame(step);
  }

  private stopEdgeScroll(): void {
    if (this.scrollFrame !== null) window.cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
  }
}

/** What a row hands the long-press gesture. */
export interface PressHandlers {
  /** Whether a drag is in progress, in which case a click is not a click. */
  isDragging: () => boolean;
  /** A click: open the file, or toggle the folder. The event is passed on
   *  for its modifier keys, which turn a click into a selection instead. */
  activate: (event?: MouseEvent) => void;
  /** Open the row's menu, at the pointer or at a finger. */
  showMenu: (at: MouseEvent | { x: number; y: number }) => void;
}

/**
 * A click, a right click, and a finger held still.
 *
 * Mobile has no right click and Obsidian's own long-press belongs to its
 * explorer, so the pane brings its own. The button on the row stays as the
 * way that always works.
 */
export function wirePress(row: HTMLElement, handlers: PressHandlers): void {
  let timer: number | null = null;
  // When the pane's own timer last answered a press on this row, so the
  // browser's context menu for the same press can be recognised.
  let answeredAt: number | null = null;
  // Whether the press in progress has been answered with a menu. Unlike the
  // timestamp above this is not a window: a finger may rest on the row for as
  // long as the menu is being read, and everything that press raises after
  // the menu opened still belongs to it.
  let answered = false;
  // Whether a finger is on the row at all, so the browser's own context menu
  // can tell a long press from a right click without guessing at the event.
  let touching = false;
  let startX = 0;
  let startY = 0;

  const cancel = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  row.addEventListener("click", (event) => {
    // The lift that ends a long press raises a click on the row the menu is
    // standing on. Acting on it opens the file and closes the menu that the
    // press was held to open — and on a phone opening a file closes the pane
    // with it, which is why the menu looked as if it could not be used at
    // all. The row that owns the gesture swallows it instead.
    if (answered) {
      answered = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // A drop is not a click. Without this the row the drag just moved opens
    // as well, and a folder dropped somewhere closes itself on arrival.
    if (handlers.isDragging()) return;

    handlers.activate(event);
  });

  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    // A long press on a touch screen raises this after the pane's timer has
    // already opened a menu. A right click never does, so a second right
    // click on the same row always opens again.
    if (isLongPressEcho(Date.now(), answeredAt)) return;
    // Arriving first instead: the browser is handling the press, so the
    // pane's pending timer would only add a second menu. A finger still on
    // the row has a lift to come, and that lift must not reach the row; a
    // right click has nothing to come.
    cancel();
    if (touching) answered = true;
    handlers.showMenu(event);
  });

  row.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      cancel();
      answeredAt = null;
      answered = false;
      touching = true;
      if (!touch) return;

      startX = touch.clientX;
      startY = touch.clientY;
      timer = window.setTimeout(() => {
        timer = null;
        answeredAt = Date.now();
        answered = true;
        handlers.showMenu({ x: touch.clientX, y: touch.clientY });
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  // A finger never holds perfectly still, so a press survives a little
  // movement. Past that the list is being scrolled, and a scroll is not a
  // long press.
  row.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (!touch) {
        cancel();
        return;
      }
      const moved = Math.hypot(touch.clientX - startX, touch.clientY - startY);
      if (moved > LONG_PRESS_MOVE_PX) cancel();
    },
    { passive: true }
  );

  // Not passive: refusing the default is the whole point. A lift the browser
  // is allowed to complete raises mouse events and a click on whatever is
  // under the finger, and Obsidian closes a menu on any press outside it — so
  // the menu the press just opened would be gone before it could be used.
  row.addEventListener("touchend", (event) => {
    cancel();
    touching = false;
    if (!answered) return;
    event.preventDefault();
    event.stopPropagation();
  });

  row.addEventListener(
    "touchcancel",
    () => {
      cancel();
      touching = false;
    },
    { passive: true }
  );
}
