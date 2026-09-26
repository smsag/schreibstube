import { describe, expect, it } from "vitest";
import { chooseSentMailbox, FALLBACK_SENT_MAILBOX } from "./sent-mailbox.mjs";

/**
 * Where a sent copy is filed, decided from `SENT_MAILBOX` and the server's
 * answers. The entries mirror imapflow's LIST output, which is all the module
 * reads.
 */

const tagged = (path, extra = {}) => ({
  path,
  specialUse: "\\Sent",
  specialUseSource: "extension",
  flags: new Set(["\\HasNoChildren", "\\Sent"]),
  ...extra
});
const plain = (path) => ({ path, flags: new Set(["\\HasNoChildren"]) });

describe("chooseSentMailbox, the operator's setting", () => {
  it("files where SENT_MAILBOX says, over the server's own tag", () => {
    expect(
      chooseSentMailbox({ configured: "Archiv/Ausgang", mailboxes: [tagged("Sent Items")] })
    ).toEqual({ mailbox: "Archiv/Ausgang", filedByServer: false });
  });

  it("files nowhere when SENT_MAILBOX is empty, even on a server that tags one", () => {
    expect(chooseSentMailbox({ configured: "", mailboxes: [tagged("Sent Items")] })).toEqual({
      mailbox: null,
      filedByServer: false
    });
  });

  it("keeps an explicit name on Gmail too, since the operator asked for it", () => {
    expect(chooseSentMailbox({ configured: "Kopien", capabilities: ["X-GM-EXT-1"] }).mailbox).toBe(
      "Kopien"
    );
  });
});

describe("chooseSentMailbox, unset", () => {
  it("files in the folder the server tags as Sent, whatever it is called", () => {
    expect(
      chooseSentMailbox({ mailboxes: [plain("INBOX"), tagged("Sent Items"), plain("Spam")] })
    ).toEqual({ mailbox: "Sent Items", filedByServer: false });
  });

  it("keeps the server's path as it is, delimiter and all", () => {
    expect(chooseSentMailbox({ mailboxes: [tagged("INBOX.Gesendet")] }).mailbox).toBe(
      "INBOX.Gesendet"
    );
  });

  it("does not trust imapflow's guess from a name, only the server's tag", () => {
    const guessed = tagged("Gesendet", { specialUseSource: "name" });
    expect(chooseSentMailbox({ mailboxes: [guessed] }).mailbox).toBe(FALLBACK_SENT_MAILBOX);
  });

  it("skips a tagged folder that cannot hold a message", () => {
    const hollow = tagged("Sent", { flags: new Set(["\\Noselect", "\\Sent"]) });
    const gone = tagged("Old Sent", { flags: ["\\NonExistent"] });
    expect(chooseSentMailbox({ mailboxes: [hollow, gone, tagged("Sent Items")] }).mailbox).toBe(
      "Sent Items"
    );
  });

  it("falls back to Sent on a server that tags nothing, as before", () => {
    expect(chooseSentMailbox({ mailboxes: [plain("INBOX"), plain("Gesendet")] })).toEqual({
      mailbox: FALLBACK_SENT_MAILBOX,
      filedByServer: false
    });
    expect(chooseSentMailbox()).toEqual({ mailbox: "Sent", filedByServer: false });
  });

  it("ignores entries that are not folders at all", () => {
    expect(
      chooseSentMailbox({ mailboxes: [null, { specialUse: "\\Sent" }, tagged("")] }).mailbox
    ).toBe(FALLBACK_SENT_MAILBOX);
  });

  it("files nothing on Gmail, which keeps its own copy, and says the copy exists", () => {
    expect(
      chooseSentMailbox({
        mailboxes: [tagged("[Gmail]/Sent Mail")],
        capabilities: ["IMAP4REV1", "x-gm-ext-1"]
      })
    ).toEqual({ mailbox: null, filedByServer: true });
  });
});
