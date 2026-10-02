import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_ICONS, commandIcon } from "./command-icons";

const main = readFileSync(join(import.meta.dirname, "..", "main.ts"), "utf8");

/** Every command id `main.ts` registers, plain or gated, but those that name their own icon. */
function registeredIds(): string[] {
  const own = new Set(
    [...main.matchAll(/id:\s*"([^"]+)",\s*name:[^\n]*\n\s*icon:/g)].map((match) => match[1])
  );
  return [
    ...main.matchAll(/this\.addCommand\(\{\s*id:\s*"([^"]+)"/g),
    ...main.matchAll(/this\.addGatedCommand\(\s*"([^"]+)"/g)
  ]
    .map((match) => match[1] ?? "")
    .filter((id) => !own.has(id));
}

describe("command icons", () => {
  it("has an icon for every command the plugin registers", () => {
    const ids = registeredIds();
    expect(ids.length).toBeGreaterThan(30);
    expect(ids.filter((id) => commandIcon(id) === undefined)).toEqual([]);
  });

  it("lists no command that is not registered", () => {
    const ids = new Set(registeredIds());
    expect(Object.keys(COMMAND_ICONS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("answers none for an unknown id, inherited names included", () => {
    expect(commandIcon("nothing")).toBeUndefined();
    expect(commandIcon("toString")).toBeUndefined();
  });
});
