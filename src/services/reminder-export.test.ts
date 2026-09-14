import { describe, expect, it } from "vitest";
import {
  MAX_REMINDER_NOTES_CHARS,
  MAX_REMINDER_TITLE_CHARS,
  buildReminder,
  findTaskLine,
  generateTaskId,
  isTaskLine,
  reminderIdOf,
  reminderLinkSpan,
  shortcutUrl,
  taskBody,
  taskIdFromParams,
  taskIdInUse,
  taskLink,
  taskTitle,
  withReminderLink
} from "./reminder-export";

const LINK = "[⏰](obsidian://schreibstube?task=ab12cd)";

describe("the reminder link on a task line", () => {
  it("reads the id off a link at the end of the line and nowhere else", () => {
    expect(reminderIdOf(`- [ ] task ${LINK}`)).toBe("ab12cd");
    expect(reminderIdOf(`- [ ] task ${LINK}  `)).toBe("ab12cd");
    expect(reminderIdOf(`- [ ] ${LINK} task`)).toBeNull();
    expect(reminderIdOf("- [ ] task [x](https://example.com)")).toBeNull();
    expect(reminderIdOf("- [ ] task")).toBeNull();
  });

  it("appends the link, or replaces the one already there", () => {
    expect(withReminderLink("- [ ] task", "ab12cd")).toBe(`- [ ] task ${LINK}`);
    expect(withReminderLink("- [ ] task   ", "ab12cd")).toBe(`- [ ] task ${LINK}`);
    expect(withReminderLink(`- [ ] task ${LINK}`, "zz99zz")).toBe(
      "- [ ] task [⏰](obsidian://schreibstube?task=zz99zz)"
    );
  });

  it("locates the link for a renderer, without the space before it", () => {
    const line = `- [ ] task ${LINK}`;
    const span = reminderLinkSpan(line);
    expect(span).toEqual({ from: 11, to: line.length, id: "ab12cd" });
    expect(line.slice(span!.from, span!.to)).toBe(LINK);
    expect(reminderLinkSpan("- [ ] task")).toBeNull();
  });

  it("finds the line that carries an id, in the whole note", () => {
    const content = ["# H", "- [ ] one", `- [ ] two ${LINK}`, "- [x] three"].join("\n");
    expect(findTaskLine(content, "ab12cd")).toBe(2);
    expect(findTaskLine(content, "nope00")).toBeNull();
    expect(taskIdInUse(content, "ab12cd")).toBe(true);
    expect(taskIdInUse(content, "ab12c")).toBe(false);
  });

  it("generates six lowercase alphanumerics from the random source it is given", () => {
    expect(generateTaskId(() => 0)).toBe("aaaaaa");
    expect(generateTaskId(() => 0.999999)).toBe("999999");
    expect(generateTaskId()).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe("taskTitle", () => {
  it("strips the marker, the checkbox and the reminder link, and keeps tags", () => {
    expect(taskTitle(`- [ ] Dies ist die Beschreibung #arbeit ${LINK}`)).toBe(
      "Dies ist die Beschreibung #arbeit"
    );
    expect(taskTitle("  * [x] done")).toBe("done");
    expect(taskTitle("3. [ ] numbered")).toBe("numbered");
    expect(taskTitle("- [ ] see [[Konto]] and [docs](https://x.y)")).toBe(
      "see [[Konto]] and [docs](https://x.y)"
    );
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
  const lines = [
    "# Backlog",
    `- [ ] Call the bank #money ${LINK}`,
    "    Ask about the fee",
    "- [ ] other"
  ];

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

  it("accepts a task id and refuses anything else", () => {
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
