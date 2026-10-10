import { describe, expect, it } from "vitest";
import { clearDoneTasks, normalizeDoneTaskMode, type DoneTaskMode } from "./done-tasks";

const note = (...lines: string[]): string => lines.join("\n");
const run = (mode: DoneTaskMode, ...lines: string[]) => clearDoneTasks(note(...lines), mode);

describe("normalizeDoneTaskMode", () => {
  it("keeps a known mode and falls back to the back of the list otherwise", () => {
    expect(normalizeDoneTaskMode("archive")).toBe("archive");
    expect(normalizeDoneTaskMode("delete")).toBe("delete");
    expect(normalizeDoneTaskMode("back")).toBe("back");
    expect(normalizeDoneTaskMode("Archive")).toBe("back");
    expect(normalizeDoneTaskMode(undefined)).toBe("back");
    expect(normalizeDoneTaskMode(3)).toBe("back");
  });
});

describe("what counts as finished", () => {
  it("is [x] and [X], and nothing else", () => {
    const result = run(
      "delete",
      "- [x] done",
      "- [X] done too",
      "- [-] cancelled",
      "- [>] deferred",
      "- [!] important",
      "- [ ] open",
      "- plain"
    );
    expect(result.count).toBe(2);
    expect(result.content).toBe(
      note("- [-] cancelled", "- [>] deferred", "- [!] important", "- [ ] open", "- plain")
    );
  });

  it("leaves a cancelled task where it is, in every mode", () => {
    const content = note("- [-] dropped", "- [ ] open");
    for (const mode of ["back", "archive", "delete"] as const) {
      expect(clearDoneTasks(content, mode)).toEqual({ content, count: 0 });
    }
  });

  it("takes a cancelled sub-task along with its done parent", () => {
    const result = run("delete", "- [x] parent", "  - [-] dropped", "- [ ] open");
    expect(result).toEqual({ content: note("- [ ] open"), count: 1 });
  });

  it("is not a ticked task with a sub-task still open, or one marked otherwise", () => {
    const content = note("- [x] parent", "  - [ ] open child", "- [x] other", "  - [?] asked");
    expect(clearDoneTasks(content, "delete")).toEqual({ content, count: 0 });
    expect(clearDoneTasks(content, "archive")).toEqual({ content, count: 0 });
  });

  it("looks through every level for an open sub-task", () => {
    const content = note("- [x] parent", "  - [x] child", "    - [ ] grandchild", "- [ ] last");
    expect(clearDoneTasks(content, "back")).toEqual({ content, count: 0 });
  });

  it("ignores tasks in fenced blocks and in the frontmatter", () => {
    const content = note(
      "---",
      "- [x] not a task",
      "---",
      "```",
      "- [x] code",
      "- [ ] code",
      "```",
      "~~~~",
      "- [x] unclosed"
    );
    expect(clearDoneTasks(content, "delete")).toEqual({ content, count: 0 });
  });

  it("reads a rule as a rule, not as a list", () => {
    const content = note("- [x] done", "- - -", "- [ ] open");
    expect(clearDoneTasks(content, "back")).toEqual({ content, count: 0 });
  });
});

describe("back of the list", () => {
  it("moves finished tasks after the rest of their list, in their order", () => {
    const result = run("back", "# Today", "- [x] a", "- [ ] b", "- [X] c", "- [ ] d", "", "Text");
    expect(result.count).toBe(2);
    expect(result.content).toBe(
      note("# Today", "- [ ] b", "- [ ] d", "- [x] a", "- [X] c", "", "Text")
    );
  });

  it("moves a task with everything indented under it", () => {
    const result = run(
      "back",
      "- [x] a",
      "  A note under a.",
      "  - [x] sub",
      "    ```js",
      "code()",
      "    ```",
      "- [ ] b"
    );
    expect(result.content).toBe(
      note(
        "- [ ] b",
        "- [x] a",
        "  A note under a.",
        "  - [x] sub",
        "    ```js",
        "code()",
        "    ```"
      )
    );
  });

  it("keeps each list to itself", () => {
    const result = run("back", "- [x] a", "- [ ] b", "", "Between", "", "- [x] c", "- [ ] d");
    expect(result.content).toBe(
      note("- [ ] b", "- [x] a", "", "Between", "", "- [ ] d", "- [x] c")
    );
  });

  it("orders a sub-list within its parent, and leaves a finished parent's sub-list alone", () => {
    const result = run(
      "back",
      "- [ ] parent",
      "  - [x] one",
      "  - [ ] two",
      "  Note after the sub-list.",
      "- [x] finished",
      "  - [x] y",
      "  - [-] z",
      "- [ ] last"
    );
    expect(result.count).toBe(2);
    expect(result.content).toBe(
      note(
        "- [ ] parent",
        "  - [ ] two",
        "  - [x] one",
        "  Note after the sub-list.",
        "- [ ] last",
        "- [x] finished",
        "  - [x] y",
        "  - [-] z"
      )
    );
  });

  it("orders the sub-list of a ticked parent that has to stay", () => {
    const result = run("back", "- [x] parent", "  - [x] done", "  - [ ] open");
    expect(result.content).toBe(note("- [x] parent", "  - [ ] open", "  - [x] done"));
  });

  it("does nothing when the finished tasks are already at the back", () => {
    const content = note("- [ ] a", "- [x] b", "- [x] c", "");
    expect(clearDoneTasks(content, "back")).toEqual({ content, count: 0 });
  });

  it("keeps a loose list loose", () => {
    const result = run("back", "- [x] a", "", "- [ ] b", "", "- [ ] c");
    expect(result.content).toBe(note("- [ ] b", "", "- [ ] c", "", "- [x] a"));
  });

  it("renumbers a list that counts, and leaves one that does not", () => {
    expect(run("back", "1. [x] a", "2. [ ] b", "3. [ ] c").content).toBe(
      note("1. [ ] b", "2. [ ] c", "3. [x] a")
    );
    expect(run("back", "3) [x] a", "4) [ ] b").content).toBe(note("3) [ ] b", "4) [x] a"));
    expect(run("back", "1. [x] a", "1. [ ] b").content).toBe(note("1. [ ] b", "1. [x] a"));
  });

  it("treats a tab as four columns", () => {
    const result = run("back", "- [ ] p", "\t- [x] a", "\t- [ ] b");
    expect(result.content).toBe(note("- [ ] p", "\t- [ ] b", "\t- [x] a"));
  });

  it("works under a heading of the archive's own level that follows the archive", () => {
    const result = run("back", "## Archive", "- [x] old", "## Next", "- [x] a", "- [ ] b");
    expect(result.content).toBe(note("## Archive", "- [x] old", "## Next", "- [ ] b", "- [x] a"));
  });
});

describe("delete", () => {
  it("removes finished tasks with everything under them, at every level", () => {
    const result = run(
      "delete",
      "- [ ] keep",
      "  - [x] nested done",
      "    Its note.",
      "  - [ ] nested open",
      "- [x] gone",
      "  Its note.",
      "- [ ] keep too"
    );
    expect(result.count).toBe(2);
    expect(result.content).toBe(note("- [ ] keep", "  - [ ] nested open", "- [ ] keep too"));
  });

  it("leaves one blank line where a whole list was", () => {
    expect(run("delete", "Intro", "", "- [x] a", "- [x] b", "", "Outro", "").content).toBe(
      note("Intro", "", "Outro", "")
    );
  });

  it("leaves no blank lines at the top of the note", () => {
    expect(run("delete", "- [x] a", "", "Text").content).toBe("Text");
  });

  it("keeps the blank line before a note that follows a sub-list", () => {
    const result = run("delete", "- [ ] p", "  - [x] s", "", "  Note.", "- [ ] q");
    expect(result.content).toBe(note("- [ ] p", "", "  Note.", "- [ ] q"));
  });

  it("does not leave a blank line at the end of a task's body", () => {
    const result = run("delete", "- [ ] p", "  Note.", "", "  - [x] s", "- [ ] q");
    expect(result.content).toBe(note("- [ ] p", "  Note.", "- [ ] q"));
  });

  it("keeps the gaps of a loose list that remains", () => {
    expect(run("delete", "- [ ] a", "", "- [x] b", "", "- [ ] c").content).toBe(
      note("- [ ] a", "", "- [ ] c")
    );
  });

  it("does not touch the archive", () => {
    const result = run("delete", "- [x] a", "", "## Archive", "", "- [x] old", "");
    expect(result.content).toBe(note("## Archive", "", "- [x] old", ""));
  });

  it("clears tasks after the archive and keeps the note's end", () => {
    const result = run(
      "delete",
      "## Archive",
      "- [x] old",
      "",
      "## Later",
      "- [x] a",
      "- [ ] b",
      ""
    );
    expect(result.content).toBe(note("## Archive", "- [x] old", "", "## Later", "- [ ] b", ""));
  });
});

describe("archive", () => {
  it("starts an archive at the end of the note", () => {
    const result = run("archive", "# Plan", "", "- [x] a", "  Note.", "- [ ] b", "", "Text", "");
    expect(result.count).toBe(1);
    expect(result.content).toBe(
      note("# Plan", "", "- [ ] b", "", "Text", "", "## Archive", "", "- [x] a", "  Note.", "")
    );
  });

  it("keeps a note without a final newline without one", () => {
    expect(run("archive", "- [x] a", "- [ ] b").content).toBe(
      note("- [ ] b", "", "## Archive", "", "- [x] a")
    );
  });

  it("makes a note of only finished tasks into its archive", () => {
    expect(run("archive", "- [x] a", "").content).toBe(note("## Archive", "", "- [x] a", ""));
  });

  it("adds to the end of the archive's list, wherever the archive is", () => {
    const result = run(
      "archive",
      "- [x] a",
      "- [ ] b",
      "",
      "## Archive",
      "",
      "- [x] old",
      "",
      "## Later",
      "- [X] c",
      ""
    );
    expect(result.count).toBe(2);
    expect(result.content).toBe(
      note("- [ ] b", "", "## Archive", "", "- [x] old", "- [x] a", "- [X] c", "", "## Later", "")
    );
  });

  it("finds the archive at any level and in any case", () => {
    const result = run("archive", "- [x] a", "- [ ] b", "", "### archive ###", "- [x] old");
    expect(result.content).toBe(note("- [ ] b", "", "### archive ###", "- [x] old", "- [x] a"));
  });

  it("keeps a loose archive loose and takes its indentation", () => {
    const result = run(
      "archive",
      "- [x] a",
      "  - [x] sub",
      "## Archive",
      "  - [x] one",
      "",
      "  - [x] two"
    );
    expect(result.content).toBe(
      note("## Archive", "  - [x] one", "", "  - [x] two", "", "  - [x] a", "    - [x] sub")
    );
  });

  it("starts a list under an archive heading that has none", () => {
    expect(run("archive", "- [x] a", "- [ ] b", "## Archive", "Old notes.", "", "").content).toBe(
      note("- [ ] b", "## Archive", "Old notes.", "", "- [x] a", "", "")
    );
    expect(run("archive", "- [x] a", "## Archive", "## Next").content).toBe(
      note("## Archive", "", "- [x] a", "", "## Next")
    );
  });

  it("files a task under the archive list's marker, keeping its text and body", () => {
    expect(run("archive", "1. [x] a", "   Note.", "2. [ ] b").content).toBe(
      note("1. [ ] b", "", "## Archive", "", "- [x] a", "   Note.")
    );
    expect(run("archive", "- [x] a", "## Archive", "* [x] old").content).toBe(
      note("## Archive", "* [x] old", "* [x] a")
    );
    expect(run("archive", "- [x] a", "- [X] b", "## Archive", "4) [x] old").content).toBe(
      note("## Archive", "4) [x] old", "5) [x] a", "6) [X] b")
    );
  });

  it("leaves a finished sub-task with its open parent", () => {
    const content = note("- [ ] parent", "  - [x] child");
    expect(clearDoneTasks(content, "archive")).toEqual({ content, count: 0 });
  });

  it("archives a finished parent with its finished sub-tasks", () => {
    const result = run("archive", "- [x] parent", "  - [x] child", "  Note.", "- [ ] other");
    expect(result.content).toBe(
      note("- [ ] other", "", "## Archive", "", "- [x] parent", "  - [x] child", "  Note.")
    );
  });

  it("leaves a heading inside a fence alone", () => {
    const result = run("archive", "```", "## Archive", "```", "- [x] a");
    expect(result.content).toBe(note("```", "## Archive", "```", "", "## Archive", "", "- [x] a"));
  });
});
