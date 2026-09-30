import { describe, expect, it } from "vitest";
import { modelPluginInTheWay } from "./model-plugins";

describe("modelPluginInTheWay", () => {
  it("names the plugin running a model of its own", () => {
    expect(modelPluginInTheWay((id) => id === "similarity")).toBe("Similarity");
    expect(modelPluginInTheWay((id) => id === "pythia")).toBe("Pythia");
  });

  it("names Pythia first when both run one", () => {
    expect(modelPluginInTheWay(() => true)).toBe("Pythia");
  });

  it("is null when none does", () => {
    expect(modelPluginInTheWay(() => false)).toBeNull();
  });
});
