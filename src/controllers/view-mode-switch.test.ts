import { describe, expect, it, vi } from "vitest";
import type { MarkdownView } from "obsidian";
import { createLogger } from "../services/logger";
import { switchReadingEditing } from "./view-mode-switch";

/** A note view that, like Obsidian's, scrolls itself to the top on a change of mode. */
function noteView(state: Record<string, unknown>, place: Record<string, unknown>) {
  let ephemeral = place;
  const view = {
    getState: () => state,
    setState: vi.fn(async (next: Record<string, unknown>) => {
      state = next;
      ephemeral = { scroll: 0 };
    }),
    getEphemeralState: () => ephemeral,
    setEphemeralState: (next: Record<string, unknown>) => (ephemeral = next)
  };
  return {
    view: view as unknown as MarkdownView,
    setState: view.setState,
    state: () => state,
    place: () => ephemeral
  };
}

const quiet = createLogger(() => false);

describe("the reading/editing switch", () => {
  it("takes a note in Live Preview to Reading view, on the same line", async () => {
    const note = noteView(
      { file: "a.md", mode: "source", source: false },
      { scroll: 42, cursor: { from: { line: 44, ch: 3 }, to: { line: 44, ch: 3 } } }
    );

    await switchReadingEditing(note.view, quiet);

    expect(note.state()).toEqual({ file: "a.md", mode: "preview", source: false });
    expect(note.place()).toMatchObject({ scroll: 42 });
  });

  it("takes a note in Reading view or Source mode to Live Preview", async () => {
    for (const from of [
      { mode: "preview", source: true },
      { mode: "source", source: true }
    ]) {
      const note = noteView({ file: "a.md", ...from }, { scroll: 7 });

      await switchReadingEditing(note.view, quiet);

      expect(note.state()).toEqual({ file: "a.md", mode: "source", source: false });
      expect(note.place()).toEqual({ scroll: 7 });
    }
  });

  it("leaves no history entry, so Back leaves the note rather than the mode", async () => {
    const note = noteView({ mode: "source", source: false }, {});

    await switchReadingEditing(note.view, quiet);

    expect(note.setState).toHaveBeenCalledWith(expect.anything(), { history: false });
  });

  it("logs a switch Obsidian refuses instead of throwing it at the palette", async () => {
    const note = noteView({ mode: "source", source: false }, {});
    note.setState.mockRejectedValueOnce(new Error("detached"));
    const warn = vi.fn();
    const logger = createLogger(() => false, { ...console, warn });

    await expect(switchReadingEditing(note.view, logger)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
