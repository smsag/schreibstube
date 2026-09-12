import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The publish controller decides what goes into the index, and therefore what
 * the bridge writes and what it deletes. It was the largest untested file in
 * the plugin, which is a poor place for that to be true.
 *
 * Obsidian is a types-only dependency with no runtime module, so it is stubbed;
 * the plan and commit calls are stubbed too, and the tests assert on the index
 * the controller hands them.
 */
vi.mock("../ui/publish-modals", () => ({
  PublishPlanModal: class {
    constructor(
      _app: unknown,
      _account: unknown,
      _plan: unknown,
      private readonly onConfirm: (() => void) | null
    ) {}
    open(): void {
      this.onConfirm?.();
    }
  },
  PublishAccountModal: class {
    constructor(
      _app: unknown,
      private readonly accounts: { id: string }[],
      private readonly onChoose: (account: unknown) => void
    ) {}
    open(): void {
      this.onChoose(this.accounts[0]);
    }
  }
}));

const client = vi.hoisted(() => ({
  plan: vi.fn(),
  commit: vi.fn(),
  uploadSource: vi.fn(),
  uploadAsset: vi.fn(),
  health: vi.fn()
}));

vi.mock("../services/publish-client", () => ({
  planPublish: client.plan,
  commitPublish: client.commit,
  uploadSource: client.uploadSource,
  uploadAsset: client.uploadAsset,
  listTargets: vi.fn(async () => []),
  bridgeHealth: client.health,
  checkTarget: vi.fn()
}));

const { Notice } = await import("../testing/obsidian-stub");
const { fakeVault } = await import("../testing/fake-app");
const { PublishCommands } = await import("./publish-commands");
const { DEFAULT_SETTINGS, normalizeSettings } = await import("../services/plugin-settings");
const { setLanguage } = await import("../i18n");

setLanguage("en");

const account = {
  id: "blog",
  name: "Schreibstube",
  folder: "Blog",
  target: "blog",
  writeBack: true
};

function settings(overrides = {}) {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    publishBridgeUrl: "https://bridge.example.app",
    publishTokenSecretName: "publish-token",
    publishAccounts: [account],
    ...overrides
  });
}

const published = { published: true };

function controller(vault: ReturnType<typeof fakeVault>, overrides = {}) {
  const state = { settings: settings(overrides) };
  const saved: Record<string, unknown>[] = [];

  const commands = new PublishCommands(
    vault.app as never,
    () => state.settings,
    async (patch) => {
      saved.push(patch as Record<string, unknown>);
      state.settings = normalizeSettings({ ...state.settings, ...patch });
    },
    { debug: () => {}, warn: () => {}, error: () => {} } as never
  );

  return { commands, saved, state };
}

/** The index the controller handed to the plan call. */
function plannedIndex() {
  expect(client.plan).toHaveBeenCalled();
  return client.plan.mock.calls.at(-1)?.[2];
}

beforeEach(() => {
  Notice.shown = [];
  client.plan.mockReset();
  client.plan.mockResolvedValue({
    target: "blog",
    baseUrl: "https://blog.example.com",
    uploadSources: [],
    uploadAssets: [],
    willDelete: [],
    unchangedSources: 0,
    notes: 0
  });
  client.commit.mockReset();
  client.commit.mockResolvedValue({
    target: "blog",
    baseUrl: "https://blog.example.com",
    written: 2,
    unchanged: 1,
    deleted: 3,
    pruned: 0,
    collected: 0,
    durationMs: 10
  });
  client.uploadSource.mockReset();
  client.uploadAsset.mockReset();
  client.health.mockReset();
  client.health.mockResolvedValue({ version: "2.1.0", protocol: 1, capabilities: ["publish"] });
});

describe("which notes are published", () => {
  it("takes the notes in the folder that are marked", async () => {
    const vault = fakeVault({
      notes: [
        { path: "Blog/Erste.md", content: "# Erste", frontmatter: published },
        { path: "Blog/Zweite.md", content: "# Zweite", frontmatter: published }
      ]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().notes.map((note: { slug: string }) => note.slug)).toEqual([
      "erste",
      "zweite"
    ]);
  });

  it("leaves an unmarked note alone, because silence has to mean no", async () => {
    const vault = fakeVault({
      notes: [
        { path: "Blog/Erste.md", content: "# Erste", frontmatter: published },
        { path: "Blog/Entwurf.md", content: "# Entwurf" }
      ]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().notes).toHaveLength(1);
  });

  it("takes a note down when its flag is set to false", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "# Erste", frontmatter: { published: false } }]
    });

    await controller(vault).commands.preview();
    expect(client.plan).not.toHaveBeenCalled();
    expect(Notice.shown.join(" ")).toMatch(/no note in Blog/);
  });

  it("ignores a marked note outside the folder", async () => {
    const vault = fakeVault({
      notes: [
        { path: "Blog/Erste.md", content: "# Erste", frontmatter: published },
        { path: "Privat/Geheim.md", content: "# Geheim", frontmatter: published }
      ]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().notes.map((note: { sourcePath: string }) => note.sourcePath)).toEqual([
      "Blog/Erste.md"
    ]);
  });

  it("includes a note in a subfolder", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/2026/Erste.md", content: "# Erste", frontmatter: published }]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().notes).toHaveLength(1);
  });

  it("reads the frontmatter keys the settings name", async () => {
    const vault = fakeVault({
      notes: [
        { path: "Blog/Erste.md", content: "# Erste", frontmatter: { veroeffentlicht: true } },
        { path: "Blog/Zweite.md", content: "# Zweite", frontmatter: published }
      ]
    });

    const { commands } = controller(vault, {
      publishFrontmatterKeys: { published: "veroeffentlicht" }
    });
    await commands.preview();

    expect(plannedIndex().notes.map((note: { slug: string }) => note.slug)).toEqual(["erste"]);
  });

  it("refuses when two notes claim one address", async () => {
    const vault = fakeVault({
      notes: [
        { path: "Blog/Erste.md", content: "# A", frontmatter: { ...published, slug: "gleich" } },
        { path: "Blog/Zweite.md", content: "# B", frontmatter: { ...published, slug: "gleich" } }
      ]
    });

    await controller(vault).commands.preview();
    expect(client.plan).not.toHaveBeenCalled();
    expect(Notice.shown.join(" ")).toContain("Blog/Zweite.md");
  });
});

describe("what each note says about itself", () => {
  it("fills in title, date and slug when the frontmatter does not", async () => {
    const vault = fakeVault({
      notes: [
        {
          path: "Blog/Hallo Welt.md",
          content: "# Die Überschrift\n\nText",
          frontmatter: published,
          createdMs: new Date(2026, 0, 5).getTime()
        }
      ]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().notes[0]).toMatchObject({
      slug: "hallo-welt",
      title: "Die Überschrift",
      date: "2026-01-05"
    });
  });

  it("prefers what the frontmatter says", async () => {
    const vault = fakeVault({
      notes: [
        {
          path: "Blog/Hallo.md",
          content: "# Aus der Datei",
          frontmatter: {
            ...published,
            title: "Aus dem Frontmatter",
            date: "2026-09-12",
            slug: "anders",
            description: "Kurz"
          }
        }
      ]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().notes[0]).toMatchObject({
      title: "Aus dem Frontmatter",
      date: "2026-09-12",
      slug: "anders",
      description: "Kurz"
    });
  });

  it("hashes the content, so an unchanged note is recognised as unchanged", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "# Erste", frontmatter: published }]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().notes[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("which attachments travel", () => {
  const image = { path: "Blog/bild.png", bytes: new Uint8Array([1, 2, 3]) };
  const unused = { path: "Blog/ungenutzt.png", bytes: new Uint8Array([9]) };

  it("takes only what a published note refers to", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "![[bild.png]]", frontmatter: published }],
      binaries: [image, unused]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().assets.map((asset: { sourcePath: string }) => asset.sourcePath)).toEqual([
      "Blog/bild.png"
    ]);
  });

  it("follows a link into another folder, as Obsidian does", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "![[haus.jpg]]", frontmatter: published }],
      binaries: [{ path: "Anhänge/haus.jpg", bytes: new Uint8Array([7]) }]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().assets[0].sourcePath).toBe("Anhänge/haus.jpg");
  });

  it("lists an attachment once, however many notes embed it", async () => {
    const vault = fakeVault({
      notes: [
        { path: "Blog/Erste.md", content: "![[bild.png]]", frontmatter: published },
        { path: "Blog/Zweite.md", content: "![[bild.png]]", frontmatter: published }
      ],
      binaries: [image]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().assets).toHaveLength(1);
  });

  it("refuses a file type a site has no business serving", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "![[tabelle.xlsx]]", frontmatter: published }],
      binaries: [{ path: "Blog/tabelle.xlsx", bytes: new Uint8Array([1]) }]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().assets).toEqual([]);
  });
});

describe("the rest of the index", () => {
  it("takes the site title from the account", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "# Erste", frontmatter: published }]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().siteTitle).toBe("Schreibstube");
  });

  it("sends a theme.css from the publish folder", async () => {
    const vault = fakeVault({
      notes: [
        { path: "Blog/Erste.md", content: "# Erste", frontmatter: published },
        { path: "Blog/theme.css", content: "body { color: red }" }
      ]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().themeCss).toBe("body { color: red }");
  });

  it("sends nothing for the theme when the folder has none", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "# Erste", frontmatter: published }]
    });

    await controller(vault).commands.preview();
    expect(plannedIndex().themeCss).toBeUndefined();
  });
});

describe("publishing", () => {
  const vault = () =>
    fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "# Erste", frontmatter: published }]
    });

  it("uploads what the plan asked for, then commits", async () => {
    // The bridge answers with the hashes it has not seen, which are the ones
    // the controller just computed.
    client.plan.mockImplementation(
      async (
        _bridge: unknown,
        _target: unknown,
        index: { notes: { sourcePath: string; sha256: string }[] }
      ) => ({
        target: "blog",
        baseUrl: "https://blog.example.com",
        uploadSources: index.notes.map((note) => ({
          sourcePath: note.sourcePath,
          sha256: note.sha256
        })),
        uploadAssets: [],
        willDelete: [],
        unchangedSources: 0,
        notes: index.notes.length
      })
    );

    const { commands } = controller(vault());
    await commands.publish();

    expect(client.uploadSource).toHaveBeenCalledTimes(1);
    expect(client.commit).toHaveBeenCalled();
  });

  it("records what the last run did, so the settings can show it", async () => {
    const { commands, state } = controller(vault());
    await commands.publish();

    expect(state.settings.publishLastRun.blog).toMatchObject({ written: 2, deleted: 3 });
  });

  it("writes the publication back into the note", async () => {
    const target = vault();
    const { commands } = controller(target);
    await commands.publish();

    expect(target.frontmatterOf("Blog/Erste.md")).toMatchObject({
      publishedUrl: "https://blog.example.com/erste/"
    });
  });

  it("leaves the note alone when write-back is off", async () => {
    const target = vault();
    const { commands, state } = controller(target, {
      publishAccounts: [{ ...account, writeBack: false }]
    });
    expect(state.settings.publishAccounts[0].writeBack).toBe(false);
    await commands.publish();

    expect(target.frontmatterOf("Blog/Erste.md").publishedUrl).toBeUndefined();
  });

  it("says so when the bridge is behind the plugin", async () => {
    client.health.mockResolvedValue({ version: "2.0.0", protocol: 0, capabilities: [] });

    const { commands } = controller(vault());
    await commands.preview();

    expect(Notice.shown.join(" ")).toMatch(/redeploy the bridge/);
  });

  it("asks the bridge once per session, not once per command", async () => {
    const { commands } = controller(vault());
    await commands.preview();
    await commands.preview();

    expect(client.health).toHaveBeenCalledTimes(1);
  });
});
