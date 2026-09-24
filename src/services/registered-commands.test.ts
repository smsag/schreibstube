import { describe, expect, it } from "vitest";
import { registeredCommands, registeredRibbonItems } from "./workspace-internals";

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

describe("registeredRibbonItems", () => {
  function appWithRibbon(items: unknown): never {
    return { workspace: { leftRibbon: { items } } } as never;
  }

  it("reads each button's id and icon, hidden ones included", () => {
    const app = appWithRibbon([
      { id: "pythia:Pythia", icon: "pythia-logo", title: "Pythia", hidden: false },
      { id: "graph:Open graph view", icon: "lucide-git-fork", title: "Graph", hidden: true }
    ]);

    expect(registeredRibbonItems(app)).toEqual([
      { id: "pythia:Pythia", icon: "pythia-logo" },
      { id: "graph:Open graph view", icon: "lucide-git-fork" }
    ]);
  });

  it("skips an entry that is not a button", () => {
    const app = appWithRibbon([null, "text", { icon: "no-id" }, { id: "d:Ok" }]);

    expect(registeredRibbonItems(app)).toEqual([{ id: "d:Ok", icon: undefined }]);
  });

  it("is empty when the ribbon is missing or not the shape expected", () => {
    expect(registeredRibbonItems({ workspace: {} } as never)).toEqual([]);
    expect(registeredRibbonItems(appWithRibbon({ not: "a list" }))).toEqual([]);
  });

  it("is empty rather than throwing when reading the ribbon throws", () => {
    const app = {
      get workspace(): never {
        throw new Error("moved");
      }
    } as never;

    expect(registeredRibbonItems(app)).toEqual([]);
  });
});
