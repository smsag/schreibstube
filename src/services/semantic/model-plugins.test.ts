import { describe, expect, it } from "vitest";
import { OWN_MODEL_PLUGINS, modelPluginInTheWay } from "./model-plugins";

describe("modelPluginInTheWay", () => {
  it("names the plugin running a model of its own", () => {
    expect(modelPluginInTheWay((id) => id === "similarity")).toBe("Similarity");
  });

  it("is null when none does", () => {
    expect(modelPluginInTheWay(() => false)).toBeNull();
  });

  it("leaves out Pythia, which asks Schreibstube for its model", () => {
    expect(OWN_MODEL_PLUGINS.map((p) => p.id)).not.toContain("pythia");
    expect(modelPluginInTheWay((id) => id === "pythia")).toBeNull();
  });
});
