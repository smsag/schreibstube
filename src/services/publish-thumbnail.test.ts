import { describe, expect, it } from "vitest";
import { isSendableThumbnail, MAX_THUMBNAIL_BYTES, thumbnailType } from "./publish-thumbnail";

describe("thumbnailType", () => {
  it("keeps a PNG a PNG, for its transparency", () => {
    expect(thumbnailType("plan.png")).toBe("image/png");
  });

  it("makes a JPEG of a photograph, whatever it was", () => {
    expect(thumbnailType("Haus.JPG")).toBe("image/jpeg");
    expect(thumbnailType("haus.webp")).toBe("image/jpeg");
  });

  it("makes none of a drawing, an animation or a video", () => {
    expect(thumbnailType("plan.svg")).toBeNull();
    expect(thumbnailType("tanz.gif")).toBeNull();
    expect(thumbnailType("clip.mp4")).toBeNull();
    expect(thumbnailType("ohne-endung")).toBeNull();
  });
});

describe("isSendableThumbnail", () => {
  it("sends one within the bridge's limit, and neither an empty nor a larger one", () => {
    expect(isSendableThumbnail(20_000)).toBe(true);
    expect(isSendableThumbnail(MAX_THUMBNAIL_BYTES)).toBe(true);
    expect(isSendableThumbnail(MAX_THUMBNAIL_BYTES + 1)).toBe(false);
    expect(isSendableThumbnail(0)).toBe(false);
  });
});
