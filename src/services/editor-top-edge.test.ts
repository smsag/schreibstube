import { describe, expect, it, vi } from "vitest";
import { topEdgeLine, type TopEdgeView } from "./editor-top-edge";

/**
 * The line under the heading overlay, and what happens when CodeMirror cannot
 * say. Lines are 10 characters long here, so position 35 is on line 4 (0-based 3).
 */

const rect = (left: number, top: number, width = 400, height = 600) => ({
  left,
  top,
  width,
  height
});

function view(overrides: Partial<TopEdgeView> = {}, posAt = vi.fn((): number | null => 35)) {
  const fake: TopEdgeView = {
    scrollDOM: { isConnected: true, getBoundingClientRect: () => rect(100, 50) },
    contentDOM: { getBoundingClientRect: () => rect(140, 50) },
    posAtCoords: posAt,
    state: {
      doc: { length: 200, lineAt: (pos: number) => ({ number: Math.floor(pos / 10) + 1 }) }
    },
    viewport: { from: 12 },
    ...overrides
  };
  return { fake, posAt };
}

describe("topEdgeLine", () => {
  it("reads the line at the top edge, below the overlay, inside the text", () => {
    const { fake, posAt } = view();
    expect(topEdgeLine(fake, 30)).toBe(3);
    expect(posAt).toHaveBeenCalledWith({ x: 141, y: 81 });
  });

  it("falls back to the first laid-out line when CodeMirror throws, instead of throwing", () => {
    // What the console showed: reading 'isText' of undefined, from inside the
    // editor's own lookup, while it swapped one note for another.
    const { fake } = view(
      {},
      vi.fn(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'isText')");
      })
    );
    expect(topEdgeLine(fake, 30)).toBe(1);
  });

  it("falls back when the point holds no position", () => {
    const { fake } = view(
      {},
      vi.fn(() => null)
    );
    expect(topEdgeLine(fake, 0)).toBe(1);
  });

  it("does not ask an editor that is no longer in the document", () => {
    const { fake, posAt } = view({
      scrollDOM: { isConnected: false, getBoundingClientRect: () => rect(100, 50) }
    });
    expect(topEdgeLine(fake, 0)).toBe(1);
    expect(posAt).not.toHaveBeenCalled();
  });

  it("does not ask an editor that has not been laid out", () => {
    const { fake, posAt } = view({
      scrollDOM: { isConnected: true, getBoundingClientRect: () => rect(0, 0, 0, 0) }
    });
    expect(topEdgeLine(fake, 0)).toBe(1);
    expect(posAt).not.toHaveBeenCalled();
  });

  it("keeps a position past the end of the document inside it", () => {
    const { fake } = view(
      {},
      vi.fn(() => 5000)
    );
    expect(topEdgeLine(fake, 0)).toBe(20);
  });

  it("ignores a negative overlay height", () => {
    const { fake, posAt } = view();
    topEdgeLine(fake, -20);
    expect(posAt).toHaveBeenCalledWith({ x: 141, y: 51 });
  });
});
