import { describe, expect, it } from "vitest";
import { commandAvailable, type CommandContext, type GatedCommand } from "./command-availability";

function screen(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    markdown: true,
    image: false,
    selection: false,
    bound: false,
    explorerOpen: false,
    task: false,
    apple: false,
    sentTask: false,
    ...overrides
  };
}

function offered(context: CommandContext): GatedCommand[] {
  const all: GatedCommand[] = [
    "rename-note",
    "rename-image",
    "summarize",
    "check-source",
    "send-mail",
    "fetch-replies",
    "collapse-explorer",
    "send-reminder",
    "check-note-reminders",
    "fetch-reminders"
  ];

  return all.filter((command) => commandAvailable(command, context));
}

describe("what the palette offers", () => {
  it("offers a plain note what can be done to a plain note", () => {
    expect(offered(screen())).toEqual(["rename-note", "send-mail", "fetch-replies"]);
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

  it("offers each rename to the kind of file it can read, and no other", () => {
    expect(offered(screen({ markdown: true }))).toContain("rename-note");
    expect(offered(screen({ markdown: true }))).not.toContain("rename-image");
    expect(offered(screen({ markdown: false, image: true }))).toEqual(["rename-image"]);
  });

  it("offers nothing at all with a PDF open, rather than four refusals", () => {
    expect(offered(screen({ markdown: false, image: false }))).toEqual([]);
  });

  it("offers a reminder for the task under the cursor, on Apple's platforms only", () => {
    expect(offered(screen({ task: true, apple: true }))).toContain("send-reminder");
    expect(offered(screen({ task: false, apple: true }))).not.toContain("send-reminder");
    expect(offered(screen({ task: true, apple: false }))).not.toContain("send-reminder");
    expect(offered(screen({ task: true, apple: true, markdown: false }))).not.toContain(
      "send-reminder"
    );
  });

  it("offers to check a note against Reminders only when one of its tasks was sent", () => {
    expect(offered(screen({ apple: true, sentTask: true }))).toContain("check-note-reminders");
    expect(offered(screen({ apple: true, sentTask: false }))).not.toContain("check-note-reminders");
    expect(offered(screen({ apple: false, sentTask: true }))).not.toContain("check-note-reminders");
  });

  it("offers to fetch from Reminders wherever Reminders exists, whatever is open", () => {
    expect(offered(screen({ apple: true, markdown: false }))).toContain("fetch-reminders");
    expect(offered(screen({ apple: false }))).not.toContain("fetch-reminders");
  });

  it("offers to close the folders only where there are folders to close", () => {
    expect(offered(screen({ explorerOpen: true }))).toContain("collapse-explorer");
    expect(offered(screen({ explorerOpen: false }))).not.toContain("collapse-explorer");
  });
});
