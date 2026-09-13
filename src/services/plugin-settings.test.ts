import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLISH_KEYS } from "./publish-index";
import { DEFAULT_SETTINGS, normalizeSettings } from "./plugin-settings";

describe("normalizeSettings", () => {
  it("returns defaults when called with undefined", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults when called with null", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves a fully valid settings object", () => {
    const valid = {
      ...DEFAULT_SETTINGS,
      llmProvider: "openai" as const,
      llmModel: "gpt-4o"
    };
    expect(normalizeSettings(valid)).toEqual(valid);
  });

  it("defaults overlayEnabled to true when absent", () => {
    expect(normalizeSettings({}).overlayEnabled).toBe(true);
  });

  it("preserves an explicit overlayEnabled=false", () => {
    expect(normalizeSettings({ overlayEnabled: false }).overlayEnabled).toBe(false);
  });

  it("defaults llmModelCustom to an empty string", () => {
    expect(normalizeSettings({}).llmModelCustom).toBe("");
  });

  it("preserves a custom model override", () => {
    expect(normalizeSettings({ llmModelCustom: "gpt-5-mini" }).llmModelCustom).toBe("gpt-5-mini");
  });

  it("falls back to default provider for an unknown provider value", () => {
    expect(normalizeSettings({ llmProvider: "unknown" as never })).toMatchObject({
      llmProvider: DEFAULT_SETTINGS.llmProvider
    });
  });

  it("resets model to first provider model when model belongs to a different provider", () => {
    expect(
      normalizeSettings({ llmProvider: "openai", llmModel: "claude-haiku-4-5-20251001" })
    ).toMatchObject({ llmProvider: "openai", llmModel: "gpt-4o-mini" });
  });

  it("resets model to first provider model when model is unrecognised", () => {
    expect(
      normalizeSettings({ llmProvider: "anthropic", llmModel: "made-up-model" })
    ).toMatchObject({ llmModel: "claude-haiku-4-5-20251001" });
  });

  it("ignores a field it does not know", () => {
    expect(normalizeSettings({ renameProvider: "openai" } as never).llmProvider).toBe(
      DEFAULT_SETTINGS.llmProvider
    );
  });

  it("defaults debugLogging to false", () => {
    expect(normalizeSettings({}).debugLogging).toBe(false);
  });

  it("preserves an explicit debugLogging=true", () => {
    expect(normalizeSettings({ debugLogging: true }).debugLogging).toBe(true);
  });

  it("falls back for non-positive renameMinContentChars", () => {
    expect(normalizeSettings({ renameMinContentChars: 0 })).toMatchObject({
      renameMinContentChars: DEFAULT_SETTINGS.renameMinContentChars
    });
  });

  it("falls back for non-positive renameMaxContentChars", () => {
    expect(normalizeSettings({ renameMaxContentChars: -1 })).toMatchObject({
      renameMaxContentChars: DEFAULT_SETTINGS.renameMaxContentChars
    });
  });

  it("falls back for non-positive renameMaxFilenameLength", () => {
    expect(normalizeSettings({ renameMaxFilenameLength: 0 })).toMatchObject({
      renameMaxFilenameLength: DEFAULT_SETTINGS.renameMaxFilenameLength
    });
  });

  it("preserves focus settings from loaded data", () => {
    expect(normalizeSettings({ focusMode: "sentence", focusDimOpacity: 0.6 })).toMatchObject({
      focusMode: "sentence",
      focusDimOpacity: 0.6
    });
  });

  it("defaults summarizePrompt when absent", () => {
    expect(normalizeSettings({}).summarizePrompt).toBe(DEFAULT_SETTINGS.summarizePrompt);
  });

  it("restores the default summarizePrompt for a blank value", () => {
    expect(normalizeSettings({ summarizePrompt: "   " }).summarizePrompt).toBe(
      DEFAULT_SETTINGS.summarizePrompt
    );
  });

  it("preserves a custom summarizePrompt", () => {
    expect(normalizeSettings({ summarizePrompt: "Summarize tersely." }).summarizePrompt).toBe(
      "Summarize tersely."
    );
  });

  it("clamps summarizeMaxTokens below the minimum", () => {
    expect(normalizeSettings({ summarizeMaxTokens: 1 }).summarizeMaxTokens).toBe(64);
  });

  it("clamps summarizeMaxTokens above the maximum", () => {
    expect(normalizeSettings({ summarizeMaxTokens: 999999 }).summarizeMaxTokens).toBe(4096);
  });

  it("falls back for a non-integer summarizeMaxTokens", () => {
    expect(normalizeSettings({ summarizeMaxTokens: NaN }).summarizeMaxTokens).toBe(
      DEFAULT_SETTINGS.summarizeMaxTokens
    );
  });

  it("defaults proofreadPrompt when absent", () => {
    expect(normalizeSettings({}).proofreadPrompt).toBe(DEFAULT_SETTINGS.proofreadPrompt);
  });

  it("restores the default proofreadPrompt for a blank value", () => {
    expect(normalizeSettings({ proofreadPrompt: "  " }).proofreadPrompt).toBe(
      DEFAULT_SETTINGS.proofreadPrompt
    );
  });

  it("preserves a custom proofreadPrompt", () => {
    expect(normalizeSettings({ proofreadPrompt: "Nur Tippfehler." }).proofreadPrompt).toBe(
      "Nur Tippfehler."
    );
  });

  it("clamps proofreadMaxTokens to its range", () => {
    expect(normalizeSettings({ proofreadMaxTokens: 1 }).proofreadMaxTokens).toBe(256);
    expect(normalizeSettings({ proofreadMaxTokens: 999999 }).proofreadMaxTokens).toBe(8192);
  });

  it("clamps proofreadChunkChars to its range", () => {
    expect(normalizeSettings({ proofreadChunkChars: 1 }).proofreadChunkChars).toBe(500);
    expect(normalizeSettings({ proofreadChunkChars: 999999 }).proofreadChunkChars).toBe(6000);
  });

  it("clamps proofreadConcurrency to its range", () => {
    expect(normalizeSettings({ proofreadConcurrency: 0 }).proofreadConcurrency).toBe(1);
    expect(normalizeSettings({ proofreadConcurrency: 99 }).proofreadConcurrency).toBe(4);
  });

  it("defaults glossaryDefault to an empty list", () => {
    expect(normalizeSettings({}).glossaryDefault).toEqual([]);
  });

  it("keeps glossary paths and drops blank entries", () => {
    expect(normalizeSettings({ glossaryDefault: ["A.md", "  ", "B.md"] }).glossaryDefault).toEqual([
      "A.md",
      "B.md"
    ]);
  });

  it("ignores a glossaryDefault that is not a list", () => {
    expect(normalizeSettings({ glossaryDefault: "A.md" as never }).glossaryDefault).toEqual([]);
  });

  it("drops non-string glossary entries", () => {
    expect(normalizeSettings({ glossaryDefault: ["A.md", 7 as never] }).glossaryDefault).toEqual([
      "A.md"
    ]);
  });

  it("defaults the live underline to off", () => {
    expect(normalizeSettings({}).glossaryLiveUnderline).toBe(false);
  });

  it("keeps folder rules verbatim", () => {
    expect(normalizeSettings({ glossaryFolderRules: "Kunden | A.md" }).glossaryFolderRules).toBe(
      "Kunden | A.md"
    );
  });

  it("defaults document sync to off", () => {
    expect(normalizeSettings({}).syncEnabled).toBe(false);
  });

  it("defaults the on-open check to on", () => {
    expect(normalizeSettings({}).syncCheckOnOpen).toBe(true);
  });

  it("clamps the sync interval to its range", () => {
    expect(normalizeSettings({ syncMinIntervalMinutes: -5 }).syncMinIntervalMinutes).toBe(0);
    expect(normalizeSettings({ syncMinIntervalMinutes: 99999 }).syncMinIntervalMinutes).toBe(120);
  });

  it("defaults sync state to empty", () => {
    expect(normalizeSettings({}).syncState).toEqual({});
  });

  it("keeps a well-formed sync record", () => {
    const record = { hash: "abcd1234", etag: 'W/"x"', checkedAt: 42, pendingChanges: 2 };
    expect(normalizeSettings({ syncState: { "a.md": record } }).syncState["a.md"]).toEqual(record);
  });

  it("fills missing fields on a partial sync record", () => {
    expect(
      normalizeSettings({ syncState: { "a.md": { hash: "abcd1234" } as never } }).syncState["a.md"]
    ).toEqual({ hash: "abcd1234", etag: "", checkedAt: 0, pendingChanges: 0 });
  });

  it("defaults a missing pending count to zero", () => {
    expect(
      normalizeSettings({ syncState: { "a.md": { hash: "abcd1234" } as never } }).syncState["a.md"]
        ?.pendingChanges
    ).toBe(0);
  });

  it("defaults the background poll to off with an hourly schedule", () => {
    expect(normalizeSettings({}).syncPollEnabled).toBe(false);
    expect(normalizeSettings({}).syncPollCron).toBe("0 * * * *");
  });

  it("restores the default schedule for a blank expression", () => {
    expect(normalizeSettings({ syncPollCron: "  " }).syncPollCron).toBe("0 * * * *");
  });

  it("keeps a custom schedule verbatim", () => {
    expect(normalizeSettings({ syncPollCron: "0 8 * * 1-5" }).syncPollCron).toBe("0 8 * * 1-5");
  });

  it("defaults the GitHub secret name to empty", () => {
    expect(normalizeSettings({}).githubSecretName).toBe("");
  });

  it("defaults the last poll time to zero", () => {
    expect(normalizeSettings({}).syncLastPollAt).toBe(0);
    expect(normalizeSettings({ syncLastPollAt: "nope" as never }).syncLastPollAt).toBe(0);
  });

  it("drops a sync record with no hash", () => {
    expect(normalizeSettings({ syncState: { "a.md": { etag: "x" } as never } }).syncState).toEqual(
      {}
    );
  });

  it("ignores a sync state that is not an object", () => {
    expect(normalizeSettings({ syncState: [] as never }).syncState).toEqual({});
    expect(normalizeSettings({ syncState: "nope" as never }).syncState).toEqual({});
  });
});

describe("normalizeSettings — email bridge", () => {
  it("defaults to an unconfigured bridge", () => {
    const settings = normalizeSettings({});
    expect(settings.mailBridgeUrl).toBe("");
    expect(settings.mailTokenSecretName).toBe("");
    expect(settings.mailMailbox).toBe("INBOX");
    expect(settings.mailMergeHeading).toBe("Correspondence");
  });

  it("trims the bridge URL so a pasted value with whitespace still works", () => {
    expect(normalizeSettings({ mailBridgeUrl: "  https://x.app  " }).mailBridgeUrl).toBe(
      "https://x.app"
    );
  });

  it("keeps the bridge URL empty when cleared, rather than restoring a default", () => {
    expect(normalizeSettings({ mailBridgeUrl: "" }).mailBridgeUrl).toBe("");
  });

  it("restores the default mailbox when the value is blanked", () => {
    expect(normalizeSettings({ mailMailbox: "   " }).mailMailbox).toBe("INBOX");
  });

  it("keeps a custom mailbox and merge heading", () => {
    const settings = normalizeSettings({
      mailMailbox: "Archiv",
      mailMergeHeading: "Korrespondenz"
    });
    expect(settings.mailMailbox).toBe("Archiv");
    expect(settings.mailMergeHeading).toBe("Korrespondenz");
  });

  it("clamps mailMaxResults into the supported range", () => {
    expect(normalizeSettings({ mailMaxResults: 0 }).mailMaxResults).toBe(1);
    expect(normalizeSettings({ mailMaxResults: 5000 }).mailMaxResults).toBe(50);
    expect(normalizeSettings({ mailMaxResults: 10 }).mailMaxResults).toBe(10);
  });

  it("falls back for a non-integer mailMaxResults", () => {
    expect(normalizeSettings({ mailMaxResults: "many" as unknown as number }).mailMaxResults).toBe(
      DEFAULT_SETTINGS.mailMaxResults
    );
  });
});

describe("normalizeSettings — publishing", () => {
  it("starts with no accounts", () => {
    expect(normalizeSettings({}).publishAccounts).toEqual([]);
  });

  it("keeps a complete account", () => {
    const accounts = normalizeSettings({
      publishAccounts: [{ id: "a", name: "Blog", folder: "Blog", target: "blog", writeBack: true }]
    }).publishAccounts;
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ name: "Blog", folder: "Blog", target: "blog" });
  });

  it("drops an account that cannot publish anything", () => {
    const accounts = normalizeSettings({
      publishAccounts: [
        { id: "a", name: "Ohne Ordner", folder: "", target: "blog", writeBack: true },
        { id: "b", name: "Ohne Ziel", folder: "Blog", target: "", writeBack: true }
      ]
    }).publishAccounts;
    expect(accounts).toEqual([]);
  });

  it("trims the slashes a folder is often typed with", () => {
    const accounts = normalizeSettings({
      publishAccounts: [
        { id: "a", name: "Blog", folder: "/Blog/", target: "blog", writeBack: true }
      ]
    }).publishAccounts;
    expect(accounts[0]?.folder).toBe("Blog");
  });

  it("names an account after its folder when no name was given", () => {
    const accounts = normalizeSettings({
      publishAccounts: [{ id: "a", name: "", folder: "Blog", target: "blog", writeBack: true }]
    }).publishAccounts;
    expect(accounts[0]?.name).toBe("Blog");
  });

  it("defaults the frontmatter keys to the ones the plugin ships with", () => {
    expect(normalizeSettings({}).publishFrontmatterKeys).toEqual(DEFAULT_PUBLISH_KEYS);
  });

  it("keeps a configured key and defaults the rest", () => {
    const keys = normalizeSettings({
      publishFrontmatterKeys: { title: "titel" } as never
    }).publishFrontmatterKeys;
    expect(keys.title).toBe("titel");
    expect(keys.date).toBe(DEFAULT_PUBLISH_KEYS.date);
  });

  it("survives a key map that was edited into nonsense by hand", () => {
    expect(
      normalizeSettings({ publishFrontmatterKeys: "titel" as never }).publishFrontmatterKeys
    ).toEqual(DEFAULT_PUBLISH_KEYS);
  });
});
