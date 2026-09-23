import { describe, expect, it } from "vitest";
import { UNDO_WINDOW_MS, UndoStack } from "./undo-stack";
import type { UndoableAction } from "./undo-stack";

const move: UndoableAction = { kind: "move", steps: [{ from: "A/x.md", to: "B/x.md" }] };
const remove: UndoableAction = {
  kind: "delete",
  steps: [{ from: "x.md", trashedTo: ".trash/x.md" }]
};

describe("UndoStack", () => {
  it("offers the last action, and only the last", () => {
    const stack = new UndoStack();
    stack.push(move, 1000);
    stack.push(remove, 2000);

    expect(stack.peek(2500)).toBe(remove);
  });

  it("hands an action over once", () => {
    const stack = new UndoStack();
    stack.push(move, 1000);

    expect(stack.take(1500)).toBe(move);
    expect(stack.take(1600)).toBeNull();
  });

  it("forgets an action once its window has passed", () => {
    const stack = new UndoStack();
    stack.push(move, 1000);

    expect(stack.peek(1000 + UNDO_WINDOW_MS)).toBe(move);
    expect(stack.peek(1000 + UNDO_WINDOW_MS + 1)).toBeNull();
  });

  it("remembers nothing of an action with no steps", () => {
    const stack = new UndoStack();
    stack.push({ kind: "move", steps: [] }, 1000);

    expect(stack.peek(1000)).toBeNull();
  });

  it("can be told to forget", () => {
    const stack = new UndoStack();
    stack.push(remove, 1000);
    stack.clear();

    expect(stack.peek(1000)).toBeNull();
  });

  it("takes its window from the caller, for a test or a setting", () => {
    const stack = new UndoStack(10);
    stack.push(move, 0);

    expect(stack.peek(10)).toBe(move);
    expect(stack.peek(11)).toBeNull();
  });
});
