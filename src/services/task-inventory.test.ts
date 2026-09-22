import { describe, expect, it } from "vitest";
import {
  hasTag,
  legacyReminderLine,
  noteName,
  withBoxDone,
  projectTags,
  tagsIn,
  taskHash,
  tasksForTag,
  tasksInNote,
  taskText,
  MAX_TASK_TEXT
} from "./task-inventory";

const NOTE = [
  "# Plan",
  "- [ ] Datenschutz für #projects/ea48 klären",
  "- [x] Konzept #projects/ea48 fertigstellen 📅 2026-09-25",
  "- [ ] Lektorat #projects/lex, Rückfragen",
  "Not a task",
  "  - [ ] Datenschutz für #projects/ea48 klären"
].join("\n");

describe("the tasks in a note", () => {
  it("reads text, tags, a date if there is one, and completion", () => {
    const tasks = tasksInNote("Plan.md", NOTE);

    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({
      path: "Plan.md",
      line: 1,
      text: "Datenschutz für #projects/ea48 klären",
      tags: ["projects/ea48"],
      due: null,
      done: false,
      ordinal: 0
    });
    expect(tasks[1]).toMatchObject({ due: "2026-09-25", done: true });
  });

  it("numbers identically worded tasks so they can be told apart", () => {
    const tasks = tasksInNote("Plan.md", NOTE);
    expect(tasks[0]?.hash).toBe(tasks[3]?.hash);
    expect(tasks[3]?.ordinal).toBe(1);
  });

  it("hashes the wording, ignoring case and spacing", () => {
    expect(taskHash("Call   the Bank")).toBe(taskHash("call the bank"));
    expect(taskHash("call the bank")).not.toBe(taskHash("call the baker"));
  });

  it("strips the box, dates and a block id, and keeps the tags", () => {
    expect(taskText("- [x] Call #money 📅 2026-09-20 ✅ 2026-09-21 ^r-abc123")).toBe("Call #money");
    expect(taskText(`- [ ] ${"a".repeat(800)}`)).toHaveLength(MAX_TASK_TEXT);
  });

  it("leaves out the link versions up to 1.35 put on a sent task", () => {
    const sent = taskText("- [ ] Call #money [⏰](obsidian://schreibstube?task=ab12cd)");
    expect(sent).toBe("Call #money");
    expect(taskHash(sent)).toBe(taskHash(taskText("- [ ] Call #money")));
  });

  it("ticks an open box, reopens an x, and leaves any other marker alone", () => {
    expect(withBoxDone("- [ ] a", true)).toBe("- [x] a");
    expect(withBoxDone("  1. [X] a", false)).toBe("  1. [ ] a");
    expect(withBoxDone("- [-] cancelled", false)).toBe("- [-] cancelled");
    expect(withBoxDone("- [>] deferred", true)).toBe("- [>] deferred");
    expect(withBoxDone("not a task", true)).toBe("not a task");
  });

  it("finds the line a reminder made by 1.35 still points at", () => {
    const note = "intro\n- [ ] a [⏰](obsidian://schreibstube?task=ab12cd)\n- [ ] b";
    expect(legacyReminderLine(note, "ab12cd")).toBe(1);
    expect(legacyReminderLine(note, "zz99zz")).toBeNull();
  });

  it("names a note the way a person does", () => {
    expect(noteName("Projekte/EA48/Plan.md")).toBe("Plan");
    expect(noteName("Plan")).toBe("Plan");
  });

  it("reads a tag once, and not one glued to a word", () => {
    expect(tagsIn("- [ ] a #one #one/two x#three")).toEqual(["one", "one/two"]);
  });
});

describe("tags and projects", () => {
  it("matches a tag and anything nested under it", () => {
    const [task] = tasksInNote("Plan.md", "- [ ] x #projects/ea48/design");
    expect(hasTag(task!, "projects/ea48")).toBe(true);
    expect(hasTag(task!, "projects/ea")).toBe(false);
  });

  it("lists the tags under the prefix with what is open, busiest first", () => {
    expect(projectTags(tasksInNote("Plan.md", NOTE), "projects")).toEqual([
      { tag: "projects/ea48", open: 2, total: 3 },
      { tag: "projects/lex", open: 1, total: 1 }
    ]);
  });

  it("treats every tag as a project when no prefix is set", () => {
    const tasks = tasksInNote("Plan.md", "- [ ] x #lektorat");
    expect(projectTags(tasks, "")).toEqual([{ tag: "lektorat", open: 1, total: 1 }]);
    expect(projectTags(tasks, "projects")).toEqual([]);
  });

  it("offers the open tasks of a project, the dated ones first", () => {
    const note = [
      "- [ ] undated #p",
      "- [ ] later #p 📅 2026-10-01",
      "- [x] done #p",
      "- [ ] sooner #p 📅 2026-09-20"
    ].join("\n");

    expect(tasksForTag(tasksInNote("P.md", note), "p").map((task) => task.text)).toEqual([
      "sooner #p",
      "later #p",
      "undated #p"
    ]);
  });
});
