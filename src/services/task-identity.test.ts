import { describe, expect, it } from "vitest";
import { anchorFor, matchAnchors, renamedAnchors, similarity } from "./task-identity";
import { tasksInNote, type VaultTask } from "./task-inventory";

function scan(note: string, path = "Plan.md"): VaultTask[] {
  return tasksInNote(path, note);
}

/** The anchors a plan would hold after planning these tasks. */
function anchorsFor(tasks: readonly VaultTask[], keys: readonly string[]) {
  return Object.fromEntries(tasks.map((task, index) => [keys[index]!, anchorFor(task)]));
}

describe("recognising a task again", () => {
  it("binds an untouched task by its hash", () => {
    const tasks = scan("- [ ] Datenschutz klären\n- [ ] Konzept schreiben");
    const anchors = anchorsFor(tasks, ["k-1", "k-2"]);

    const match = matchAnchors(anchors, scan("- [ ] Datenschutz klären\n- [ ] Konzept schreiben"));

    expect(match.lost).toEqual([]);
    expect(match.bound.get("k-1")?.text).toBe("Datenschutz klären");
    expect(match.bound.get("k-2")?.text).toBe("Konzept schreiben");
  });

  it("follows a task that moved up the note", () => {
    const anchors = anchorsFor(scan("- [ ] first\n- [ ] second"), ["k-1", "k-2"]);
    const match = matchAnchors(anchors, scan("- [ ] second\n- [ ] third\n- [ ] first"));

    expect(match.bound.get("k-1")?.line).toBe(2);
    expect(match.bound.get("k-2")?.line).toBe(0);
  });

  it("recognises a small edit", () => {
    const anchors = anchorsFor(scan("- [ ] Datenschutz für #projects/ea48 klären"), ["k-1"]);
    const match = matchAnchors(
      anchors,
      scan("- [ ] Datenschutz-Fragen mit Legal klären #projects/ea48")
    );

    expect(match.lost).toEqual([]);
    expect(match.bound.get("k-1")?.text).toContain("Legal");
  });

  it("recognises a ticked task, since the box is not its wording", () => {
    const anchors = anchorsFor(scan("- [ ] Konzept schreiben"), ["k-1"]);
    const match = matchAnchors(anchors, scan("- [x] Konzept schreiben"));
    expect(match.bound.get("k-1")?.done).toBe(true);
  });

  it("tells two identically worded tasks apart by their position", () => {
    const tasks = scan("- [ ] ping\n- [ ] ping");
    const anchors = anchorsFor(tasks, ["k-1", "k-2"]);

    const match = matchAnchors(anchors, scan("- [ ] ping\n- [ ] ping"));

    expect(match.bound.get("k-1")?.ordinal).toBe(0);
    expect(match.bound.get("k-2")?.ordinal).toBe(1);
  });

  it("follows a task into another note when its wording is unmistakable", () => {
    const anchors = anchorsFor(scan("- [ ] Fährverbindung Kiel–Oslo 1987 prüfen"), ["k-1"]);
    const match = matchAnchors(
      anchors,
      scan("- [ ] Fährverbindung Kiel–Oslo 1987 prüfen", "Recherche.md")
    );
    expect(match.bound.get("k-1")?.path).toBe("Recherche.md");
  });

  it("reports a task that is simply gone", () => {
    const anchors = anchorsFor(scan("- [ ] Datenschutz klären"), ["k-1"]);
    const match = matchAnchors(anchors, scan("- [ ] something else entirely"));

    expect(match.lost).toEqual(["k-1"]);
    expect(match.bound.size).toBe(0);
    expect(match.anchors["k-1"]?.text).toBe("Datenschutz klären");
  });

  it("refuses to choose between two tasks that now read alike", () => {
    const anchors = anchorsFor(scan("- [ ] Kapitel drei kürzen"), ["k-1"]);
    const match = matchAnchors(
      anchors,
      scan("- [ ] Kapitel drei kürzen?\n- [ ] Kapitel drei kürzen!")
    );
    expect(match.lost).toEqual(["k-1"]);
  });

  it("gives each key its own task, never the same one twice", () => {
    const anchors = anchorsFor(scan("- [ ] Kapitel drei kürzen\n- [ ] Kapitel vier kürzen"), [
      "k-1",
      "k-2"
    ]);
    const match = matchAnchors(
      anchors,
      scan("- [ ] Kapitel drei kürzen\n- [ ] Kapitel vier kürzen")
    );
    expect(match.bound.get("k-1")).not.toBe(match.bound.get("k-2"));
  });
});

describe("a note that was renamed", () => {
  it("moves its anchors, and leaves the others alone", () => {
    const anchors = { "k-1": anchorFor(scan("- [ ] a")[0]!) };
    expect(renamedAnchors(anchors, "Plan.md", "Archiv/Plan.md")["k-1"]?.path).toBe(
      "Archiv/Plan.md"
    );
    expect(renamedAnchors(anchors, "Other.md", "Moved.md")["k-1"]?.path).toBe("Plan.md");
  });
});

describe("similarity", () => {
  it("is 1 for the same text and 0 for nothing in common", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "abc")).toBe(0);
    expect(similarity("Konzept schreiben", "xyz")).toBeLessThan(0.2);
  });

  it("ignores case and spacing", () => {
    expect(similarity("Konzept  schreiben", "konzept schreiben")).toBe(1);
  });
});
