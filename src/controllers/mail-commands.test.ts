import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sending a note whose diagrams go along as pictures.
 *
 * The drawing, the bridge and the dialogue are the platform's; what is tested
 * here is what the send is made of: which pictures, what the text says in
 * their place, and what the dialogue warns about before Send.
 */
const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  health: vi.fn(),
  capture: vi.fn(),
  shown: [] as Record<string, unknown>[]
}));

vi.mock("../services/mail-client", () => ({ sendMail: mocks.sendMail, searchMail: vi.fn() }));
vi.mock("../services/publish-client", () => ({ bridgeHealth: mocks.health }));
vi.mock("./diagram-capture", () => ({
  DiagramCapture: class {
    capture = mocks.capture;
  }
}));
vi.mock("../ui/mail-modals", () => ({
  // Shows the details and presses Send at once, as a person would.
  MailConfirmModal: class {
    constructor(
      _app: unknown,
      details: Record<string, unknown>,
      private readonly onConfirm: () => Promise<boolean>
    ) {
      mocks.shown.push(details);
    }
    update(details: Record<string, unknown>): void {
      mocks.shown.push(details);
    }
    open(): void {
      void this.onConfirm();
    }
  },
  MailResultModal: class {},
  MailSearchModal: class {}
}));

const { Notice } = await import("../testing/obsidian-stub");
const { fakeVault } = await import("../testing/fake-app");

const { MailCommands } = await import("./mail-commands");
const { DEFAULT_SETTINGS, normalizeSettings } = await import("../services/plugin-settings");
const { setLanguage } = await import("../i18n");

setLanguage("en");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const header = ["---", "schreibstubeTo: info@example.de", "schreibstubeSubject: Plan", "---"];
const canvasNote = [...header, "Hallo,", "", "```vizardry", "type: swot", "```"].join("\n");

function commands(content: string) {
  return commandsWith(content).mail;
}

/** The commands over settings a test can change between sends. */
function commandsWith(content: string) {
  const vault = fakeVault({ notes: [{ path: "Plan.md", content }] });
  const file = vault.app.vault.getAbstractFileByPath("Plan.md");
  const app = { ...vault.app, workspace: { getActiveFile: () => file } };
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
  return { mail, settings };
}

async function sent(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(mocks.sendMail).toHaveBeenCalled());
  return mocks.sendMail.mock.calls[0]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  Notice.shown = [];
  mocks.shown.length = 0;

  mocks.sendMail.mockReset();
  mocks.sendMail.mockResolvedValue({
    messageId: "<id@example.de>",
    sentAt: "2026-09-27T12:00:00Z",
    filedInSent: true,
    rejected: []
  });
  mocks.health.mockReset();
  mocks.health.mockResolvedValue({ version: "2.10.0", protocol: 5, capabilities: ["mail"] });
  mocks.capture.mockReset();
  mocks.capture.mockResolvedValue({ pictures: [PNG], expected: 1, title: "SWOT" });
});

describe("sending a note with a diagram", () => {
  it("attaches the drawing and names it where the diagram stood", async () => {
    await commands(canvasNote).sendNoteAsEmail();
    const request = await sent();

    expect(request.text).toBe("Hallo,\n\n[Figure 1: SWOT — attached: figure-1.png]");
    expect(request.attachments).toEqual([
      { filename: "figure-1.png", contentType: "image/png", content: "iVBORw0KGgoB" }
    ]);
    expect(mocks.shown[0]).toMatchObject({ attachments: ["figure-1.png"], warnings: [] });
  });

  it("draws once for the dialogue and the send, not once for each", async () => {
    await commands(canvasNote).sendNoteAsEmail();
    await sent();

    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it("sends the source, and says so first, when the bridge cannot carry pictures", async () => {
    mocks.health.mockResolvedValue({ version: "2.9.0", protocol: 4, capabilities: ["mail"] });

    await commands(canvasNote).sendNoteAsEmail();
    const request = await sent();

    expect(mocks.capture).not.toHaveBeenCalled();
    expect(request).not.toHaveProperty("attachments");
    expect(request.text).toContain("type: swot");
    expect(mocks.shown[0]).toMatchObject({ warnings: ["bridgeTooOld"], undrawn: 1 });
  });

  it("sends the source, and says so first, when the diagram could not be drawn", async () => {
    mocks.capture.mockResolvedValue({ pictures: [], expected: 0, title: "" });

    await commands(canvasNote).sendNoteAsEmail();
    const request = await sent();

    expect(request).not.toHaveProperty("attachments");
    expect(mocks.shown[0]).toMatchObject({ warnings: ["diagramsNotDrawn"], undrawn: 1 });
  });

  it("says the bridge could not be asked, rather than calling it old", async () => {
    mocks.health.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await commands(canvasNote).sendNoteAsEmail();
    const request = await sent();

    expect(request).not.toHaveProperty("attachments");
    expect(mocks.shown[0]).toMatchObject({ warnings: ["diagramsNotDrawn"], undrawn: 1 });
    expect(Notice.shown.join(" ")).toMatch(/could not be asked/);
  });

  it("asks a bridge once per session, and another bridge again", async () => {
    const { mail, settings } = commandsWith(canvasNote);

    await mail.sendNoteAsEmail();
    await sent();
    await mail.sendNoteAsEmail();
    expect(mocks.health).toHaveBeenCalledTimes(1);

    settings.mailBridgeUrl = "https://other.example.app";
    await mail.sendNoteAsEmail();
    expect(mocks.health).toHaveBeenCalledTimes(2);
  });

  it("asks nothing of the bridge for a note without diagrams", async () => {
    await commands([...header, "Hallo"].join("\n")).sendNoteAsEmail();
    const request = await sent();

    expect(mocks.health).not.toHaveBeenCalled();
    expect(request).not.toHaveProperty("attachments");
  });
});
