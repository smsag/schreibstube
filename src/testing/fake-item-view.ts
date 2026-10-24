/**
 * Obsidian's `ItemView`, as far as the plugin's own views lean on it, for a
 * test running in happy-dom. A test swaps it in for the stub's empty class
 * with `vi.mock("obsidian", …)`, opens the view, and fires the vault and
 * workspace events it registered for with `emit`.
 */

type Handler = (...args: never[]) => unknown;

export interface FakeViewApp {
  vault: { on(name: string, handler: Handler): { name: string } };
  metadataCache: { on(name: string, handler: Handler): { name: string } };
  workspace: {
    on(name: string, handler: Handler): { name: string };
    getActiveFile(): unknown;
    requestSaveLayout(): void;
  };
  /** Every handler registered for an event, called with the arguments given. */
  emit(name: string, ...args: unknown[]): void;
  saves: number;
}

export function fakeViewApp(activeFile: unknown = null): FakeViewApp {
  const handlers = new Map<string, Handler[]>();
  const on = (name: string, handler: Handler) => {
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    return { name };
  };
  const app: FakeViewApp = {
    vault: { on },
    metadataCache: { on },
    workspace: {
      on,
      getActiveFile: () => activeFile,
      requestSaveLayout: () => {
        app.saves += 1;
      }
    },
    emit: (name, ...args) => {
      for (const handler of handlers.get(name) ?? []) (handler as Handler)(...(args as never[]));
    },
    saves: 0
  };
  return app;
}

/** Runs a frame's callback at once, so a test sees the redraw it asked for. */
function immediateWindow(): Window {
  return Object.assign(Object.create(window) as Window, {
    requestAnimationFrame: (run: FrameRequestCallback) => (run(0), 1),
    cancelAnimationFrame: () => undefined
  });
}

export class FakeItemView {
  app: FakeViewApp;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  navigation = false;

  constructor(public leaf: { app: FakeViewApp }) {
    this.app = leaf.app;
    this.containerEl = document.body.createDiv();
    Object.defineProperty(this.containerEl, "win", { value: immediateWindow() });
    this.contentEl = this.containerEl.createDiv();
  }

  registerEvent(_ref: unknown): void {}
  register(_cleanup: () => void): void {}
  addAction(_icon: string, _title: string, _run: () => void): HTMLElement {
    return this.containerEl.createDiv();
  }
  async setState(_state: unknown, _result: unknown): Promise<void> {}
  getState(): Record<string, unknown> {
    return {};
  }
}
