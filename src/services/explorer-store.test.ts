import { beforeEach, describe, expect, it, vi } from "vitest";
import { NULL_LOGGER } from "./logger";
import { ExplorerStore, type ExplorerFileStore } from "./explorer-store";
import { iconFor, setIcon, serializeExplorerData, emptyExplorerData } from "./explorer-state";

const T0 = Date.UTC(2026, 8, 12, 8, 0);

/**
 * A file that behaves like the one on disk: it has a modification time, it can
 * be written from outside, and it can refuse to be written.
 */
class FakeFile implements ExplorerFileStore {
  text: string | null = null;
  mtimeMs = T0;
  writes = 0;
  failWrites = false;

  async read(): Promise<string | null> {
    return this.text;
  }

  async write(text: string): Promise<void> {
    if (this.failWrites) throw new Error("read-only volume");
    this.writes += 1;
    this.text = text;
    this.mtimeMs += 1000;
  }

  async mtime(): Promise<number | null> {
    return this.text === null ? null : this.mtimeMs;
  }

  /** What another device would leave behind. */
  putForeign(text: string): void {
    this.text = text;
    this.mtimeMs += 5000;
  }
}

/** Timers the test drives by hand, so a debounce is deterministic. */
function manualTimers() {
  const pending: (() => void)[] = [];
  return {
    setTimer: (callback: () => void) => {
      pending.push(callback);
      return pending.length - 1;
    },
    clearTimer: (handle: unknown) => {
      pending[handle as number] = () => {};
    },
    run: () => {
      const due = [...pending];
      pending.length = 0;
      for (const callback of due) callback();
    },
    count: () => pending.length
  };
}

function makeStore(file: FakeFile, timers = manualTimers(), now = () => T0) {
  return new ExplorerStore({
    file,
    logger: NULL_LOGGER,
    now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
}

let file: FakeFile;

beforeEach(() => {
  file = new FakeFile();
});

describe("loading", () => {
  it("starts empty when there is no file yet", async () => {
    const store = makeStore(file);
    await store.load();

    expect(store.data().entries).toEqual({});
  });

  it("reads what a previous session wrote", async () => {
    file.text = serializeExplorerData(setIcon(emptyExplorerData(), "a.md", "home", T0));

    const store = makeStore(file);
    await store.load();

    expect(iconFor(store.data(), "a.md")).toBe("home");
  });

  it("keeps working when the file is not valid JSON", async () => {
    file.text = "{ half a file";

    const store = makeStore(file);
    await store.load();

    expect(store.data().entries).toEqual({});
  });
});

describe("writing", () => {
  it("collects a burst of changes into one write", async () => {
    const timers = manualTimers();
    const store = makeStore(file, timers);
    await store.load();

    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    store.mutate((data, now) => setIcon(data, "b.md", "star", now));
    expect(file.writes).toBe(0);

    await store.flush();

    expect(file.writes).toBe(1);
    expect(iconFor(store.data(), "b.md")).toBe("star");
  });

  it("shows the change before the write lands", async () => {
    const store = makeStore(file);
    await store.load();

    store.mutate((data, now) => setIcon(data, "a.md", "home", now));

    expect(iconFor(store.data(), "a.md")).toBe("home");
    expect(file.text).toBeNull();
  });

  it("tells listeners about a change, once", async () => {
    const store = makeStore(file);
    await store.load();
    const listener = vi.fn();
    store.onChange(listener);

    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    store.mutate((data) => data);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps another device's entry that arrived between two writes", async () => {
    const store = makeStore(file);
    await store.load();

    store.mutate((data, now) => setIcon(data, "mine.md", "home", now));
    file.putForeign(serializeExplorerData(setIcon(emptyExplorerData(), "theirs.md", "star", T0)));

    await store.flush();

    expect(iconFor(store.data(), "mine.md")).toBe("home");
    expect(iconFor(store.data(), "theirs.md")).toBe("star");
    expect(file.text).toContain("theirs.md");
  });

  it("does not write when the file already says what we would say", async () => {
    const store = makeStore(file);
    await store.load();
    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    await store.flush();

    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    await store.flush();

    expect(file.writes).toBe(1);
  });

  it("retries after a failed write instead of losing the change", async () => {
    const store = makeStore(file);
    await store.load();
    file.failWrites = true;

    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    await store.flush();
    expect(file.text).toBeNull();

    file.failWrites = false;
    await store.flush();

    expect(file.text).toContain("home");
  });

  it("flushes nothing when nothing changed", async () => {
    const store = makeStore(file);
    await store.load();

    await store.flush();

    expect(file.writes).toBe(0);
  });

  it("writes on its own once the debounce elapses", async () => {
    const timers = manualTimers();
    const store = makeStore(file, timers);
    await store.load();

    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    timers.run();
    await store.flush();

    expect(file.text).toContain("home");
  });
});

describe("picking up a foreign write", () => {
  it("adopts what another device wrote and says so", async () => {
    const store = makeStore(file);
    await store.load();
    const listener = vi.fn();
    store.onChange(listener);

    file.putForeign(serializeExplorerData(setIcon(emptyExplorerData(), "theirs.md", "star", T0)));

    expect(await store.refreshFromDisk()).toBe(true);
    expect(iconFor(store.data(), "theirs.md")).toBe("star");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the file has not moved", async () => {
    const store = makeStore(file);
    await store.load();
    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    await store.flush();

    expect(await store.refreshFromDisk()).toBe(false);
  });

  it("keeps an unwritten local change and still writes it", async () => {
    const timers = manualTimers();
    const store = makeStore(file, timers);
    await store.load();

    store.mutate((data, now) => setIcon(data, "mine.md", "home", now));
    file.putForeign(serializeExplorerData(setIcon(emptyExplorerData(), "theirs.md", "star", T0)));

    await store.refreshFromDisk();
    timers.run();
    await store.flush();

    expect(file.text).toContain("mine.md");
    expect(file.text).toContain("theirs.md");
  });

  it("survives a file that is unreadable at that moment", async () => {
    const store = makeStore(file);
    await store.load();
    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    await store.flush();

    file.read = async () => {
      throw new Error("busy");
    };
    file.mtimeMs += 5000;

    expect(await store.refreshFromDisk()).toBe(false);
    expect(iconFor(store.data(), "a.md")).toBe("home");
  });
});

describe("dispose", () => {
  it("stops the pending write and drops listeners", async () => {
    const timers = manualTimers();
    const store = makeStore(file, timers);
    await store.load();
    const listener = vi.fn();
    store.onChange(listener);

    store.mutate((data, now) => setIcon(data, "a.md", "home", now));
    store.dispose();
    timers.run();

    expect(file.writes).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
