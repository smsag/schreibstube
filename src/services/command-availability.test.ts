import { describe, expect, it } from "vitest";
import {
  commandAvailable,
  renameTarget,
  type CommandContext,
  type GatedCommand
} from "./command-availability";

function screen(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    markdown: true,
    image: false,
    selection: false,
    bound: false,
    explorerOpen: false,
    ...overrides
  };
}

function offered(context: CommandContext): GatedCommand[] {
  const all: GatedCommand[] = [
    "rename",
    "summarize",
    "table",
    "insert-today",
    "check-source",
    "send-mail",
    "fetch-replies",
    "collapse-explorer",
    "related"
  ];

  return all.filter((command) => commandAvailable(command, context));
}

describe("what the palette offers", () => {
  it("offers a plain note what can be done to a plain note", () => {
    expect(offered(screen())).toEqual([
      "rename",
      "insert-today",
      "send-mail",
      "fetch-replies",
      "related"
    ]);
  });

  it("offers a note bound to a source the check for it", () => {
    expect(offered(screen({ bound: true }))).toContain("check-source");
  });

  it("offers nothing about a source to a note that mirrors none", () => {
    expect(offered(screen({ bound: false }))).not.toContain("check-source");
  });

  it("offers summarizing only when there is something selected", () => {
    // The refusal this replaces was a notice telling a person to select text —
    // which is what they had opened the palette to act on.
    expect(offered(screen({ selection: true }))).toContain("summarize");
    expect(offered(screen({ selection: false }))).not.toContain("summarize");
  });

  it("offers a table only when there is something selected", () => {
    expect(offered(screen({ selection: true }))).toContain("table");
    expect(offered(screen({ selection: false }))).not.toContain("table");
  });

  it("offers the rename to a note and to a picture, and nothing else to a picture", () => {
    expect(offered(screen({ markdown: true }))).toContain("rename");
    expect(offered(screen({ markdown: false, image: true }))).toEqual(["rename"]);
  });

  it("renames what is open: the picture, the note, or nothing", () => {
    expect(renameTarget(screen({ markdown: false, image: true }))).toBe("image");
    expect(renameTarget(screen({ markdown: true }))).toBe("note");
    expect(renameTarget(screen({ markdown: false, image: false }))).toBeNull();
  });

  it("offers nothing at all with a PDF open, rather than four refusals", () => {
    expect(offered(screen({ markdown: false, image: false }))).toEqual([]);
  });

  it("offers to close the folders only where there are folders to close", () => {
    expect(offered(screen({ explorerOpen: true }))).toContain("collapse-explorer");
    expect(offered(screen({ explorerOpen: false }))).not.toContain("collapse-explorer");
  });

  it("offers related notes on a note and not on a picture", () => {
    expect(offered(screen({ markdown: true }))).toContain("related");
    expect(offered(screen({ markdown: false, image: true }))).not.toContain("related");
  });
});
