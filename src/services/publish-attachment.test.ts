import { describe, expect, it } from "vitest";
import { MAX_PUBLISH_ATTACHMENT_BYTES, isReadableAttachment } from "./publish-attachment";

describe("isReadableAttachment", () => {
  it("takes a file up to the bound and refuses one byte beyond it", () => {
    expect(isReadableAttachment(0)).toBe(true);
    expect(isReadableAttachment(MAX_PUBLISH_ATTACHMENT_BYTES)).toBe(true);
    expect(isReadableAttachment(MAX_PUBLISH_ATTACHMENT_BYTES + 1)).toBe(false);
  });
});
