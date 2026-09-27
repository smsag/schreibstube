import { describe, expect, it } from "vitest";
import { BridgeError } from "./bridge-protocol";
import { buildMailDraft, isUnconfirmedSend, sameDraft, sendWarnings } from "./mail-draft";

const frontmatter = {
  schreibstubeTo: "info@hv.example.de",
  schreibstubeCc: ["cc@example.de"],
  schreibstubeSubject: "Fristsetzung"
};

describe("buildMailDraft", () => {
  it("takes recipients and subject from the frontmatter and the body as plain text", () => {
    const draft = buildMailDraft(frontmatter, "**1. Wasserschaden**", "");
    expect(draft.fields.to).toEqual(["info@hv.example.de"]);
    expect(draft.fields.cc).toEqual(["cc@example.de"]);
    expect(draft.body).toBe("1. Wasserschaden");
  });

  it("prefers the note's sender to the setting's", () => {
    const own = { ...frontmatter, schreibstubeFrom: "Büro <b@x.de>" };
    expect(buildMailDraft(own, "x", "Ich <i@x.de>").from).toBe("Büro <b@x.de>");
    expect(buildMailDraft(frontmatter, "x", " Ich <i@x.de> ").from).toBe("Ich <i@x.de>");
    expect(buildMailDraft(frontmatter, "x", "").from).toBe("");
  });
});

describe("sameDraft", () => {
  const shown = buildMailDraft(frontmatter, "Text", "");

  it("agrees with a draft read from the same note", () => {
    expect(sameDraft(shown, buildMailDraft({ ...frontmatter }, "Text", ""))).toBe(true);
  });

  it("notices a recipient that arrived after the dialogue opened", () => {
    const before = buildMailDraft({ ...frontmatter, schreibstubeTo: undefined }, "Text", "");
    expect(sameDraft(before, shown)).toBe(false);
  });

  it("notices a changed body, subject or sender", () => {
    expect(sameDraft(shown, buildMailDraft(frontmatter, "Text!", ""))).toBe(false);
    expect(
      sameDraft(shown, buildMailDraft({ ...frontmatter, schreibstubeSubject: "Neu" }, "Text", ""))
    ).toBe(false);
    expect(sameDraft(shown, buildMailDraft(frontmatter, "Text", "a@x.de"))).toBe(false);
  });

  it("notices that the note was sent from another dialogue meanwhile", () => {
    const sent = { ...frontmatter, schreibstubeMessageId: "<1@x.de>" };
    expect(sameDraft(shown, buildMailDraft(sent, "Text", ""))).toBe(false);
  });
});

describe("sendWarnings", () => {
  const fields = buildMailDraft(frontmatter, "x", "").fields;

  it("has nothing to say about a complete, unsent note", () => {
    expect(sendWarnings(fields)).toEqual([]);
  });

  it("warns about a note with only a Cc", () => {
    expect(sendWarnings({ ...fields, to: [] })).toEqual(["noTo"]);
  });

  it("warns about a note sent before, and one whose last send is unknown, first", () => {
    expect(
      sendWarnings({ ...fields, messageId: "<1@x.de>", unconfirmedAt: "2026-09-25T08:35:00Z" })
    ).toEqual(["unconfirmed", "alreadySent"]);
  });
});

describe("isUnconfirmedSend", () => {
  it("counts a refusal the bridge answered as a failure", () => {
    expect(isUnconfirmedSend(new BridgeError("Send failed", 502, "upstream_error"))).toBe(false);
    expect(isUnconfirmedSend(new BridgeError("bad", 400, "invalid_request"))).toBe(false);
  });

  it("counts a deadline the bridge ran out of as unknown", () => {
    expect(isUnconfirmedSend(new BridgeError("x", 504, "send_unconfirmed"))).toBe(true);
    expect(isUnconfirmedSend(new BridgeError("x", 504, ""))).toBe(true);
  });

  it("counts the plugin's own deadline and a dropped connection as unknown", () => {
    expect(isUnconfirmedSend(new Error("bridge did not respond within 60s."))).toBe(true);
    expect(isUnconfirmedSend(new Error("net::ERR_CONNECTION_RESET"))).toBe(true);
  });
});
