import { describe, expect, it } from "vitest";
import { EMBEDDING_MODELS, SIMILARITY_PRESETS } from "./embedding-models";

describe("the measured floors", () => {
  it("are the family's on a variant, which makes the same vectors", () => {
    for (const model of Object.values(EMBEDDING_MODELS)) {
      if (!model.variantOf) continue;
      const family = EMBEDDING_MODELS[model.variantOf];
      expect(model.relatedFloors).toEqual(family.relatedFloors);
      expect(model.conversationFloors).toEqual(family.conversationFloors);
    }
  });

  it("never ask more of a conversation beside a note than of one conversation beside another", () => {
    for (const model of Object.values(EMBEDDING_MODELS)) {
      for (const preset of SIMILARITY_PRESETS) {
        expect(model.conversationFloors[preset]).toBeLessThanOrEqual(model.relatedFloors[preset]);
      }
    }
  });

  it("rise from loose to strict", () => {
    for (const model of Object.values(EMBEDDING_MODELS)) {
      const { loose, balanced, strict } = model.conversationFloors;
      expect(loose).toBeLessThan(balanced);
      expect(balanced).toBeLessThan(strict);
    }
  });
});
