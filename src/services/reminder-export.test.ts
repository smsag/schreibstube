import { describe, expect, it } from "vitest";
import {
  MAX_REMINDER_NOTES_CHARS,
  MAX_REMINDER_TITLE_CHARS,
  blockIdOf,
  buildReminder,
  generateBlockId,
  isTaskLine,
  shortcutUrl,
  taskBody,
  taskIdFromParams,
  taskLink,
  taskTitle,
  withBlockId
} from "./reminder-export";

describe("block ids", () => {
  it("reads an id off the end of a line and nothing else", () => {
    expect(blockIdOf("- [ ] task ^ab12cd")).toBe("ab12cd");
    expect(blockIdOf("- [ ] task ^ab12cd  ")).toBe("ab12cd");
    expect(blockIdOf("- [ ] task")).toBeNull();
    expect(blockIdOf("- [ ] a^b")).toBeNull();
  });

  it("appends an id, or replaces the one already there", () => {
    expect(withBlockId("- [ ] task", "ab12cd")).toBe("- [ ] task ^ab12cd");
    expect(withBlockId("- [ ] task   ", "ab12cd")).toBe("- [ ] task ^ab12cd");
    expect(withBlockId("- [ ] task ^old", "new")).toBe("- [ ] task ^new");
  });

  it("generates six lowercase alphanumerics from the random source it is given", () => {
    expect(generateBlockId(() => 0)).toBe("aaaaaa");
    expect(generateBlockId(() => 0.999999)).toBe("999999");
    expect(generateBlockId()).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe("taskTitle", () => {
  it("strips the marker, the checkbox and the block id, and keeps tags", () => {
    expect(taskTitle("- [ ] Dies ist die Beschreibung #arbeit ^ab12cd")).toBe(
      "Dies ist die Beschreibung #arbeit"
    );
    expect(taskTitle("  * [x] done")).toBe("done");
    expect(taskTitle("3. [ ] numbered")).toBe("numbered");
  });

  it("caps a very long title", () => {
    const title = taskTitle(`- [ ] ${"x".repeat(500)}`);
    expect(title.length).toBe(MAX_REMINDER_TITLE_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("taskBody", () => {
  it("returns the indented text under the task, dedented", () => {
    const lines = [
      "* [ ] Dies ist die Beschreibung",
      "",
      "             Weitere Information zu dieser Beschreibung",
      "             Zweite Zeile",
      "",
      "Nächster Absatz"
    ];
    expect(taskBody(lines, 0)).toBe("Weitere Information zu dieser Beschreibung\nZweite Zeile");
  });

  it("keeps relative indentation inside the body", () => {
    const lines = ["- [ ] task", "    para", "      - sub", "- [ ] next"];
    expect(taskBody(lines, 0)).toBe("para\n  - sub");
  });

  it("is empty for a task with nothing under it", () => {
    expect(taskBody(["- [ ] task", "- [ ] next"], 0)).toBe("");
  });
});

describe("buildReminder", () => {
  const lines = ["# Backlog", "- [ ] Call the bank #money", "    Ask about the fee", "- [ ] other"];

  it("composes title, notes with cue and link, list and note title", () => {
    const payload = buildReminder({
      lines,
      taskLine: 1,
      id: "ab12cd",
      list: "Arbeit",
      noteTitle: "Klartext Backlog"
    });
    expect(payload).toEqual({
      title: "Call the bank #money",
      notes: "Ask about the fee\n\n↩ Klartext Backlog\nobsidian://schreibstube?task=ab12cd",
      list: "Arbeit",
      link: "obsidian://schreibstube?task=ab12cd",
      note: "Klartext Backlog"
    });
  });

  it("writes only the cue and the link when there is no body", () => {
    const payload = buildReminder({ lines, taskLine: 3, id: "x1", list: "", noteTitle: "N" });
    expect(payload.notes).toBe("↩ N\nobsidian://schreibstube?task=x1");
  });

  it("keeps the notes within the budget and always keeps the link", () => {
    const long = ["- [ ] t", ...Array.from({ length: 200 }, () => "    " + "y".repeat(40))];
    const payload = buildReminder({
      lines: long,
      taskLine: 0,
      id: "ab12cd",
      list: "",
      noteTitle: "N"
    });
    expect(payload.notes.length).toBeLessThanOrEqual(MAX_REMINDER_NOTES_CHARS);
    expect(payload.notes.endsWith("obsidian://schreibstube?task=ab12cd")).toBe(true);
  });
});

describe("shortcutUrl", () => {
  it("runs the named Shortcut with the payload as text input", () => {
    const payload = buildReminder({
      lines: ["- [ ] Ä task"],
      taskLine: 0,
      id: "ab12cd",
      list: "L",
      noteTitle: "N"
    });
    const url = shortcutUrl("  Schreibstube Reminder ", payload);
    expect(
      url.startsWith("shortcuts://run-shortcut?name=Schreibstube%20Reminder&input=text&text=")
    ).toBe(true);
    const text = decodeURIComponent(url.slice(url.indexOf("&text=") + 6));
    expect(JSON.parse(text)).toEqual(payload);
  });
});

describe("the way back", () => {
  it("builds the link the reminder carries", () => {
    expect(taskLink("ab12cd")).toBe("obsidian://schreibstube?task=ab12cd");
  });

  it("accepts a block id and refuses anything else", () => {
    expect(taskIdFromParams({ task: "ab12cd" })).toBe("ab12cd");
    expect(taskIdFromParams({ task: "with-dash" })).toBe("with-dash");
    expect(taskIdFromParams({ task: "" })).toBeNull();
    expect(taskIdFromParams({})).toBeNull();
    expect(taskIdFromParams({ task: "../x" })).toBeNull();
    expect(taskIdFromParams({ task: "a".repeat(65) })).toBeNull();
  });
});

describe("isTaskLine", () => {
  it("knows a task from a bullet", () => {
    expect(isTaskLine("- [ ] a")).toBe(true);
    expect(isTaskLine("- [x] a")).toBe(true);
    expect(isTaskLine("- a")).toBe(false);
    expect(isTaskLine("")).toBe(false);
  });
});
