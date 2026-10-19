import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The share controller decides which account a note goes to, what of the
 * note is sent, and which pictures travel with it. The dialogs and the bridge
 * are stubbed; the tests answer the dialogs and read what reached the bridge.
 */
const dialogs = vi.hoisted(() => ({
  share: [] as {
    title: string;
    existing: { code: string }[];
    submit: (choice: unknown) => void;
    revoke: (link: unknown) => void;
  }[],
  result: [] as { link: unknown; password: string }[],
  list: [] as { name: string; links: unknown[]; revoke: (link: unknown) => Promise<boolean> }[],
  chosen: [] as unknown[]
}));

vi.mock("../ui/share-modals", () => ({
  ShareModal: class {
    constructor(
      _app: unknown,
      title: string,
      existing: { code: string }[],
      submit: (choice: unknown) => void,
      revoke: (link: unknown) => void
    ) {
      dialogs.share.push({ title, existing, submit, revoke });
    }
    open(): void {}
  },
  ShareResultModal: class {
    constructor(_app: unknown, link: unknown, password: string) {
      dialogs.result.push({ link, password });
    }
    open(): void {}
  },
  ShareListModal: class {
    constructor(
      _app: unknown,
      name: string,
      links: unknown[],
      revoke: (link: unknown) => Promise<boolean>
    ) {
      dialogs.list.push({ name, links, revoke });
    }
    open(): void {}
  }
}));

vi.mock("../ui/publish-modals", () => ({
  PublishAccountModal: class {
    constructor(
      _app: unknown,
      private readonly accounts: unknown[],
      private readonly onChoose: (account: unknown) => void
    ) {}
    open(): void {
      dialogs.chosen.push(this.accounts);
      this.onChoose(this.accounts[1]);
    }
  },
  PublishPlanModal: class {}
}));

const trust = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("../ui/bridge-origin-modal", () => ({ askToSendToken: trust.ask }));

const client = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  health: vi.fn()
}));
vi.mock("../platform/publish-client", () => ({
  listShares: client.list,
  createShare: client.create,
  revokeShare: client.revoke,
  bridgeHealth: client.health
}));

const { Notice } = await import("../testing/obsidian-stub");
const { fakeVault } = await import("../testing/fake-app");
const { PublishCommands } = await import("./publish-commands");
const { ShareCommands } = await import("./share-commands");
const { DEFAULT_SETTINGS, normalizeSettings } = await import("../services/plugin-settings");
const { setLanguage } = await import("../i18n");

setLanguage("en");

const blog = {
  id: "blog",
  name: "Blog",
  folder: "Blog",
  target: "blog",
  writeBack: false,
  aiDescription: false,
  headerTags: []
};
const clients = { ...blog, id: "clients", name: "Clients", folder: "Kunden", target: "kunden" };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const LINK = {
  code: "ABCDEFGHJK",
  url: "https://kunden.example.com/s/ABCDEFGHJK/",
  title: "Angebot",
  sourcePath: "Kunden/Angebot.md",
  createdAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-19T12:00:00.000Z",
  expiresAt: null,
  protected: true
};

function setup({
  accounts = [blog, clients],
  active = "Kunden/Angebot.md"
}: { accounts?: (typeof blog)[]; active?: string | null } = {}) {
  const vault = fakeVault({
    notes: [
      {
        path: "Kunden/Angebot.md",
        content:
          "---\ntitle: Das Angebot\n---\n# Angebot\n\n![[bild.png]] ![[film.mp4]] ![[Preise]]\n\n%%nur für mich%%\n",
        frontmatter: { title: "Das Angebot" }
      },
      { path: "Kunden/Preise.md", content: "Preise" },
      { path: "Privat/Brief.md", content: "Lieber Paul" },
      { path: "Bild.canvas", content: "{}" }
    ],
    binaries: [
      { path: "Anhänge/bild.png", bytes: PNG },
      { path: "Anhänge/film.mp4", bytes: new Uint8Array([0]) }
    ]
  });
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    publishBridgeUrl: "https://bridge.example.app",
    publishTokenSecretName: "publish-token",
    publishAccounts: accounts
  });
  const app = {
    ...vault.app,
    workspace: {
      getActiveFile: () => (active ? vault.app.vault.getAbstractFileByPath(active) : null)
    }
  };
  const logger = { debug: () => {}, warn: () => {}, error: () => {} } as never;
  const publish = new PublishCommands(
    app as never,
    () => settings,
    async () => {},
    logger
  );
  const commands = new ShareCommands(app as never, () => settings, publish, logger);
  commands.useListener((target, links) =>
    heard.push({ target, codes: links.map((link) => link.code) })
  );
  return commands;
}

let heard: { target: string; codes: string[] }[] = [];

beforeEach(() => {
  heard = [];
  Notice.shown = [];
  dialogs.share = [];
  dialogs.result = [];
  dialogs.list = [];
  dialogs.chosen = [];
  trust.ask.mockReset();
  trust.ask.mockResolvedValue(true);
  client.list.mockReset();
  client.list.mockResolvedValue([LINK, { ...LINK, code: "BCDEFGHJKL", sourcePath: "Anders.md" }]);
  client.create.mockReset();
  client.create.mockResolvedValue(LINK);
  client.revoke.mockReset();
  client.revoke.mockResolvedValue(true);
  client.health.mockReset();
  client.health.mockResolvedValue({ version: "3.2.0", protocol: 9, capabilities: ["publish"] });
});

describe("sharing the open note", () => {
  it("goes to the account whose folder holds the note, and offers that note's links", async () => {
    await setup().shareActiveNote();

    expect(client.list).toHaveBeenCalledWith(expect.anything(), "kunden");
    expect(dialogs.chosen).toEqual([]);
    expect(dialogs.share[0]?.title).toBe("Angebot");
    expect(dialogs.share[0]?.existing.map((link) => link.code)).toEqual(["ABCDEFGHJK"]);
  });

  it("sends the note as a page shows it, with its pictures, and says what stayed behind", async () => {
    await setup().shareActiveNote();
    dialogs.share[0]?.submit({ password: "korrekt-pferd", expiresAt: null });
    await vi.waitFor(() => expect(dialogs.result).toHaveLength(1));

    const [, request] = client.create.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      target: "kunden",
      title: "Das Angebot",
      sourcePath: "Kunden/Angebot.md",
      password: "korrekt-pferd",
      expiresAt: null,
      assets: [{ sourcePath: "Anhänge/bild.png", data: Buffer.from(PNG).toString("base64") }]
    });
    expect(request).not.toHaveProperty("code");
    expect(request.source).not.toContain("title: Das Angebot");
    expect(request.source).not.toContain("nur für mich");
    expect(dialogs.result[0]).toEqual({ link: LINK, password: "korrekt-pferd" });
    expect(
      Notice.shown.some((message) => message.includes("not in the shared page: Anhänge/film.mp4"))
    ).toBe(true);
  });

  it("rewrites a link by its code, and sends no password for an open one", async () => {
    await setup().shareActiveNote();
    dialogs.share[0]?.submit({
      code: "ABCDEFGHJK",
      password: "",
      expiresAt: "2026-12-01T00:00:00.000Z"
    });
    await vi.waitFor(() => expect(client.create).toHaveBeenCalled());
    const [, request] = client.create.mock.calls[0] ?? [];
    expect(request.code).toBe("ABCDEFGHJK");
    expect(request).not.toHaveProperty("password");
    expect(request.expiresAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("asks which account when no folder holds the note", async () => {
    await setup({ active: "Privat/Brief.md" }).shareActiveNote();
    expect(dialogs.chosen).toHaveLength(1);
    await vi.waitFor(() => expect(dialogs.share).toHaveLength(1));
    expect(client.list).toHaveBeenCalledWith(expect.anything(), "kunden");
  });

  it("says so when there is no note, no account, or the bridge fails", async () => {
    await setup({ active: null }).shareActiveNote();
    await setup({ active: "Bild.canvas" }).shareActiveNote();
    expect(Notice.shown.filter((message) => message.includes("open a note"))).toHaveLength(2);

    await setup({ accounts: [] }).shareActiveNote();
    expect(Notice.shown.some((message) => message.includes("no publishing account"))).toBe(true);

    client.list.mockRejectedValueOnce(new Error("bridge down"));
    await setup().shareActiveNote();
    expect(Notice.shown.some((message) => message.includes("sharing failed — bridge down"))).toBe(
      true
    );
    expect(dialogs.share).toHaveLength(0);
  });

  it("takes a link down from the dialog", async () => {
    await setup().shareActiveNote();
    dialogs.share[0]?.revoke(LINK);
    await vi.waitFor(() =>
      expect(client.revoke).toHaveBeenCalledWith(expect.anything(), "kunden", "ABCDEFGHJK")
    );
    await vi.waitFor(() =>
      expect(Notice.shown.some((message) => message.includes("link taken down"))).toBe(true)
    );
  });
});

describe("managing links", () => {
  it("asks which site with several accounts, whatever note is open", async () => {
    await setup().manageShares();
    expect(dialogs.chosen).toHaveLength(1);
    await vi.waitFor(() => expect(dialogs.list).toHaveLength(1));
  });

  it("lists the account's links, and says when a revoke left a file behind", async () => {
    await setup({ accounts: [clients] }).manageShares();
    expect(dialogs.list[0]?.name).toBe("Clients");
    expect(dialogs.list[0]?.links).toHaveLength(2);

    client.revoke.mockResolvedValueOnce(false);
    await expect(dialogs.list[0]?.revoke(LINK)).resolves.toBe(true);
    expect(Notice.shown.some((message) => message.includes("stayed on the host"))).toBe(true);

    client.revoke.mockRejectedValueOnce(new Error("gone"));
    await expect(dialogs.list[0]?.revoke(LINK)).resolves.toBe(false);
  });
});

describe("telling the file pane", () => {
  it("passes on each list, and the list as a share or a revoke leaves it", async () => {
    client.create.mockResolvedValueOnce({ ...LINK, code: "CDEFGHJKLM" });
    await setup().shareActiveNote();
    dialogs.share[0]?.submit({ password: "korrekt-pferd", expiresAt: null });
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    expect(heard).toEqual([
      { target: "kunden", codes: ["ABCDEFGHJK", "BCDEFGHJKL"] },
      { target: "kunden", codes: ["ABCDEFGHJK", "BCDEFGHJKL", "CDEFGHJKLM"] }
    ]);

    heard = [];
    await setup({ accounts: [clients] }).manageShares();
    await dialogs.list[0]?.revoke(LINK);
    client.revoke.mockRejectedValueOnce(new Error("gone"));
    await dialogs.list[0]?.revoke({ ...LINK, code: "BCDEFGHJKL" });
    expect(heard.at(-1)).toEqual({ target: "kunden", codes: ["BCDEFGHJKL"] });
  });
});
