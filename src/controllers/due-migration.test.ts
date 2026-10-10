import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { fakeVault } from "../testing/fake-app";
import { createLogger } from "../services/logger";
import { DueMigration } from "./due-migration";

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function setup(property = "Zieldatum") {
  const vault = fakeVault({
    notes: [
      { path: "move.md", content: "", frontmatter: { schreibstubeDue: "2026-10-12", title: "A" } },
      {
        path: "same.md",
        content: "",
        frontmatter: { schreibstubeDue: "2026-10-12", Zieldatum: "2026-10-12" }
      },
      {
        path: "clash.md",
        content: "",
        frontmatter: { schreibstubeDue: "2026-10-12", Zieldatum: "2026-10-20" }
      },
      { path: "new.md", content: "", frontmatter: { Zieldatum: "2026-11-01" } },
      { path: "none.md", content: "" }
    ]
  });
  const settings = { property };
  const migration = new DueMigration(
    vault.app as unknown as App,
    () => settings.property,
    createLogger(() => false),
    utc
  );
  return { vault, migration, settings };
}

describe("DueMigration", () => {
  it("counts from the metadata without writing", () => {
    const { vault, migration } = setup();
    const write = vi.spyOn(vault.app.fileManager, "processFrontMatter");
    expect(migration.count()).toEqual({ move: 1, drop: 1, conflict: 1, conflicts: ["clash.md"] });
    expect(write).not.toHaveBeenCalled();
  });

  it("finds nothing to move while the property is schreibstubeDue", () => {
    const { migration } = setup("schreibstubeDue");
    expect(migration.count()).toEqual({ move: 0, drop: 0, conflict: 0, conflicts: [] });
  });

  it("moves and drops, leaves a conflict untouched and unwritten", async () => {
    const { vault, migration } = setup();
    const write = vi.spyOn(vault.app.fileManager, "processFrontMatter");

    const result = await migration.run();

    expect(result).toEqual({
      tally: { move: 1, drop: 1, conflict: 1, conflicts: ["clash.md"] },
      failed: 0
    });
    expect(vault.frontmatterOf("move.md")).toEqual({ Zieldatum: "2026-10-12", title: "A" });
    expect(vault.frontmatterOf("same.md")).toEqual({ Zieldatum: "2026-10-12" });
    expect(vault.frontmatterOf("clash.md")).toEqual({
      schreibstubeDue: "2026-10-12",
      Zieldatum: "2026-10-20"
    });
    expect(write.mock.calls.map(([file]) => file.path).sort()).toEqual(["move.md", "same.md"]);
    expect(migration.count()).toEqual({ move: 0, drop: 0, conflict: 1, conflicts: ["clash.md"] });
  });

  it("counts a note it could not write and carries on", async () => {
    const { vault, migration } = setup();
    const real = vault.app.fileManager.processFrontMatter;
    vi.spyOn(vault.app.fileManager, "processFrontMatter").mockImplementation((file, apply) =>
      file.path === "move.md" ? Promise.reject(new Error("locked")) : real(file, apply)
    );

    const result = await migration.run();

    expect(result.failed).toBe(1);
    expect(result.tally).toMatchObject({ move: 0, drop: 1 });
    expect(vault.frontmatterOf("move.md")).toEqual({ schreibstubeDue: "2026-10-12", title: "A" });
  });
});
