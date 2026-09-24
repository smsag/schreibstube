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
  uploadThumbnail: vi.fn(),
  health: vi.fn(),
  resize: vi.fn()
}));

vi.mock("../services/publish-client", () => ({
  // The real client always answers with a thumbnail list, empty from a
  // protocol-1 bridge; a test's plan names one only when it asks for some.
  planPublish: async (...args: unknown[]) => ({
    uploadThumbnails: [],
    ...(await client.plan(...args))
  }),
  commitPublish: client.commit,
  uploadSource: client.uploadSource,
  uploadAsset: client.uploadAsset,
  uploadThumbnail: client.uploadThumbnail,
  listTargets: vi.fn(async () => []),
  bridgeHealth: client.health,
  checkTarget: vi.fn()
}));

// A canvas is the platform's; what is tested here is what is done with it.
vi.mock("../services/image-resize", async (original) => ({
  ...(await original<typeof import("../services/image-resize")>()),
  resizeImageToBytes: client.resize
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

/**
 * Wait for a confirmed publish to end. The dialog starts the run without
 * waiting for it, and every run ends in a notice that says how it went.
 */
async function runEnded(): Promise<void> {
  await vi.waitFor(() => {
    if (!Notice.shown.some((message) => /published —|publication failed/.test(message))) {
      throw new Error("the run has not ended yet");
    }
  });
}

/** The index the controller handed to the plan call. */
function plannedIndex() {
  expect(client.plan).toHaveBeenCalled();
  return client.plan.mock.calls.at(-1)?.[2];
}

beforeEach(() => {
  Notice.shown = [];
  client.plan.mockReset();
  // A bridge that has everything already: the plan counts the notes it was
  // given, as the real one does, and asks for no upload.
  client.plan.mockImplementation(
    async (_bridge: unknown, _target: unknown, index: { notes: unknown[] }) => ({
      target: "blog",
      baseUrl: "https://blog.example.com",
      uploadSources: [],
      uploadAssets: [],
      willDelete: [],
      unchangedSources: index.notes.length,
      notes: index.notes.length
    })
  );
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
  client.uploadThumbnail.mockReset();
  client.resize.mockReset();
  client.resize.mockResolvedValue({
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    mimeType: "image/jpeg"
  });
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

  it("takes the last page down when its flag is set to false", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "# Erste", frontmatter: { published: false } }]
    });
    client.plan.mockImplementationOnce(async () => ({
      target: "blog",
      baseUrl: "https://blog.example.com",
      uploadSources: [],
      uploadAssets: [],
      willDelete: ["erste/index.html"],
      unchangedSources: 0,
      notes: 0
    }));

    await controller(vault).commands.publish();
    await runEnded();
    // Stopping at "nothing is marked" used to leave this page online for good.
    expect(plannedIndex().notes).toEqual([]);
    expect(client.commit).toHaveBeenCalled();
    expect(client.commit.mock.calls.at(-1)?.[2].notes).toEqual([]);
  });

  it("stops without a commit when nothing is marked and nothing is left online", async () => {
    const vault = fakeVault({
      notes: [{ path: "Blog/Entwurf.md", content: "# Entwurf" }]
    });

    await controller(vault).commands.publish();
    expect(client.plan).toHaveBeenCalled();
    expect(client.commit).not.toHaveBeenCalled();
    expect(Notice.shown.join(" ")).toMatch(/no note in Blog is marked/);
  });

  it("never asks the bridge when the folder holds no notes at all", async () => {
    // A mistyped folder, or a phone that has not synced yet, would otherwise
    // send an empty index and take the whole site down.
    const vault = fakeVault({
      notes: [{ path: "Anderswo/Erste.md", content: "# Erste", frontmatter: published }]
    });

    await controller(vault).commands.publish();
    expect(client.plan).not.toHaveBeenCalled();
    expect(client.commit).not.toHaveBeenCalled();
    expect(Notice.shown.join(" ")).toMatch(/Blog holds no notes/);
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
    await runEnded();

    expect(client.uploadSource).toHaveBeenCalledTimes(1);
    expect(client.commit).toHaveBeenCalled();
  });

  it("records what the last run did, so the settings can show it", async () => {
    const { commands, state } = controller(vault());
    await commands.publish();

    // Recorded after the notice, so the record itself is what is waited for.
    await vi.waitFor(() =>
      expect(state.settings.publishLastRun.blog).toMatchObject({ written: 2, deleted: 3 })
    );
  });

  it("writes the publication back into the note", async () => {
    const target = vault();
    const { commands } = controller(target);
    await commands.publish();

    await vi.waitFor(() =>
      expect(target.frontmatterOf("Blog/Erste.md")).toMatchObject({
        publishedUrl: "https://blog.example.com/erste/"
      })
    );
  });

  it("leaves the note alone when write-back is off", async () => {
    const target = vault();
    const { commands, state } = controller(target, {
      publishAccounts: [{ ...account, writeBack: false }]
    });
    expect(state.settings.publishAccounts[0]?.writeBack).toBe(false);
    await commands.publish();
    await vi.waitFor(() => expect(state.settings.publishLastRun.blog).toBeDefined());

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

describe("uploading from a phone's point of view", () => {
  const pictures = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      path: `Blog/bild-${i}.png`,
      bytes: new Uint8Array([137, 80, 78, 71, i])
    }));

  /** A plan that asks for exactly the assets named, and no source. */
  function planAsking(assetPaths: string[]) {
    client.plan.mockImplementation(
      async (
        _bridge: unknown,
        _target: unknown,
        index: { notes: unknown[]; assets: { sourcePath: string; sha256: string; name: string }[] }
      ) => ({
        target: "blog",
        baseUrl: "https://blog.example.com",
        uploadSources: [],
        uploadAssets: index.assets
          .filter((asset) => assetPaths.includes(asset.sourcePath))
          .map((asset) => ({
            sourcePath: asset.sourcePath,
            sha256: asset.sha256,
            name: asset.name
          })),
        willDelete: [],
        unchangedSources: index.notes.length,
        notes: index.notes.length
      })
    );
  }

  it("reads an attachment the bridge already has once, to hash it, and never again", async () => {
    const [kept, wanted] = pictures(2);
    const vault = fakeVault({
      notes: [
        {
          path: "Blog/Erste.md",
          content: "![[bild-0.png]] ![[bild-1.png]]",
          frontmatter: published
        }
      ],
      binaries: [kept!, wanted!]
    });
    const reads = vi.spyOn(vault.app.vault, "readBinary");
    planAsking([wanted!.path]);

    await controller(vault).commands.publish();
    await runEnded();

    const readPaths = reads.mock.calls.map(([file]) => file.path);
    expect(readPaths.filter((path) => path === kept!.path)).toHaveLength(1);
    expect(readPaths.filter((path) => path === wanted!.path)).toHaveLength(2);
    expect(client.uploadAsset).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(client.uploadAsset.mock.calls[0]?.[4])).toEqual(wanted!.bytes);
    expect(client.commit).toHaveBeenCalled();
  });

  it("stops, and says which file, when an attachment changed after it was hashed", async () => {
    const [picture] = pictures(1);
    const vault = fakeVault({
      notes: [{ path: "Blog/Erste.md", content: "![[bild-0.png]]", frontmatter: published }],
      binaries: [picture!]
    });
    planAsking([picture!.path]);
    const planned = client.plan.getMockImplementation()!;
    client.plan.mockImplementation(async (...args: unknown[]) => {
      const plan = await planned(...(args as Parameters<typeof planned>));
      picture!.bytes[4] = 99; // edited between the plan and the upload
      return plan;
    });

    await controller(vault).commands.publish();
    await runEnded();

    expect(client.uploadAsset).not.toHaveBeenCalled();
    expect(client.commit).not.toHaveBeenCalled();
    expect(Notice.shown.join(" ")).toMatch(/Blog\/bild-0\.png changed while publishing/);
  });

  it("uploads a few at a time, never more than three", async () => {
    const all = pictures(8);
    const vault = fakeVault({
      notes: [
        {
          path: "Blog/Erste.md",
          content: all.map((picture) => `![[${picture.path.split("/").pop()}]]`).join(" "),
          frontmatter: published
        }
      ],
      binaries: all
    });
    planAsking(all.map((picture) => picture.path));
    let running = 0;
    let most = 0;
    client.uploadAsset.mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
    });

    await controller(vault).commands.publish();
    await runEnded();

    expect(client.uploadAsset).toHaveBeenCalledTimes(8);
    expect(most).toBe(3);
    expect(client.commit).toHaveBeenCalled();
  });
});

describe("filmstrip thumbnails", () => {
  const photo = { path: "Blog/Bilder/haus.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 9]) };
  const other = { path: "Blog/Bilder/garten.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 8]) };
  const drawing = { path: "Blog/Bilder/plan.svg", bytes: new TextEncoder().encode("<svg/>") };

  // Vault paths: the fake vault resolves those and bare names, not paths
  // relative to the note.
  const block = (layout: string, ...lines: string[]) =>
    "```schreibstube-slideshow\nlayout: " + layout + "\n" + lines.join("\n") + "\n```";

  const assetsPlanned = () =>
    plannedIndex().assets as { sourcePath: string; sha256: string; thumbnail?: boolean }[];

  /** A plan that asks for the thumbnail of every asset the index marked. */
  function planAskingThumbnails() {
    client.plan.mockImplementation(
      async (
        _bridge: unknown,
        _target: unknown,
        index: {
          notes: unknown[];
          assets: { sourcePath: string; sha256: string; name: string; thumbnail?: boolean }[];
        }
      ) => ({
        target: "blog",
        baseUrl: "https://blog.example.com",
        uploadSources: [],
        uploadAssets: [],
        uploadThumbnails: index.assets
          .filter((asset) => asset.thumbnail)
          .map((asset) => ({
            sourcePath: asset.sourcePath,
            sha256: asset.sha256,
            name: asset.name
          })),
        willDelete: [],
        unchangedSources: index.notes.length,
        notes: index.notes.length
      })
    );
  }

  it("asks for a thumbnail of a filmstrip's photographs only", async () => {
    const vault = fakeVault({
      notes: [
        {
          path: "Blog/Erste.md",
          content:
            block("filmstrip", "![](Blog/Bilder/haus.jpg)", "![](Blog/Bilder/plan.svg)") +
            "\n\n" +
            block("strip", "![](Blog/Bilder/garten.jpg)", "![](Blog/Bilder/haus.jpg)"),
          frontmatter: published
        }
      ],
      binaries: [photo, other, drawing]
    });

    await controller(vault).commands.preview();
    const marked = Object.fromEntries(
      assetsPlanned().map((asset) => [asset.sourcePath, asset.thumbnail === true])
    );
    expect(marked).toEqual({
      "Blog/Bilder/haus.jpg": true,
      "Blog/Bilder/plan.svg": false,
      "Blog/Bilder/garten.jpg": false
    });
  });

  it("asks for it when a picture shown plainly first is in a filmstrip later", async () => {
    const vault = fakeVault({
      notes: [
        { path: "Blog/A.md", content: "![[haus.jpg]]", frontmatter: published },
        {
          path: "Blog/B.md",
          content: block("filmstrip", "![](Blog/Bilder/haus.jpg)", "![](Blog/Bilder/garten.jpg)"),
          frontmatter: published
        }
      ],
      binaries: [photo, other]
    });

    await controller(vault).commands.preview();
    expect(assetsPlanned().every((asset) => asset.thumbnail === true)).toBe(true);
  });

  it("makes and sends the thumbnails the plan asks for, named after their picture", async () => {
    const vault = fakeVault({
      notes: [
        {
          path: "Blog/Erste.md",
          content: block("filmstrip", "![](Blog/Bilder/haus.jpg)", "![](Blog/Bilder/garten.jpg)"),
          frontmatter: published
        }
      ],
      binaries: [photo, other]
    });
    planAskingThumbnails();

    await controller(vault).commands.publish();
    await runEnded();

    expect(client.resize).toHaveBeenCalledTimes(2);
    expect(client.resize.mock.calls[0]?.slice(3)).toEqual([0.8, "image/jpeg"]);
    expect(client.uploadThumbnail).toHaveBeenCalledTimes(2);
    const [, target, source, name, sha256, body] = client.uploadThumbnail.mock.calls[0]!;
    expect(target).toBe("blog");
    expect(assetsPlanned().map((asset) => asset.sha256)).toContain(source);
    expect(name).toMatch(/\.jpg$/);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Uint8Array(body)).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    expect(client.commit).toHaveBeenCalled();
  });

  it("publishes without a thumbnail it could not make, or one too large to send", async () => {
    const vault = fakeVault({
      notes: [
        {
          path: "Blog/Erste.md",
          content: block("filmstrip", "![](Blog/Bilder/haus.jpg)", "![](Blog/Bilder/garten.jpg)"),
          frontmatter: published
        }
      ],
      binaries: [photo, other]
    });
    planAskingThumbnails();
    client.resize
      .mockRejectedValueOnce(new Error("image failed to load"))
      .mockResolvedValueOnce({ bytes: new Uint8Array(300_000), mimeType: "image/jpeg" });

    await controller(vault).commands.publish();
    await runEnded();

    expect(client.uploadThumbnail).not.toHaveBeenCalled();
    expect(client.commit).toHaveBeenCalled();
    expect(Notice.shown.some((message) => /published —/.test(message))).toBe(true);
  });

  it("decodes one photograph at a time", async () => {
    const vault = fakeVault({
      notes: [
        {
          path: "Blog/Erste.md",
          content: block("filmstrip", "![](Blog/Bilder/haus.jpg)", "![](Blog/Bilder/garten.jpg)"),
          frontmatter: published
        }
      ],
      binaries: [photo, other]
    });
    planAskingThumbnails();
    let running = 0;
    let most = 0;
    client.resize.mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), mimeType: "image/jpeg" };
    });

    await controller(vault).commands.publish();
    await runEnded();
    expect(most).toBe(1);
  });
});
