import { describe, expect, it } from "vitest";
import { registeredCommands } from "./workspace-internals";

function appWith(commands: unknown): never {
  return { commands: { commands } } as never;
}

describe("registeredCommands", () => {
  it("reads each command's id and icon", () => {
    const app = appWith({
      "pythia:open": { id: "pythia:open", name: "Open", icon: "pythia-logo" },
      "editor:save": { id: "editor:save", name: "Save" }
    });

    expect(registeredCommands(app)).toEqual([
      { id: "pythia:open", icon: "pythia-logo" },
      { id: "editor:save", icon: undefined }
    ]);
  });

  it("skips an entry that is not a command", () => {
    const app = appWith({ a: null, b: "text", c: { name: "no id" }, d: { id: "d:ok" } });

    expect(registeredCommands(app)).toEqual([{ id: "d:ok", icon: undefined }]);
  });

  it("is empty when the registry is missing or not the shape expected", () => {
    expect(registeredCommands({} as never)).toEqual([]);
    expect(registeredCommands(appWith(undefined))).toEqual([]);
    expect(registeredCommands(appWith("nope"))).toEqual([]);
  });

  it("is empty rather than throwing when reading the registry throws", () => {
    const app = {
      get commands(): never {
        throw new Error("moved");
      }
    } as never;

    expect(registeredCommands(app)).toEqual([]);
  });
});
