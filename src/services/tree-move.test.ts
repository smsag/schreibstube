import { describe, expect, it } from "vitest";
import { isMovePlan, isUnder, planMove, type MoveContext } from "./tree-move";

function context(paths: string[], folders: string[]): MoveContext {
  return { taken: new Set(paths), folders: new Set(folders) };
}

const vault = context(
  [
    "Berufliches",
    "Berufliches/Karriere",
    "Berufliches/Karriere/Briefing.md",
    "Berufliches/Notiz.md",
    "Privates",
    "Privates/Notiz.md",
    "Wurzel.md"
  ],
  ["Berufliches", "Berufliches/Karriere", "Privates"]
);

describe("planMove", () => {
  it("moves a file into a folder", () => {
    const plan = planMove("Wurzel.md", "Privates", vault);

    expect(isMovePlan(plan) && plan.destination).toBe("Privates/Wurzel.md");
  });

  it("moves a file out to the vault root", () => {
    const plan = planMove("Berufliches/Notiz.md", "", vault);

    expect(isMovePlan(plan) && plan.destination).toBe("Notiz.md");
  });

  it("moves a folder into another folder, keeping its name", () => {
    const plan = planMove("Privates", "Berufliches", vault);

    expect(isMovePlan(plan) && plan.destination).toBe("Berufliches/Privates");
  });

  it("refuses a drop back into the folder it already sits in", () => {
    expect(planMove("Berufliches/Notiz.md", "Berufliches", vault)).toBe("same-folder");
  });

  it("refuses a root file dropped on the root", () => {
    expect(planMove("Wurzel.md", "", vault)).toBe("same-folder");
  });

  it("refuses a folder dropped on itself", () => {
    expect(planMove("Berufliches", "Berufliches", vault)).toBe("into-itself");
  });

  it("refuses a folder dropped inside its own subtree", () => {
    expect(planMove("Berufliches", "Berufliches/Karriere", vault)).toBe("into-descendant");
  });

  it("refuses a move onto something that is not a folder", () => {
    expect(planMove("Wurzel.md", "Privates/Notiz.md", vault)).toBe("not-a-folder");
  });

  it("refuses a move that would overwrite a name already there", () => {
    expect(planMove("Berufliches/Notiz.md", "Privates", vault)).toBe("name-taken");
  });

  it("does not mistake a sibling with a shared prefix for a descendant", () => {
    const tricky = context(["Beruf", "Berufliches"], ["Beruf", "Berufliches"]);

    expect(isMovePlan(planMove("Beruf", "Berufliches", tricky))).toBe(true);
  });
});

describe("isUnder", () => {
  it("treats everything as under the vault root", () => {
    expect(isUnder("a.md", "")).toBe(true);
    expect(isUnder("a/b.md", "")).toBe(true);
  });

  it("says the root itself is not under the root", () => {
    expect(isUnder("", "")).toBe(false);
  });

  it("needs a separator, so a shared prefix is not containment", () => {
    expect(isUnder("Berufliches", "Beruf")).toBe(false);
    expect(isUnder("Beruf/x.md", "Beruf")).toBe(true);
  });

  it("says a folder is not under itself", () => {
    expect(isUnder("Beruf", "Beruf")).toBe(false);
  });
});
