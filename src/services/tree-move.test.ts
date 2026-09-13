import { describe, expect, it } from "vitest";
import { setLanguage } from "../i18n";
import {
  ancestorsOf,
  isMovePlan,
  isUnder,
  moveDestinations,
  moveRefusalMessage,
  planMove,
  type MoveContext
} from "./tree-move";

setLanguage("en");

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

describe("moveDestinations", () => {
  it("offers the vault root first, then the folders in order", () => {
    expect(moveDestinations("Berufliches/Karriere/Briefing.md", vault)).toEqual([
      "",
      "Berufliches",
      "Privates"
    ]);
  });

  it("leaves out the folder the item already sits in", () => {
    expect(moveDestinations("Privates/Notiz.md", vault)).not.toContain("Privates");
  });

  it("leaves out the root for something already sitting at the root", () => {
    expect(moveDestinations("Wurzel.md", vault)).not.toContain("");
    expect(moveDestinations("Privates/Notiz.md", vault)).toContain("");
  });

  it("leaves out a folder that already holds that name", () => {
    // "Berufliches/Notiz.md" would collide with "Privates/Notiz.md".
    expect(moveDestinations("Berufliches/Notiz.md", vault)).not.toContain("Privates");
  });

  it("leaves out a folder's own subtree, and the folder itself", () => {
    const destinations = moveDestinations("Berufliches", vault);

    expect(destinations).not.toContain("Berufliches");
    expect(destinations).not.toContain("Berufliches/Karriere");
    expect(destinations).toContain("Privates");
  });

  it("offers nothing when there is nowhere left to go", () => {
    const only = context(["Privates", "Privates/Notiz.md"], ["Privates"]);

    expect(moveDestinations("Privates", only)).toEqual([]);
  });
});

describe("moveRefusalMessage", () => {
  it("says the same thing for a folder dropped in itself or under itself", () => {
    const inside = moveRefusalMessage("into-itself", "Objekte");

    expect(moveRefusalMessage("into-descendant", "Objekte")).toBe(inside);
    expect(inside).toContain("Objekte");
  });

  it("names the collision when something is already there", () => {
    expect(moveRefusalMessage("name-taken", "Haus.md")).toContain("Haus.md");
  });

  it("falls back to a plain refusal for everything else", () => {
    expect(moveRefusalMessage("not-a-folder", "Haus.md")).toContain("Haus.md");
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

describe("ancestorsOf", () => {
  it("lists the folders above a file, outermost first", () => {
    expect(ancestorsOf("Berufliches/Karriere/Briefing.md")).toEqual([
      "Berufliches",
      "Berufliches/Karriere"
    ]);
  });

  it("gives nothing for something at the vault root", () => {
    expect(ancestorsOf("Wurzel.md")).toEqual([]);
  });

  it("leaves out the path's own segment, so revealing a folder opens its parents", () => {
    expect(ancestorsOf("Berufliches/Karriere")).toEqual(["Berufliches"]);
  });
});
