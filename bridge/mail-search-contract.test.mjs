import { describe, expect, it } from "vitest";
import { MAX_EXCLUDE, validateSearch } from "./mail-routes.mjs";
import { PROTOCOL_VERSION } from "./config.mjs";
import {
  excludeFromMerged,
  MAIL_EXCLUDE_PROTOCOL,
  MAX_SEARCH_EXCLUDE
} from "../src/services/mail-protocol.ts";
import { MAX_MERGED_IDS } from "../src/services/mail-frontmatter.ts";

/**
 * A reply fetch names the replies a note holds, and the bridge steps past
 * them: what the plugin sends has to be what the bridge takes, or every fetch
 * from a long thread is refused as a bad request.
 */
describe("the replies a search steps past, plugin and bridge", () => {
  it("share their bound, and the note keeps no more than both take", () => {
    expect(MAX_SEARCH_EXCLUDE).toBe(MAX_EXCLUDE);
    expect(MAX_MERGED_IDS).toBeLessThanOrEqual(MAX_EXCLUDE);
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(MAIL_EXCLUDE_PROTOCOL);
  });

  it("agree on every list a note can hold", () => {
    const held = [
      ...Array.from({ length: MAX_MERGED_IDS + 10 }, (_, i) => `<reply-${i}@kunde.de>`),
      "uid:42",
      // As long as a Message-ID the plugin reads can be, and past a header line.
      `<${"x".repeat(989)}@kunde.de>`
    ];
    expect(held.at(-1)).toHaveLength(1000);
    const exclude = excludeFromMerged(held);
    expect(validateSearch({ criteria: { references: "<a@b.de>" }, exclude })).toBeNull();
  });
});
