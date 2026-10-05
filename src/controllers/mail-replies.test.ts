import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fetching replies into the note that started a thread: what the search asks
 * the bridge to step past, what the note keeps of it, and what the person is
 * told when the bridge left older replies behind. The bridge is a fake; the
 * decisions are the controller's.
 */
const mocks = vi.hoisted(() => ({
  searchMail: vi.fn(),
  health: vi.fn()
}));

vi.mock("../platform/mail-client", () => ({
  sendMail: vi.fn(),
  searchMail: mocks.searchMail,
  fetchAttachments: vi.fn()
}));
vi.mock("../platform/publish-client", () => ({ bridgeHealth: mocks.health }));
vi.mock("./diagram-capture", () => ({ DiagramCapture: class {} }));
vi.mock("../ui/mail-modals", () => ({
  MailConfirmModal: class {},
  MailSearchModal: class {},
  MailResultModal: class {}
}));

const { Notice } = await import("../testing/obsidian-stub");
const { fakeVault } = await import("../testing/fake-app");
const { MailCommands } = await import("./mail-commands");
const { DEFAULT_SETTINGS, normalizeSettings } = await import("../services/plugin-settings");
const { MAX_MERGED_IDS } = await import("../services/mail-frontmatter");
const { setLanguage } = await import("../i18n");

setLanguage("en");

const SENT = "<7f3a@example.de>";

function reply(uid: number) {
  return {
    uid,
    messageId: `<reply-${uid}@kunde.de>`,
    inReplyTo: SENT,
    references: [SENT],
    from: "kunde@kunde.de",
    to: "post@example.de",
    subject: "AW: Angebot",
    date: "2026-09-28T13:18:25.000Z",
    text: "Danke.",
    truncated: false
  };
}

function setup(frontmatter: Record<string, unknown>) {
  const vault = fakeVault({
    notes: [{ path: "Angebot.md", content: "Text\n", frontmatter }]
  });
  const file = vault.file("Angebot.md");
  const written: string[] = [];
  const app = {
    ...vault.app,
    vault: {
      ...vault.app.vault,
      process: async (_file: unknown, apply: (data: string) => string) => {
        written.push(apply("Text\n"));
      }
    },
    workspace: { getActiveFile: () => file }
  };
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    mailBridgeUrl: "https://bridge.example.app",
    mailTokenSecretName: "mail-token"
  });
  const mail = new MailCommands(app as never, () => settings, {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
  } as never);
  return { mail, written, frontmatter: () => vault.frontmatterOf("Angebot.md") };
}

beforeEach(() => {
  Notice.shown = [];
  mocks.searchMail.mockReset();
  mocks.health.mockReset();
  mocks.health.mockResolvedValue({ version: "", protocol: 8, capabilities: [] });
});

describe("fetching replies", () => {
  it("asks the bridge to step past the replies the note already holds", async () => {
    mocks.searchMail.mockResolvedValue({
      messages: [reply(3)],
      mailbox: "INBOX",
      truncated: false
    });
    const { mail } = setup({
      schreibstubeMessageId: SENT,
      schreibstubeMergedIds: ["<reply-1@kunde.de>", "uid:2", "nicht eine Kennung"]
    });

    await mail.fetchReplies();

    const request = mocks.searchMail.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(request.criteria).toEqual({ references: SENT });
    expect(request.exclude).toEqual(["<reply-1@kunde.de>", "uid:2"]);
  });

  it("sends no list when the note holds no reply yet, as an older bridge expects", async () => {
    mocks.searchMail.mockResolvedValue({ messages: [], mailbox: "INBOX", truncated: false });
    const { mail } = setup({ schreibstubeMessageId: SENT });

    await mail.fetchReplies();

    expect(mocks.searchMail.mock.calls[0]?.[1]).not.toHaveProperty("exclude");
  });

  it("does not search at all with a stored Message-ID that would match every reply", async () => {
    const { mail } = setup({ schreibstubeMessageId: "<" });

    await mail.fetchReplies();

    expect(mocks.searchMail).not.toHaveBeenCalled();
    expect(Notice.shown.join(" ")).toMatch(/schreibstubeMessageId/);
  });

  it("keeps no more merged keys than its bound, the newest", async () => {
    const held = Array.from({ length: MAX_MERGED_IDS }, (_, i) => `<old-${i}@kunde.de>`);
    mocks.searchMail.mockResolvedValue({
      messages: [reply(1), reply(2)],
      mailbox: "INBOX",
      truncated: false
    });
    const { mail, frontmatter } = setup({
      schreibstubeMessageId: SENT,
      schreibstubeMergedIds: held
    });

    await mail.fetchReplies();

    const kept = frontmatter().schreibstubeMergedIds as string[];
    expect(kept).toHaveLength(MAX_MERGED_IDS);
    expect(kept.slice(-2)).toEqual(["<reply-1@kunde.de>", "<reply-2@kunde.de>"]);
    expect(kept[0]).toBe("<old-2@kunde.de>");
  });

  it("says when older replies were left behind, and that fetching again reaches them", async () => {
    mocks.searchMail.mockResolvedValue({ messages: [reply(9)], mailbox: "INBOX", truncated: true });
    const { mail, written } = setup({ schreibstubeMessageId: SENT });

    await mail.fetchReplies();

    expect(written).toHaveLength(1);
    expect(Notice.shown.join(" ")).toMatch(/older ones were left behind\. Run "Fetch replies/);
  });

  it("says an older bridge has to be updated, since it answers the same replies every time", async () => {
    mocks.health.mockResolvedValue({ version: "2.13.2", protocol: 7, capabilities: ["mail"] });
    mocks.searchMail.mockResolvedValue({ messages: [], mailbox: "INBOX", truncated: true });
    const { mail } = setup({ schreibstubeMessageId: SENT });

    await mail.fetchReplies();

    expect(Notice.shown.join(" ")).toMatch(/Update the bridge/);
    expect(Notice.shown.join(" ")).toMatch(/no new replies/);
  });

  it("says nothing about older replies when there are none", async () => {
    mocks.searchMail.mockResolvedValue({
      messages: [reply(1)],
      mailbox: "INBOX",
      truncated: false
    });
    const { mail } = setup({ schreibstubeMessageId: SENT });

    await mail.fetchReplies();

    expect(Notice.shown.join(" ")).not.toMatch(/left behind|Update the bridge/);
    expect(mocks.health).not.toHaveBeenCalled();
  });
});
