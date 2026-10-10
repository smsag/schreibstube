import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLISH_KEYS } from "./publish-index";
import {
  DEFAULT_SETTINGS,
  MAX_FILENAME_LENGTH,
  MAX_RENAME_CONTENT_CHARS,
  MIN_FILENAME_LENGTH,
  MIN_RENAME_CONTENT_CHARS,
  holdsRetiredSettings,
  normalizeSettings,
  RETIRED_SETTING_KEYS
} from "./plugin-settings";

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

  it("keeps the task counts in the file pane off unless switched on", () => {
    expect(normalizeSettings({}).explorerTaskCounts).toBe(false);
    expect(normalizeSettings({ explorerTaskCounts: "on" as never }).explorerTaskCounts).toBe(false);
    expect(normalizeSettings({ explorerTaskCounts: true }).explorerTaskCounts).toBe(true);
  });

  it("keeps the due dates in the file pane off unless switched on", () => {
    expect(normalizeSettings({}).explorerDueDates).toBe(false);
    expect(normalizeSettings({ explorerDueDates: "on" as never }).explorerDueDates).toBe(false);
    expect(normalizeSettings({ explorerDueDates: true }).explorerDueDates).toBe(true);
  });

  it("reads the due-date property and its synonyms, schreibstubeDue by default", () => {
    expect(normalizeSettings({})).toMatchObject({
      dueProperty: "schreibstubeDue",
      dueSynonyms: []
    });
    expect(
      normalizeSettings({ dueProperty: " Zieldatum ", dueSynonyms: ["due", "Zieldatum", "due"] })
    ).toMatchObject({ dueProperty: "Zieldatum", dueSynonyms: ["due"] });
    expect(normalizeSettings({ dueProperty: "", dueSynonyms: "due" as never })).toMatchObject({
      dueProperty: "schreibstubeDue",
      dueSynonyms: ["due"]
    });
  });

  it("shows the Suggest tags control unless it was switched off", () => {
    expect(normalizeSettings({}).tagSuggestControl).toBe(true);
    expect(normalizeSettings({ tagSuggestControl: "no" as never }).tagSuggestControl).toBe(true);
    expect(normalizeSettings({ tagSuggestControl: false }).tagSuggestControl).toBe(false);
  });

  it("tidies done tasks to the back of their list unless another way was chosen", () => {
    expect(normalizeSettings({}).doneTasksMode).toBe("back");
    expect(normalizeSettings({ doneTasksMode: "archive" }).doneTasksMode).toBe("archive");
    expect(normalizeSettings({ doneTasksMode: "shred" as never }).doneTasksMode).toBe("back");
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

  it("starts sums automatic, without a currency, converting nothing", () => {
    expect(normalizeSettings({})).toMatchObject({
      sumsNumberStyle: "auto",
      sumsDefaultCurrency: "",
      sumsConvert: false,
      sumsRates: null
    });
  });

  it("keeps sums settings a person chose, and drops ones a hand edit broke", () => {
    const rates = { date: "2026-09-26", fetchedAt: 1, rates: { USD: 1.07 } };
    expect(
      normalizeSettings({
        sumsNumberStyle: "comma",
        sumsDefaultCurrency: "eur",
        sumsConvert: true,
        sumsRates: rates
      })
    ).toMatchObject({
      sumsNumberStyle: "comma",
      sumsDefaultCurrency: "EUR",
      sumsConvert: true,
      sumsRates: rates
    });
    expect(
      normalizeSettings({
        sumsNumberStyle: "roman",
        sumsDefaultCurrency: "DOGE",
        sumsConvert: "yes",
        sumsRates: { date: "today" }
      } as never)
    ).toMatchObject({
      sumsNumberStyle: "auto",
      sumsDefaultCurrency: "",
      sumsConvert: false,
      sumsRates: null
    });
  });

  it("defaults debugLogging to false", () => {
    expect(normalizeSettings({}).debugLogging).toBe(false);
  });

  it("preserves an explicit debugLogging=true", () => {
    expect(normalizeSettings({ debugLogging: true }).debugLogging).toBe(true);
  });

  it("clamps the rename limits into their range", () => {
    expect(normalizeSettings({ renameMinContentChars: 0 }).renameMinContentChars).toBe(
      MIN_RENAME_CONTENT_CHARS
    );
    expect(normalizeSettings({ renameMaxContentChars: -1 }).renameMaxContentChars).toBe(
      DEFAULT_SETTINGS.renameMinContentChars
    );
    expect(normalizeSettings({ renameMaxContentChars: 10_000_000 }).renameMaxContentChars).toBe(
      MAX_RENAME_CONTENT_CHARS
    );
    expect(normalizeSettings({ renameMaxFilenameLength: 0 }).renameMaxFilenameLength).toBe(
      MIN_FILENAME_LENGTH
    );
    expect(normalizeSettings({ renameMaxFilenameLength: 9999 }).renameMaxFilenameLength).toBe(
      MAX_FILENAME_LENGTH
    );
  });

  it("does not let the minimum content length exceed the maximum", () => {
    const settings = normalizeSettings({
      renameMinContentChars: 5000,
      renameMaxContentChars: 100
    });
    expect(settings.renameMinContentChars).toBe(5000);
    // Every note would otherwise be refused for being too short and then
    // truncated below that same floor.
    expect(settings.renameMaxContentChars).toBe(5000);
  });

  it("does not read a nulled or blank key as the number zero", () => {
    expect(
      normalizeSettings({ proofreadConcurrency: null as unknown as number }).proofreadConcurrency
    ).toBe(DEFAULT_SETTINGS.proofreadConcurrency);
    expect(
      normalizeSettings({ summarizeMaxTokens: "" as unknown as number }).summarizeMaxTokens
    ).toBe(DEFAULT_SETTINGS.summarizeMaxTokens);
    expect(
      normalizeSettings({ renameMaxImagePx: true as unknown as number }).renameMaxImagePx
    ).toBe(DEFAULT_SETTINGS.renameMaxImagePx);
    expect(normalizeSettings({ mailMaxResults: [] as unknown as number }).mailMaxResults).toBe(
      DEFAULT_SETTINGS.mailMaxResults
    );
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

  it("defaults the term folder to none, and trims its slashes", () => {
    expect(normalizeSettings({}).glossaryTermFolder).toBe("");
    expect(normalizeSettings({ glossaryTermFolder: " /Glossar/ " }).glossaryTermFolder).toBe(
      "Glossar"
    );
    expect(normalizeSettings({ glossaryTermFolder: 7 as never }).glossaryTermFolder).toBe("");
  });

  it("defaults the property set folder to none, and trims its slashes", () => {
    expect(normalizeSettings({}).propertySetFolder).toBe("");
    expect(normalizeSettings({ propertySetFolder: "/Vorlagen/Sets/" }).propertySetFolder).toBe(
      "Vorlagen/Sets"
    );
  });

  it("reads every folder setting as a vault folder, never the config folder or above", () => {
    const hostile = {
      imageDescriptionFolder: ".obsidian/plugins/x",
      printOutputFolder: "../outside",
      printTemplateRoot: ".obsidian",
      propertySetFolder: "Sets/../../x",
      glossaryTermFolder: "Glossar\\..",
      publishAccounts: [{ id: "a", name: "A", folder: ".obsidian", target: "blog" }]
    } as never;
    const settings = normalizeSettings(hostile);

    expect(settings.imageDescriptionFolder).toBe(DEFAULT_SETTINGS.imageDescriptionFolder);
    expect(settings.printOutputFolder).toBe("");
    expect(settings.printTemplateRoot).toBe(DEFAULT_SETTINGS.printTemplateRoot);
    expect(settings.propertySetFolder).toBe("");
    expect(settings.glossaryTermFolder).toBe("");
    expect(settings.publishAccounts).toEqual([]);
  });

  it("keeps an ordinary print folder and template root, slashes at the ends aside", () => {
    const settings = normalizeSettings({
      printOutputFolder: " /Ablage/PDF/ ",
      printTemplateRoot: "Vorlagen/Druck/"
    });
    expect(settings.printOutputFolder).toBe("Ablage/PDF");
    expect(settings.printTemplateRoot).toBe("Vorlagen/Druck");
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

  it("skips a record keyed like the object's own machinery", () => {
    const record = { hash: "abcd1234", etag: "", checkedAt: 1, pendingChanges: 0 };
    const raw = JSON.parse(
      `{"syncState": {"__proto__": ${JSON.stringify(record)}, "constructor": ${JSON.stringify(record)}},` +
        ` "publishLastRun": {"__proto__": {"at": "2026-09-01"}, "prototype": {"at": "2026-09-01"}}}`
    ) as Record<string, unknown>;
    const settings = normalizeSettings(raw as never);
    expect(Object.keys(settings.syncState)).toEqual([]);
    expect(Object.getPrototypeOf(settings.syncState)).toBe(Object.prototype);
    expect(Object.keys(settings.publishLastRun)).toEqual([]);
  });

  it("keeps a well-formed sync record", () => {
    const record = { hash: "abcd1234", etag: 'W/"x"', checkedAt: 42, pendingChanges: 2 };
    expect(normalizeSettings({ syncState: { "a.md": record } }).syncState["a.md"]).toEqual(record);
  });

  it("keeps the source a sync record was made against", () => {
    const record = {
      hash: "abcd1234",
      etag: "",
      checkedAt: 1,
      pendingChanges: 0,
      source: "https://example.com/a.md"
    };
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
      publishAccounts: [
        {
          id: "a",
          name: "Blog",
          folder: "Blog",
          target: "blog",
          writeBack: true,
          aiDescription: true,
          headerTags: []
        }
      ]
    }).publishAccounts;
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ name: "Blog", folder: "Blog", target: "blog" });
  });

  it("drops an account that cannot publish anything", () => {
    const accounts = normalizeSettings({
      publishAccounts: [
        {
          id: "a",
          name: "Ohne Ordner",
          folder: "",
          target: "blog",
          writeBack: true,
          aiDescription: true,
          headerTags: []
        },
        {
          id: "b",
          name: "Ohne Ziel",
          folder: "Blog",
          target: "",
          writeBack: true,
          aiDescription: true,
          headerTags: []
        }
      ]
    }).publishAccounts;
    expect(accounts).toEqual([]);
  });

  it("trims the slashes a folder is often typed with", () => {
    const accounts = normalizeSettings({
      publishAccounts: [
        {
          id: "a",
          name: "Blog",
          folder: "/Blog/",
          target: "blog",
          writeBack: true,
          aiDescription: true,
          headerTags: []
        }
      ]
    }).publishAccounts;
    expect(accounts[0]?.folder).toBe("Blog");
  });

  it("names an account after its folder when no name was given", () => {
    const accounts = normalizeSettings({
      publishAccounts: [
        {
          id: "a",
          name: "",
          folder: "Blog",
          target: "blog",
          writeBack: true,
          aiDescription: true,
          headerTags: []
        }
      ]
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

describe("printing is off until somebody says otherwise", () => {
  it("is off in a fresh vault", () => {
    expect(DEFAULT_SETTINGS.printEnabled).toBe(false);
  });

  it("stays off for a vault that has never heard of the setting", () => {
    expect(normalizeSettings({}).printEnabled).toBe(false);
  });

  it("is on only for the value that actually means yes", () => {
    expect(normalizeSettings({ printEnabled: true }).printEnabled).toBe(true);

    // Cast because the type says boolean and the file says whatever a person
    // typed into it. data.json is edited by hand, so "true" and 1 are exactly
    // the values that turn up, and neither should switch a download on.
    for (const nearly of ["true", 1, "yes", {}, null, [true]]) {
      const loaded = { printEnabled: nearly } as unknown as Parameters<typeof normalizeSettings>[0];
      expect(normalizeSettings(loaded).printEnabled).toBe(false);
    }
  });

  it("keeps property icons and a date format, dropping what is invalid", () => {
    const loaded = normalizeSettings({
      propertyIcons: { Status: "flag", broken: 7 } as unknown as Record<string, string>,
      dateFormat: " DD.MM.YYYY "
    });
    expect(loaded.propertyIcons).toEqual({ status: "flag" });
    expect(loaded.dateFormat).toBe("DD.MM.YYYY");
  });

  it("defaults property icons to none and the date format to ISO", () => {
    expect(normalizeSettings({})).toMatchObject({ propertyIcons: {}, dateFormat: "YYYY-MM-DD" });
  });
});

describe("icon shortcodes", () => {
  it("are on unless switched off, and a stray value does not switch them off", () => {
    expect(normalizeSettings({}).iconShortcodes).toBe(true);
    expect(normalizeSettings({ iconShortcodes: "off" as never }).iconShortcodes).toBe(true);
    expect(normalizeSettings({ iconShortcodes: false }).iconShortcodes).toBe(false);
  });
});

describe("a connection's header tags", () => {
  it("keeps up to three tags, read as tags, and gives an older connection none", () => {
    const [withTags, older] = normalizeSettings({
      publishAccounts: [
        {
          id: "a",
          name: "Blog",
          folder: "Blog",
          target: "blog",
          writeBack: true,
          aiDescription: true,
          headerTags: ["#essay", "essay", "reise", "projekt", "mehr"]
        },
        // Saved before connections had header tags.
        { id: "b", name: "Alt", folder: "Alt", target: "alt", writeBack: true } as never
      ]
    }).publishAccounts;
    expect(withTags?.headerTags).toEqual(["essay", "reise", "projekt"]);
    expect(older?.headerTags).toEqual([]);
  });
});

describe("settings an earlier version wrote", () => {
  const OLD = {
    explorerLatestEnabled: true,
    explorerLatestCount: 5,
    explorerLatestExcluded: "Privat"
  };

  it("leaves the former Latest section's settings out", () => {
    const settings = normalizeSettings(OLD as never) as unknown as Record<string, unknown>;

    for (const key of RETIRED_SETTING_KEYS) expect(key in settings).toBe(false);
  });

  it("asks for a save while the data file still holds one of them", () => {
    expect(holdsRetiredSettings(OLD)).toBe(true);
    expect(holdsRetiredSettings({ explorerLatestCount: 5 })).toBe(true);
  });

  it("asks for none once the data file is clean, or when there is none", () => {
    expect(holdsRetiredSettings(normalizeSettings(OLD as never))).toBe(false);
    expect(holdsRetiredSettings({})).toBe(false);
    expect(holdsRetiredSettings(null)).toBe(false);
    expect(holdsRetiredSettings("not an object")).toBe(false);
  });
});

describe("the default print template", () => {
  it("starts as the built-in one, for a vault that never chose", () => {
    expect(DEFAULT_SETTINGS.printDefaultTemplate).toBe("");
    expect(normalizeSettings({}).printDefaultTemplate).toBe("");
  });

  it("keeps a folder or the ask marker, trimmed", () => {
    expect(
      normalizeSettings({ printDefaultTemplate: " Vorlagen/Brief " }).printDefaultTemplate
    ).toBe("Vorlagen/Brief");
    expect(normalizeSettings({ printDefaultTemplate: ":ask" }).printDefaultTemplate).toBe(":ask");
  });

  it("falls back to the built-in one for a value that is not text", () => {
    const loaded = { printDefaultTemplate: 3 } as unknown as Parameters<
      typeof normalizeSettings
    >[0];
    expect(normalizeSettings(loaded).printDefaultTemplate).toBe("");
  });
});

describe("picture description settings", () => {
  it("are off, in their own folder, in the interface language, without tags by default", () => {
    const s = normalizeSettings({});
    expect(s.imageDescriptionsEnabled).toBe(false);
    expect(s.imageDescriptionFolder).toBe("Bildbeschreibungen");
    expect(s.imageDescriptionLanguage).toBe("auto");
    expect(s.imageDescriptionKeywordsAsTags).toBe(false);
  });

  it("switch on only for a real true, never for a truthy string", () => {
    expect(
      normalizeSettings({ imageDescriptionsEnabled: "yes" as unknown as boolean })
        .imageDescriptionsEnabled
    ).toBe(false);
    expect(normalizeSettings({ imageDescriptionsEnabled: true }).imageDescriptionsEnabled).toBe(
      true
    );
  });

  it("keep a language only when it is one they can write", () => {
    expect(
      normalizeSettings({ imageDescriptionLanguage: "fr" as never }).imageDescriptionLanguage
    ).toBe("auto");
    expect(normalizeSettings({ imageDescriptionLanguage: "en" }).imageDescriptionLanguage).toBe(
      "en"
    );
  });
});

describe("description notes in the Explorer", () => {
  it("leaves the retired switch for showing them behind", () => {
    // Retired: a description note is never a row of its own. A data.json
    // written before still carries the key, and it goes with the next save.
    expect(normalizeSettings({ explorerDescriptionNotes: "show" } as never)).not.toHaveProperty(
      "explorerDescriptionNotes"
    );
  });
});

describe("the answers given for other plugins' sources", () => {
  it("keep only a yes or no per plugin id, and start with none", () => {
    expect(normalizeSettings({}).semanticSources).toEqual({});
    expect({
      ...normalizeSettings({
        semanticSources: { pythia: true, reader: false, "No Id": true, other: "yes" } as never
      }).semanticSources
    }).toEqual({ pythia: true, reader: false });
  });
});
