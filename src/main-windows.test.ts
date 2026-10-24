// @vitest-environment happy-dom
/**
 * The capture listeners each controller hangs on every window's document:
 * taken off a pop-out when it closes, and off every window when the plugin
 * unloads.
 */
import { describe, expect, it, vi } from "vitest";
import SchreibstubePlugin from "./main";

vi.mock("obsidian", async (importOriginal) => {
  const stub = await importOriginal<typeof import("./testing/obsidian-stub")>();
  /** Obsidian's own: the listener goes when the component unloads. */
  class Component extends stub.Component {
    registerDomEvent(target: EventTarget, type: string, run: EventListener, options?: object) {
      target.addEventListener(type, run, options);
      this.register(() => target.removeEventListener(type, run, options));
    }
  }
  return { ...stub, Component };
});

type Handler = (...args: unknown[]) => void;

function setup() {
  const events = new Map<string, Set<Handler>>();
  const cleanups: (() => void)[] = [];
  const on = (name: string, handler: Handler) => {
    const set = events.get(name) ?? new Set<Handler>();
    events.set(name, set.add(handler));
    return { e: { offref: () => set.delete(handler) } };
  };
  const plugin = new SchreibstubePlugin(
    { workspace: { on } } as never,
    { id: "schreibstube" } as never
  );
  Object.assign(plugin, {
    registerEvent: () => undefined,
    register: (cleanup: () => void) => cleanups.push(cleanup),
    registerDomEvent: (target: EventTarget, type: string, run: EventListener, options?: object) => {
      target.addEventListener(type, run, options);
      cleanups.push(() => target.removeEventListener(type, run, options));
    },
    addChild: (child: { load(): void }) => (child.load(), child),
    removeChild: (child: { unload(): void }) => child.unload()
  });
  const fire = (name: string, win: Window) => {
    for (const handler of [...(events.get(name) ?? [])]) handler({}, win);
  };
  const press = vi.fn();
  (
    plugin as unknown as {
      inEveryWindow(attach: (win: Window, on: (...args: unknown[]) => void) => void): void;
    }
  ).inEveryWindow((win, listen) => listen(win.document, "click", press));
  const popout = {
    document: document.implementation.createHTMLDocument("pop-out")
  } as unknown as Window;
  const unload = () => cleanups.forEach((cleanup) => cleanup());
  return { fire, press, popout, unload, events };
}

describe("listening in every window", () => {
  it("hears a press in a pop-out until the pop-out closes, and lets the window go", () => {
    const { fire, press, popout, events } = setup();
    fire("window-open", popout);
    popout.document.body.click();
    fire("window-close", popout);
    popout.document.body.click();
    expect(press).toHaveBeenCalledTimes(1);
    expect(events.get("window-close")?.size).toBe(0);
  });

  it("stops hearing the main window when the plugin unloads", () => {
    const { press, unload } = setup();
    document.body.click();
    unload();
    document.body.click();
    expect(press).toHaveBeenCalledTimes(1);
  });
});
