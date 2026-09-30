import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Importing a mail with its files: the search dialogue's box ticked, a mail
 * chosen, and what lands in the vault and in the note. The bridge, the
 * dialogues and the vault are fakes; the decisions are the controller's.
 */
const mocks = vi.hoisted(() => ({
  searchMail: vi.fn(),
  fetchAttachments: vi.fn(),
  health: vi.fn(),
  withAttachments: true
}));

vi.mock("../platform/mail-client", () => ({
  sendMail: vi.fn(),
  searchMail: mocks.searchMail,
  fetchAttachments: mocks.fetchAttachments
}));
vi.mock("../platform/publish-client", () => ({ bridgeHealth: mocks.health }));
vi.mock("./diagram-capture", () => ({ DiagramCapture: class {} }));
vi.mock("../ui/mail-modals", () => ({
  MailConfirmModal: class {},
  // Fills in a date, ticks the box as the test says, and presses Search.
  MailSearchModal: class {
    constructor(
      _app: unknown,
      _mailbox: string,
      private readonly onSubmit: (criteria: unknown, options: unknown) => void
    ) {}
    open(): void {
      this.onSubmit({ since: "2026-09-25" }, { withAttachments: mocks.withAttachments });
    }
  },
  // Chooses the first mail found, after the search has finished, as a person does.
  MailResultModal: class {
    constructor(
      _app: unknown,
      private readonly messages: unknown[],
      private readonly onChoose: (message: unknown) => void
    ) {}
    open(): void {
      setTimeout(() => this.onChoose(this.messages[0]), 0);
    }
  }
}));

const { Notice, TFile } = await import("../testing/obsidian-stub");
const { MailCommands } = await import("./mail-commands");
const { DEFAULT_SETTINGS, normalizeSettings } = await import("../services/plugin-settings");
const { setLanguage } = await import("../i18n");

setLanguage("en");

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const REPLY = {
  uid: 246544,
  messageId: "<033501dd@nascor-hausverwaltung.de>",
  inReplyTo: null,
  references: [],
  from: "info@nascor-hausverwaltung.de",
  to: "steffen@smsag.de",
  subject: "AW: Fristsetzung",
  date: "2026-09-28T13:18:25.000Z",
  text: "Sehr geehrter Herr Seitz,",
  truncated: false
};

/** A vault with an attachment folder, one open note and an editor on it. */
function setup({ existing = [] as { path: string; bytes: Uint8Array }[] } = {}) {
  const files = new Map<string, InstanceType<typeof TFile>>();
  const bytes = new Map<string, Uint8Array>();
  const folders = new Set<string>();
  const inserted: string[] = [];
  const store = (path: string, content: Uint8Array) => {
    const file = new TFile(path);
    file.stat.size = content.length;
    files.set(path, file);
    bytes.set(path, content);
    return file;
  };
  for (const entry of existing) {
    store(entry.path, entry.bytes);
    folders.add(entry.path.slice(0, entry.path.lastIndexOf("/")));
  }

  const note = new TFile("Wohnung/Hausverwaltung.md");
  const view = {
    file: note as InstanceType<typeof TFile> | null,
    editor: { replaceSelection: (text: string) => inserted.push(text) }
  };

  const app = {
    workspace: {
      getActiveFile: () => view.file,
      getActiveViewOfType: () => view
    },
    vault: {
      getAbstractFileByPath: (path: string) =>
        files.get(path) ?? (folders.has(path) ? { path } : null),
      createFolder: async (path: string) => {
        folders.add(path);
      },
      createBinary: async (path: string, data: ArrayBuffer) => {
        if (!folders.has(path.slice(0, path.lastIndexOf("/")))) throw new Error("no folder");
        return store(path, new Uint8Array(data));
      },
      readBinary: async (file: { path: string }) => {
        const content = bytes.get(file.path) ?? new Uint8Array();
        return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
      }
    },
    fileManager: {
      // As Obsidian does: the attachment folder, and a number when the name is taken.
      getAvailablePathForAttachment: async (name: string) => {
        const dot = name.lastIndexOf(".");
        let path = `Anhänge/${name}`;
        for (let n = 1; files.has(path); n += 1) {
          path = `Anhänge/${name.slice(0, dot)} ${n}${name.slice(dot)}`;
        }
        return path;
      },
      generateMarkdownLink: (file: { name: string }) => `[[${file.name}]]`
    },
    secretStorage: { getSecret: () => "m".repeat(32) }
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
  return { mail, view, inserted, bytes, files };
}

/** Search, choose the first mail, and wait until the import has said how it went. */
async function importFirst(mail: InstanceType<typeof MailCommands>, inserted: string[]) {
  await mail.queryMailbox();
  await vi.waitFor(() => expect(inserted).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  Notice.shown = [];
  mocks.withAttachments = true;
  mocks.searchMail.mockReset();
  mocks.searchMail.mockResolvedValue({ messages: [REPLY], mailbox: "INBOX", truncated: false });
  mocks.fetchAttachments.mockReset();
  mocks.fetchAttachments.mockResolvedValue({
    attachments: [
      { filename: "Protokoll 2025.pdf", bytes: PDF },
      { filename: "Foto.jpg", bytes: JPG }
    ],
    skipped: [{ filename: "Termin.ics", reason: "type" }]
  });
  mocks.health.mockReset();
  mocks.health.mockResolvedValue({ version: "2.12.0", protocol: 7, capabilities: ["mail"] });
});

describe("importing a mail with its attachments", () => {
  it("saves the files, links them under the mail and names what was left out", async () => {
    const { mail, inserted, bytes } = setup();
    await importFirst(mail, inserted);

    expect(mocks.fetchAttachments).toHaveBeenCalledWith(expect.anything(), {
      uid: 246544,
      mailbox: "INBOX"
    });
    expect(bytes.get("Anhänge/Protokoll 2025.pdf")).toEqual(PDF);
    expect(bytes.get("Anhänge/Foto.jpg")).toEqual(JPG);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain("> Sehr geehrter Herr Seitz,\n>\n");
    expect(inserted[0]).toMatch(
      /> \[\[Protokoll 2025\.pdf\]\]\n> !\[\[Foto\.jpg\]\]\n> _Not imported: Termin\.ics \(file type\)_\n$/
    );
    expect(Notice.shown).toContain("Schreibstube: 2 attachments saved.");
  });

  it("links a file imported before instead of saving it again", async () => {
    const { mail, inserted, files } = setup({
      existing: [{ path: "Anhänge/Protokoll 2025.pdf", bytes: PDF }]
    });
    await importFirst(mail, inserted);

    expect(files.has("Anhänge/Protokoll 2025 1.pdf")).toBe(false);
    expect(inserted[0]).toContain("> [[Protokoll 2025.pdf]]");
  });

  it("keeps a different file of the same name under a new name", async () => {
    const { mail, inserted, bytes } = setup({
      existing: [{ path: "Anhänge/Protokoll 2025.pdf", bytes: new Uint8Array([1, 2, 3, 4, 5, 6]) }]
    });
    await importFirst(mail, inserted);

    expect(bytes.get("Anhänge/Protokoll 2025 1.pdf")).toEqual(PDF);
    expect(inserted[0]).toContain("> [[Protokoll 2025 1.pdf]]");
  });

  it("inserts only the text when the box is not ticked", async () => {
    mocks.withAttachments = false;
    const { mail, inserted } = setup();
    await mail.queryMailbox();
    await vi.waitFor(() => expect(inserted).toHaveLength(1));

    expect(mocks.fetchAttachments).not.toHaveBeenCalled();
    expect(inserted[0]).not.toContain("[[");
  });

  it("inserts the mail without files, and says why, when the bridge is too old", async () => {
    mocks.health.mockResolvedValue({ version: "2.11.1", protocol: 6, capabilities: ["mail"] });
    const { mail, inserted } = setup();
    await importFirst(mail, inserted);

    expect(mocks.fetchAttachments).not.toHaveBeenCalled();
    expect(inserted[0]).toContain("> Sehr geehrter Herr Seitz,");
    expect(Notice.shown.some((text) => text.includes("redeploy it"))).toBe(true);
  });

  it("inserts the mail without files when they cannot be fetched", async () => {
    mocks.fetchAttachments.mockRejectedValue(new Error("The mail is 52 MB."));
    const { mail, inserted } = setup();
    await importFirst(mail, inserted);

    expect(inserted[0]).not.toContain("[[");
    expect(Notice.shown.some((text) => text.includes("The mail is 52 MB."))).toBe(true);
  });

  it("inserts nothing into a note opened while the files were on their way", async () => {
    const { mail, inserted, view, bytes } = setup();
    mocks.fetchAttachments.mockImplementation(async () => {
      view.file = new TFile("Andere Notiz.md");
      return { attachments: [{ filename: "Protokoll 2025.pdf", bytes: PDF }], skipped: [] };
    });
    await mail.queryMailbox();
    await vi.waitFor(() =>
      expect(Notice.shown.some((text) => text.includes("another note was opened"))).toBe(true)
    );

    expect(inserted).toEqual([]);
    expect(bytes.get("Anhänge/Protokoll 2025.pdf")).toEqual(PDF);
  });
});
