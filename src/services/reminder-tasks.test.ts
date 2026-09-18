import { describe, expect, it } from "vitest";
import {
  blockIdOf,
  blockIdsIn,
  dueOf,
  findTaskLine,
  generateTaskId,
  isDone,
  isReminderTask,
  isTaskLine,
  MAX_REMINDER_NOTES_CHARS,
  MAX_REMINDER_TITLE_CHARS,
  reminderIdSpan,
  reminderNotes,
  reminderTasksIn,
  taskBody,
  taskIdFromParams,
  taskLink,
  taskMatch,
  taskTitle,
  withDone,
  withRemindTag,
  withTaskIds
} from "./reminder-tasks";

/** Ids handed out in order, so a test can say which line got which. */
function ids(...list: string[]): () => string {
  let index = 0;
  return () => list[index++] ?? `r-extra${index}`;
}

describe("what makes a task a reminder", () => {
  it("counts a due date when dates are enough, and the tag always", () => {
    expect(isReminderTask("- [ ] call 📅 2026-09-20", "date")).toBe(true);
    expect(isReminderTask("- [ ] call 📅 2026-09-20", "tag")).toBe(false);
    expect(isReminderTask("- [ ] call #remind", "tag")).toBe(true);
    expect(isReminderTask("- [ ] call #remind ^r-abc123", "tag")).toBe(true);
    expect(isReminderTask("- [ ] call #reminder", "tag")).toBe(false);
    expect(isReminderTask("- [ ] call", "date")).toBe(false);
  });

  it("never counts a line that is not a task", () => {
    expect(isReminderTask("- call #remind 📅 2026-09-20", "date")).toBe(false);
    expect(isTaskLine("1. [x] done")).toBe(true);
    expect(isTaskLine("plain")).toBe(false);
  });

  it("counts a task sent by an earlier version, so it is migrated", () => {
    expect(isReminderTask("- [ ] call [⏰](obsidian://schreibstube?task=ab12cd)", "tag")).toBe(
      true
    );
  });

  it("reads the due date and completion", () => {
    expect(dueOf("- [ ] x 📅2026-01-02")).toBe("2026-01-02");
    expect(dueOf("- [ ] x ⏳ 2026-01-02")).toBeNull();
    expect(isDone("- [x] x")).toBe(true);
    expect(isDone("- [-] cancelled")).toBe(true);
    expect(isDone("- [ ] x")).toBe(false);
    expect(isDone("text")).toBe(false);
  });
});

describe("the title", () => {
  it("drops the box, the dates, the tag and the id, and keeps other tags", () => {
    expect(
      taskTitle("- [ ] Call the bank #money #remind 📅 2026-09-20 ✅ 2026-09-21 ^r-abc123")
    ).toBe("Call the bank #money");
  });

  it("drops the link of an earlier version", () => {
    expect(taskTitle("- [ ] Call [⏰](obsidian://schreibstube?task=ab12cd)")).toBe("Call");
  });

  it("caps a very long title", () => {
    const title = taskTitle(`- [ ] ${"a".repeat(500)}`);
    expect(title).toHaveLength(MAX_REMINDER_TITLE_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("ids", () => {
  it("reads a block id at the end of a line only", () => {
    expect(blockIdOf("- [ ] x ^r-abc123")).toBe("r-abc123");
    expect(blockIdOf("- [ ] x ^r-abc123  ")).toBe("r-abc123");
    expect(blockIdOf("- [ ] ^mid x")).toBeNull();
    expect(blockIdsIn("a ^one\nb\nc ^two")).toEqual(["one", "two"]);
  });

  it("generates r- and six lowercase alphanumerics from the random source", () => {
    expect(generateTaskId(() => 0)).toBe("r-aaaaaa");
    expect(generateTaskId(() => 0.9999)).toBe("r-999999");
  });

  it("gives every reminder task without one an id, and nothing else", () => {
    const note = [
      "# Plan",
      "- [ ] dated 📅 2026-09-20",
      "- [ ] plain",
      "- [ ] tagged #remind ^r-kept01",
      "- [ ] tagged too #remind   "
    ].join("\n");
    const taken = new Set<string>(["r-kept01"]);

    const updated = withTaskIds(note, "date", taken, ids("r-new001", "r-new002"));

    expect(updated?.split("\n")).toEqual([
      "# Plan",
      "- [ ] dated 📅 2026-09-20 ^r-new001",
      "- [ ] plain",
      "- [ ] tagged #remind ^r-kept01",
      "- [ ] tagged too #remind ^r-new002"
    ]);
    expect([...taken]).toEqual(["r-kept01", "r-new001", "r-new002"]);
  });

  it("returns null when every reminder task already has its id", () => {
    expect(withTaskIds("- [ ] x #remind ^r-a\n- [ ] y", "date", new Set())).toBeNull();
  });

  it("does not hand out an id already taken", () => {
    const updated = withTaskIds("- [ ] x #remind", "tag", new Set(["r-dup"]), ids("r-dup", "r-ok"));
    expect(updated).toBe("- [ ] x #remind ^r-ok");
  });

  it("keeps the note's line endings", () => {
    expect(withTaskIds("- [ ] x #remind\r\n- [ ] y", "tag", new Set(), ids("r-a"))).toBe(
      "- [ ] x #remind ^r-a\r\n- [ ] y"
    );
  });

  it("turns an earlier version's link into the tag and a block id with the same id", () => {
    const taken = new Set<string>();
    expect(withTaskIds("- [ ] call [⏰](obsidian://schreibstube?task=ab12cd)", "date", taken)).toBe(
      "- [ ] call #remind ^ab12cd"
    );
    expect(taken.has("ab12cd")).toBe(true);
  });
});

describe("editing a task line", () => {
  it("ticks and reopens the box, and leaves a box already right alone", () => {
    expect(withDone("- [ ] x ^r-a", true)).toBe("- [x] x ^r-a");
    expect(withDone("  1. [x] x", false)).toBe("  1. [ ] x");
    expect(withDone("- [-] cancelled", true)).toBe("- [-] cancelled");
  });

  it("adds the tag before the id, once", () => {
    expect(withRemindTag("- [ ] x")).toBe("- [ ] x #remind");
    expect(withRemindTag("- [ ] x ^r-abc123")).toBe("- [ ] x #remind ^r-abc123");
    expect(withRemindTag("- [ ] x #remind")).toBe("- [ ] x #remind");
  });
});

describe("the task as Reminders should have it", () => {
  it("reads title, notes with the way back, due date and completion", () => {
    const note = [
      "- [ ] Call the bank #remind 📅 2026-09-20 ^r-abc123",
      "    Ask about the fee",
      "- [x] Paid #remind ^r-def456",
      "- [ ] no id yet #remind",
      "- [ ] not a reminder ^r-zzz999"
    ].join("\n");

    const tasks = reminderTasksIn("Notes/Bank.md", "Bank", note, "date");

    expect(tasks).toEqual([
      {
        id: "r-abc123",
        path: "Notes/Bank.md",
        line: 0,
        title: "Call the bank",
        notes: `Ask about the fee\n\n↩ Bank\n${taskLink("r-abc123")}`,
        due: "2026-09-20",
        done: false
      },
      {
        id: "r-def456",
        path: "Notes/Bank.md",
        line: 2,
        title: "Paid",
        notes: `↩ Bank\n${taskLink("r-def456")}`,
        due: null,
        done: true
      }
    ]);
  });

  it("keeps the notes within the budget and always keeps the link", () => {
    const notes = reminderNotes("b".repeat(5000), "Note", "r-abc123");
    expect(notes.length).toBeLessThanOrEqual(MAX_REMINDER_NOTES_CHARS);
    expect(notes.endsWith(taskLink("r-abc123"))).toBe(true);
  });

  it("dedents the body and keeps its relative indentation", () => {
    const lines = ["- [ ] t", "    one", "      two", "- [ ] next"];
    expect(taskBody(lines, 0)).toBe("one\n  two");
    expect(taskBody(["- [ ] t", "- [ ] u"], 0)).toBe("");
  });

  it("makes a match that tells an id from a longer one", () => {
    const notes = reminderNotes("", "N", "r-abcd");
    expect(notes.includes(taskMatch("r-abcd"))).toBe(true);
    expect(notes.includes(taskMatch("r-abc"))).toBe(false);
  });
});

describe("the way back", () => {
  it("finds the line by block id, or by an earlier version's link", () => {
    const note = "intro\n- [ ] a ^r-one\n- [ ] b [⏰](obsidian://schreibstube?task=old123)";
    expect(findTaskLine(note, "r-one")).toBe(1);
    expect(findTaskLine(note, "old123")).toBe(2);
    expect(findTaskLine(note, "r-two")).toBeNull();
  });

  it("accepts a task id and refuses anything else", () => {
    expect(taskIdFromParams({ task: "r-abc123", from: "reminders" })).toBe("r-abc123");
    expect(taskIdFromParams({ task: "../x" })).toBeNull();
    expect(taskIdFromParams({ done: "1" })).toBeNull();
  });

  it("locates the id of a reminder task for the renderer, and only there", () => {
    const line = "- [ ] x #remind ^r-abc123";
    const span = reminderIdSpan(line, "tag");
    expect(span && line.slice(span.from, span.to)).toBe("^r-abc123");
    expect(reminderIdSpan("- [ ] x ^r-abc123", "date")).toBeNull();
    expect(reminderIdSpan("- [ ] x #remind", "date")).toBeNull();
  });
});
