import { App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type SchreibstubePlugin from "./main";
import type { LlmProvider, PublishAccount } from "./types";
import {
  DEFAULT_PUBLISH_KEYS,
  PUBLISH_KEY_ROLES,
  type PublishKeyMap
} from "./services/publish-index";
import { normalizeBaseUrl } from "./services/bridge-protocol";
import { checkTarget } from "./services/publish-client";
import { resolveApiKey } from "./services/secret";
import {
  DEFAULT_PROOFREAD_PROMPT,
  MAX_SYNC_INTERVAL_MINUTES,
  MIN_SYNC_INTERVAL_MINUTES,
  MAX_CHUNK_CHARS,
  MAX_CONCURRENCY,
  MAX_IMAGE_PX,
  MAX_MAIL_RESULTS,
  MAX_PROOFREAD_TOKENS,
  MAX_SUMMARY_TOKENS,
  MIN_CHUNK_CHARS,
  MIN_CONCURRENCY,
  MIN_IMAGE_PX,
  MIN_MAIL_RESULTS,
  MIN_PROOFREAD_TOKENS,
  MIN_SUMMARY_TOKENS,
  normalizeSettings
} from "./services/plugin-settings";
import { GLOSSARY_CHANGED_EVENT } from "./utils/constants";
import { CRON_PRESETS, nextRun, parseCron } from "./services/cron";
import { LLM_PROVIDER_IDS, PROVIDER_MODELS, providerLabel } from "./services/llm-providers";
import { MAX_DIM_OPACITY, MIN_DIM_OPACITY } from "./services/focus-settings";

export class SchreibstubeSettingTab extends PluginSettingTab {
  plugin: SchreibstubePlugin;

  constructor(app: App, plugin: SchreibstubePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * The cron field, with the parse result shown underneath.
   *
   * A schedule is easy to get subtly wrong and impossible to verify by waiting,
   * so the next fire time is displayed as soon as the expression is valid.
   */
  private renderPollSchedule(containerEl: HTMLElement): void {
    let feedback: HTMLElement | null = null;

    const describe = (expression: string): void => {
      if (!feedback) return;
      feedback.empty();

      const parsed = parseCron(expression);
      if (!parsed.ok) {
        feedback.addClass("schreibstube-setting-error");
        feedback.removeClass("schreibstube-setting-hint");
        feedback.setText(parsed.reason);
        return;
      }

      feedback.removeClass("schreibstube-setting-error");
      feedback.addClass("schreibstube-setting-hint");
      const next = nextRun(parsed.schedule, new Date());
      feedback.setText(
        next
          ? `Nächste Prüfung: ${next.toLocaleString()}`
          : "Gültig, aber dieser Zeitpunkt tritt nie ein."
      );
    };

    const examples = CRON_PRESETS.map((preset) => `${preset.expression} (${preset.label})`).join(
      ", "
    );

    new Setting(containerEl)
      .setName("Schedule")
      .setDesc(
        "Five cron fields: minute, hour, day of month, month, day of week. " +
          "Evaluated in local time. A schedule that came due while Obsidian was closed runs once on the next start. " +
          `Examples: ${examples}.`
      )
      .addText((text) => {
        text.setPlaceholder("0 * * * *");
        text.setValue(this.plugin.settings.syncPollCron);
        text.onChange(async (value) => {
          describe(value);
          const parsed = parseCron(value);
          if (!parsed.ok) return;
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            syncPollCron: value
          });
          await this.plugin.saveSettings();
        });
      });

    feedback = containerEl.createDiv({ cls: "schreibstube-setting-hint" });
    describe(this.plugin.settings.syncPollCron);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Heading stack").setHeading();

    new Setting(containerEl)
      .setName("Enable heading stack overlay")
      .setDesc("Show the sticky ancestor-heading breadcrumb at the top of the active note.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.overlayEnabled)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              overlayEnabled: value
            });
            await this.plugin.saveSettings();
            this.plugin.requestOverlayRefresh();
          });
      });

    new Setting(containerEl).setName("Focus mode").setHeading();

    new Setting(containerEl)
      .setName("Dim opacity")
      .setDesc("Opacity of out-of-focus lines in focus mode (0.2 = very faint, 0.8 = nearly full).")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_DIM_OPACITY, MAX_DIM_OPACITY, 0.05)
          .setValue(this.plugin.settings.focusDimOpacity)
          .onChange(async (value) => {
            await this.plugin.updateDimOpacity(value);
          });
      });

    new Setting(containerEl).setName("AI models").setHeading();

    new Setting(containerEl)
      .setDesc("Provider, model, and API key shared by every AI command (rename and summarize).");

    new Setting(containerEl)
      .setName("LLM provider")
      .addDropdown((dropdown) => {
        LLM_PROVIDER_IDS.forEach((id) => dropdown.addOption(id, providerLabel(id)));
        dropdown
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (value) => {
            const provider = value as LlmProvider;
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              llmProvider: provider,
              llmModel: PROVIDER_MODELS[provider][0].value,
              llmModelCustom: "",
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    const models = PROVIDER_MODELS[this.plugin.settings.llmProvider];
    new Setting(containerEl)
      .setName("Model")
      .addDropdown((dropdown) => {
        models.forEach((m) => dropdown.addOption(m.value, m.label));
        dropdown
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              llmModel: value,
              llmModelCustom: "",
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Custom model ID")
      .setDesc("Optional. Overrides the model above — use for a newer or unlisted model.")
      .addText((text) => {
        text.setPlaceholder("e.g. claude-3-7-sonnet-latest");
        text.setValue(this.plugin.settings.llmModelCustom);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            llmModelCustom: value,
          });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Select a secret from Obsidian's secret storage, or create a new one.")
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.llmSecretName)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              llmSecretName: value,
            });
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Rename file from content").setHeading();

    new Setting(containerEl)
      .setName("Max image size")
      .setDesc("Images are resized to this maximum dimension (px) before being sent. Smaller = cheaper and faster.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_IMAGE_PX, MAX_IMAGE_PX, 128)
          .setValue(this.plugin.settings.renameMaxImagePx)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameMaxImagePx: value,
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Minimum content length")
      .setDesc(
        "The rename command does nothing if the note has fewer characters than this."
      )
      .addText((text) => {
        text.setValue(String(this.plugin.settings.renameMinContentChars));
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.style.width = "80px";
        text.inputEl.addEventListener("blur", async () => {
          const n = parseInt(text.inputEl.value, 10);
          if (Number.isInteger(n) && n > 0) {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameMinContentChars: n,
            });
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Maximum content sent to LLM")
      .setDesc("Number of characters from the beginning of the note sent to the LLM.")
      .addText((text) => {
        text.setValue(String(this.plugin.settings.renameMaxContentChars));
        text.inputEl.type = "number";
        text.inputEl.min = "100";
        text.inputEl.style.width = "80px";
        text.inputEl.addEventListener("blur", async () => {
          const n = parseInt(text.inputEl.value, 10);
          if (Number.isInteger(n) && n > 0) {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameMaxContentChars: n,
            });
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Maximum filename length")
      .setDesc("Generated filename will be truncated to this many characters.")
      .addText((text) => {
        text.setValue(String(this.plugin.settings.renameMaxFilenameLength));
        text.inputEl.type = "number";
        text.inputEl.min = "10";
        text.inputEl.max = "255";
        text.inputEl.style.width = "80px";
        text.inputEl.addEventListener("blur", async () => {
          const n = parseInt(text.inputEl.value, 10);
          if (Number.isInteger(n) && n > 0) {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              renameMaxFilenameLength: n,
            });
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl).setName("Summarize selection").setHeading();

    new Setting(containerEl)
      .setDesc(
        "The Summarize selection command sends the selected text to the LLM and replaces it with the result. It uses the shared AI model configured above."
      );

    new Setting(containerEl)
      .setName("Summarize prompt")
      .setDesc("System instruction that tells the LLM how to summarize the selection. Leave blank to restore the default.")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.inputEl.style.width = "100%";
        text.setValue(this.plugin.settings.summarizePrompt);
        text.inputEl.addEventListener("blur", async () => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            summarizePrompt: text.inputEl.value,
          });
          await this.plugin.saveSettings();
          text.setValue(this.plugin.settings.summarizePrompt);
        });
      });

    new Setting(containerEl)
      .setName("Maximum response tokens")
      .setDesc(`Upper bound on the length of the generated summary (${MIN_SUMMARY_TOKENS}–${MAX_SUMMARY_TOKENS}).`)
      .addText((text) => {
        text.setValue(String(this.plugin.settings.summarizeMaxTokens));
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_SUMMARY_TOKENS);
        text.inputEl.max = String(MAX_SUMMARY_TOKENS);
        text.inputEl.style.width = "80px";
        text.inputEl.addEventListener("blur", async () => {
          const n = parseInt(text.inputEl.value, 10);
          if (Number.isInteger(n)) {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              summarizeMaxTokens: n,
            });
            await this.plugin.saveSettings();
            text.setValue(String(this.plugin.settings.summarizeMaxTokens));
          }
        });
      });

    new Setting(containerEl).setName("Proofreading").setHeading();

    new Setting(containerEl)
      .setDesc(
        "Used by the proof-read sidebar. Corrections are proposed one by one and applied only when you accept them."
      );

    new Setting(containerEl)
      .setName("Proofread prompt")
      .setDesc("System instruction for the correction pass. Leave empty to restore the default.")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text.setPlaceholder(DEFAULT_PROOFREAD_PROMPT);
        text.setValue(this.plugin.settings.proofreadPrompt);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            proofreadPrompt: value
          });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Maximum response tokens")
      .setDesc("Upper bound per request. The actual budget follows the size of each chunk.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_PROOFREAD_TOKENS, MAX_PROOFREAD_TOKENS, 256)
          .setValue(this.plugin.settings.proofreadMaxTokens)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              proofreadMaxTokens: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Characters per request")
      .setDesc("Smaller chunks show the first suggestions sooner but cost more requests.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_CHUNK_CHARS, MAX_CHUNK_CHARS, 250)
          .setValue(this.plugin.settings.proofreadChunkChars)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              proofreadChunkChars: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Parallel requests")
      .setDesc("How many chunks are in flight at once.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_CONCURRENCY, MAX_CONCURRENCY, 1)
          .setValue(this.plugin.settings.proofreadConcurrency)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              proofreadConcurrency: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Glossary").setHeading();

    new Setting(containerEl)
      .setDesc(
        "A glossary is a note with `schreibstubeGlossary: true` in its frontmatter and a term table. " +
          "Glossary checks run locally and need no API key. A note's own `schreibstubeGlossaries` property beats a folder rule, " +
          "which beats the pick in the sidebar, which beats the default below."
      );

    new Setting(containerEl)
      .setName("Default glossaries")
      .setDesc("Vault paths, one per line. Used when nothing more specific applies.")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.setPlaceholder("Glossare/Haus.md");
        text.setValue(this.plugin.settings.glossaryDefault.join("\n"));
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            glossaryDefault: value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
          });
          await this.plugin.saveSettings();
          window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
        });
      });

    new Setting(containerEl)
      .setName("Folder rules")
      .setDesc("One rule per line: folder | glossary.md, other.md. The deepest matching folder wins.")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text.setPlaceholder("Kunden | Glossare/Kunden.md");
        text.setValue(this.plugin.settings.glossaryFolderRules);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            glossaryFolderRules: value
          });
          await this.plugin.saveSettings();
          window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
        });
      });

    new Setting(containerEl)
      .setName("Underline glossary hits in the editor")
      .setDesc("Marks error-severity terms as you write. Off by default to keep long notes quiet.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.glossaryLiveUnderline)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              glossaryLiveUnderline: value
            });
            await this.plugin.saveSettings();
            window.dispatchEvent(new Event(GLOSSARY_CHANGED_EVENT));
          });
      });

    new Setting(containerEl).setName("Document sync").setHeading();

    new Setting(containerEl)
      .setDesc(
        "Bind a note to a remote Markdown file by adding `schreibstubeSyncedFrom: <url>` to its frontmatter. " +
          "The source is the single truth: incoming changes appear in the sidebar as cards you accept, and nothing " +
          "is ever pushed back. A note can live in any folder. If the source disappears, it is reported and the note " +
          "is left untouched."
      );

    new Setting(containerEl)
      .setName("Enable document sync")
      .setDesc("Off by default. Bound notes are ignored entirely until this is on.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.syncEnabled)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              syncEnabled: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Check when a bound note opens")
      .setDesc("Also check automatically on open, subject to the interval below. Otherwise only on command.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.syncCheckOnOpen)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              syncCheckOnOpen: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Minimum minutes between automatic checks")
      .setDesc("Per note. Zero checks on every open. A manual check always runs.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_SYNC_INTERVAL_MINUTES, MAX_SYNC_INTERVAL_MINUTES, 5)
          .setValue(this.plugin.settings.syncMinIntervalMinutes)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              syncMinIntervalMinutes: value
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("GitHub token")
      .setDesc(
        "Optional. Needed for sources in a private repository, and it raises GitHub's rate limit. " +
          "Stored in Obsidian's secret storage and only ever sent to GitHub."
      )
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.githubSecretName)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              githubSecretName: value
            });
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Poll all bound notes in the background")
      .setDesc(
        "Checks every bound note on a schedule, not just the one you have open. " +
          "Changes found are counted and surface as cards when you next open that note."
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.syncPollEnabled)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              syncPollEnabled: value
            });
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.syncPollEnabled) {
      this.renderPollSchedule(containerEl);
    }

    new Setting(containerEl).setName("Email").setHeading();

    new Setting(containerEl).setDesc(
      "Email runs through a small self-hosted bridge (see bridge/ in the repository), " +
        "which speaks IMAP and SMTP on the plugin's behalf. The bridge holds the mailbox " +
        "password; the plugin only stores the bridge token, so mail credentials never " +
        "enter the vault. This is also what makes the mail commands work on mobile."
    );

    new Setting(containerEl)
      .setName("Bridge URL")
      .setDesc("Base URL of your deployed bridge, e.g. https://mail-bridge.sliplane.app")
      .addText((text) => {
        text.setPlaceholder("https://…");
        text.setValue(this.plugin.settings.mailBridgeUrl);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            mailBridgeUrl: value,
          });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Bridge token")
      .setDesc("The BRIDGE_TOKEN configured on the bridge. Stored in Obsidian's secret storage.")
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.mailTokenSecretName)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              mailTokenSecretName: value,
            });
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("From address")
      .setDesc("Optional. Overrides the bridge's MAIL_FROM — use for a second identity.")
      .addText((text) => {
        text.setPlaceholder("Name <you@your-domain.de>");
        text.setValue(this.plugin.settings.mailFrom);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            mailFrom: value,
          });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Mailbox")
      .setDesc("IMAP mailbox searched by the query and reply commands.")
      .addText((text) => {
        text.setPlaceholder("INBOX");
        text.setValue(this.plugin.settings.mailMailbox);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            mailMailbox: value,
          });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Maximum results")
      .setDesc("Number of messages a search returns. Only the newest matches are kept.")
      .addSlider((slider) => {
        slider
          .setDynamicTooltip()
          .setLimits(MIN_MAIL_RESULTS, MAX_MAIL_RESULTS, 1)
          .setValue(this.plugin.settings.mailMaxResults)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              mailMaxResults: value,
            });
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Merge heading")
      .setDesc("Fetched replies are appended under this heading in the note.")
      .addText((text) => {
        text.setPlaceholder("Correspondence");
        text.setValue(this.plugin.settings.mailMergeHeading);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            mailMergeHeading: value,
          });
          await this.plugin.saveSettings();
        });
      });

    this.renderPublish(containerEl);

    new Setting(containerEl).setName("Diagnostics").setHeading();

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Log detailed diagnostics to the developer console (Ctrl/Cmd+Shift+I). Errors are always logged; enable this to trace what the plugin is doing.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.debugLogging)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              debugLogging: value,
            });
            await this.plugin.saveSettings();
          });
      });
  }

  /**
   * Publishing.
   *
   * The hosting credentials live on the bridge, so an account here is only a
   * folder, the name of a target the bridge already knows, and what to call the
   * site. Adding a target is a redeploy of the bridge, which is the price of
   * keeping an SSH key out of the vault.
   */
  private renderPublish(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Veröffentlichen").setHeading();

    new Setting(containerEl).setDesc(
      "Ein Ordner des Vaults wird als Website veröffentlicht. Nur Notizen mit " +
        "`schreibstubePublished: true` im Frontmatter werden übertragen. Die Bridge rendert " +
        "das Markdown und schreibt es per SFTP — die Zugangsdaten des Webspace liegen dort, " +
        "nicht im Vault. Deshalb funktioniert das Veröffentlichen auch mobil."
    );

    new Setting(containerEl)
      .setName("Bridge-URL")
      .setDesc("Leer lassen, wenn dieselbe Bridge wie für E-Mail genutzt wird.")
      .addText((text) => {
        text.setPlaceholder(this.plugin.settings.mailBridgeUrl || "https://…");
        text.setValue(this.plugin.settings.publishBridgeUrl);
        text.onChange(async (value) => {
          this.plugin.settings = normalizeSettings({
            ...this.plugin.settings,
            publishBridgeUrl: value,
          });
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Publish-Token")
      .setDesc(
        "Der PUBLISH_TOKEN der Bridge — bewusst ein anderer als der Mail-Token, damit ein " +
          "verlorenes Token nicht beides öffnet. Liegt in Obsidians Secret Storage."
      )
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.publishTokenSecretName)
          .onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              publishTokenSecretName: value,
            });
            await this.plugin.saveSettings();
          })
      );

    for (const [position, account] of this.plugin.settings.publishAccounts.entries()) {
      this.renderPublishAccount(containerEl, position, account);
    }

    new Setting(containerEl).addButton((button) =>
      button.setButtonText("Konto hinzufügen").onClick(async () => {
        await this.savePublishAccounts([
          ...this.plugin.settings.publishAccounts,
          {
            id: `konto-${Date.now()}`,
            name: "Website",
            folder: "",
            target: "",
            writeBack: true
          }
        ]);
      })
    );

    this.renderPublishKeys(containerEl);
  }

  /**
   * Which frontmatter key carries which meaning.
   *
   * A vault that already names these fields its own way should not have to
   * rename them, so each role is a field here. A blank field means "unchanged",
   * and two roles cannot share a key — the plugin would have no way to tell
   * which meaning was intended.
   */
  private renderPublishKeys(containerEl: HTMLElement): void {
    const labels: Record<keyof PublishKeyMap, string> = {
      published: "Veröffentlichen (ja/nein)",
      title: "Titel",
      date: "Datum",
      description: "Beschreibung",
      slug: "Adresse (Slug)",
      publishedAt: "Veröffentlicht am (wird geschrieben)",
      publishedUrl: "Veröffentlicht unter (wird geschrieben)"
    };

    new Setting(containerEl)
      .setName("Frontmatter-Felder")
      .setDesc(
        "Welcher Frontmatter-Schlüssel welche Bedeutung hat. Leer lassen, um den Standard zu " +
          "behalten. Ein geänderter Schlüssel ersetzt den Standard: Notizen mit dem alten Namen " +
          "werden dann nicht mehr erkannt."
      );

    for (const role of PUBLISH_KEY_ROLES) {
      new Setting(containerEl)
        .setName(labels[role])
        .addText((text) => {
          text.setPlaceholder(DEFAULT_PUBLISH_KEYS[role]);
          text.setValue(this.plugin.settings.publishFrontmatterKeys[role]);
          text.onChange(async (value) => {
            this.plugin.settings = normalizeSettings({
              ...this.plugin.settings,
              publishFrontmatterKeys: {
                ...this.plugin.settings.publishFrontmatterKeys,
                [role]: value
              },
            });
            await this.plugin.saveSettings();
          });
        });
    }
  }

  private renderPublishAccount(
    containerEl: HTMLElement,
    position: number,
    account: PublishAccount
  ): void {
    const update = async (changes: Partial<PublishAccount>): Promise<void> => {
      const accounts = [...this.plugin.settings.publishAccounts];
      accounts[position] = { ...accounts[position], ...changes };
      await this.savePublishAccounts(accounts, { redraw: false });
    };

    new Setting(containerEl)
      .setName(account.name || "Website")
      .setDesc("Name der Website, Ordner im Vault und Ziel auf der Bridge.")
      .addText((text) =>
        text
          .setPlaceholder("Name")
          .setValue(account.name)
          .onChange((value) => void update({ name: value }))
      )
      .addText((text) =>
        text
          .setPlaceholder("Ordner")
          .setValue(account.folder)
          .onChange((value) => void update({ folder: value }))
      )
      .addText((text) =>
        text
          .setPlaceholder("Ziel")
          .setValue(account.target)
          .onChange((value) => void update({ target: value }))
      );

    new Setting(containerEl)
      .setName("Veröffentlichung in die Notiz schreiben")
      .setDesc("Trägt Zeitpunkt und Adresse nach dem Veröffentlichen ins Frontmatter ein.")
      .addToggle((toggle) =>
        toggle.setValue(account.writeBack).onChange((value) => void update({ writeBack: value }))
      )
      .addButton((button) =>
        button.setButtonText("Verbindung testen").onClick(async () => {
          await this.testPublishTarget(account);
        })
      )
      .addButton((button) =>
        button
          .setButtonText("Entfernen")
          .setWarning()
          .onClick(async () => {
            const accounts = this.plugin.settings.publishAccounts.filter(
              (_, index) => index !== position
            );
            await this.savePublishAccounts(accounts);
          })
      );
  }

  private async savePublishAccounts(
    accounts: PublishAccount[],
    { redraw = true }: { redraw?: boolean } = {}
  ): Promise<void> {
    // An incomplete account is kept here but dropped by normalisation on load,
    // so a half-typed entry does not vanish under the cursor.
    this.plugin.settings = { ...this.plugin.settings, publishAccounts: accounts };
    await this.plugin.saveSettings();
    if (redraw) this.display();
  }

  /**
   * Prove the whole path in one request: token, target, SSH login, host key and
   * root directory, without writing anything.
   */
  private async testPublishTarget(account: PublishAccount): Promise<void> {
    const settings = this.plugin.settings;
    const url = normalizeBaseUrl(settings.publishBridgeUrl || settings.mailBridgeUrl);
    if (!url.ok) {
      new Notice(`Schreibstube: ${url.message}`);
      return;
    }

    const token = resolveApiKey(
      this.app.secretStorage,
      settings.publishTokenSecretName,
      "Publish-Token"
    );
    if (!token.ok) {
      new Notice(token.message);
      return;
    }

    try {
      const result = await checkTarget({ baseUrl: url.url, token: token.apiKey }, account.target);
      new Notice(
        result.ok
          ? `Schreibstube: Verbindung zu ${account.target} steht (${result.entries ?? 0} Einträge).`
          : `Schreibstube: ${result.error ?? "Verbindung fehlgeschlagen."}`
      );
    } catch (error) {
      new Notice(`Schreibstube: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
