/**
 * Publishing: the bridge, the accounts, the frontmatter mapping, and what each
 * account last did.
 *
 * The hosting credentials live on the bridge, so an account here is only a
 * folder, a target the bridge already knows, and what to call the site. Adding
 * a target is a redeploy of the bridge, which is the price of keeping an SSH
 * key out of the vault — so this section also generates the block to paste
 * there.
 */
import { Notice, SecretComponent, Setting, TFolder } from "obsidian";
import { t } from "../i18n";
import type { PublishAccount } from "../types";
import {
  DEFAULT_PUBLISH_KEYS,
  MAX_HEADER_TAGS,
  normalizeHeaderTags,
  readLanguageField,
  PUBLISH_KEY_ROLES,
  type PublishKeyMap
} from "../services/publish-index";
import { normalizeBaseUrl } from "../services/bridge-protocol";
import {
  accountProblems,
  bridgeEnvironment,
  isKept,
  STARTER_TOKEN_BYTES,
  starterEnvironment,
  tokenFromBytes,
  type AccountProblem
} from "../services/publish-accounts";
import { normalizeVaultFolder } from "../services/file-name";
import { DESCRIPTION_TIMEOUT_MS } from "../services/publish-description";
import { createLogger } from "../services/logger";
import { checkTarget, listTargets } from "../platform/publish-client";
import type { PublishBridgeConfig, PublishTarget } from "../services/publish-protocol";
import { resolveApiKey } from "../services/secret";
import { confirmBridge } from "../controllers/bridge-trust";
import type { SettingsContext } from "./context";
import { fold, markAi, section } from "./layout";

/**
 * Targets the bridge offered, for as long as the settings tab stays open.
 *
 * A target name has to match what the bridge was configured with, and a typo
 * fails at publish time rather than here. Asking the bridge is one request and
 * turns the field into a list of the right answers.
 */
let knownTargets: PublishTarget[] | null = null;

export function renderPublish(ctx: SettingsContext): void {
  const { containerEl } = ctx;

  section(ctx, {
    name: t().publish.heading,
    desc: t().publish.intro,
    commands: [t().commands.publish],
    indexed: true
  });

  new Setting(containerEl)
    .setName(t().publish.bridgeUrl)
    .setDesc(t().publish.bridgeUrlDesc)
    .addText((text) => {
      text.setPlaceholder(ctx.plugin.settings.mailBridgeUrl || "https://…");
      text.setValue(ctx.plugin.settings.publishBridgeUrl);
      text.onChange(async (value) => {
        await ctx.update({ publishBridgeUrl: value });
      });
    });

  // Loading the targets sits with the token, not with a site: it is what a
  // person needs before the first site, and it proves the token on its own.
  new Setting(containerEl)
    .setName(t().publish.token)
    .setDesc(t().publish.tokenDesc)
    .addComponent((el) =>
      new SecretComponent(ctx.app, el)
        .setValue(ctx.plugin.settings.publishTokenSecretName)
        .onChange(async (value) => {
          // A cleared secret arrives as null; an empty name is how settings say none.
          await ctx.update({ publishTokenSecretName: value ?? "" });
        })
    )
    .addButton((button) =>
      button.setButtonText(t().publish.loadTargets).onClick(async () => {
        await loadTargets(ctx);
      })
    );

  const accounts = ctx.plugin.settings.publishAccounts;
  new Setting(containerEl)
    .setName(t().publish.accounts)
    .setDesc(t().publish.accountsSummary(accounts.length))
    .setHeading();
  for (const [position, account] of accounts.entries()) {
    renderAccount(ctx, position, account);
  }

  new Setting(containerEl)
    .setName(t().publish.addAccount)
    .setDesc(t().publish.addAccountDesc)
    .addButton((button) =>
      button.setButtonText(t().publish.addAccount).onClick(async () => {
        const id = `account-${Date.now()}`;
        opened.add(id);
        await saveAccounts(ctx, [
          ...ctx.plugin.settings.publishAccounts,
          {
            id,
            name: t().publish.newAccountName,
            folder: "",
            target: "",
            writeBack: true,
            aiDescription: true,
            headerTags: []
          }
        ]);
      })
    );

  renderSetup(ctx);

  new Setting(containerEl)
    .setName(t().publish.openSite)
    .setDesc(t().publish.openSiteDesc)
    .addButton((button) =>
      button.setButtonText(t().publish.openSiteButton).onClick(() => {
        void ctx.plugin.openPublishedSite();
      })
    );

  renderKeys(ctx);
}

/**
 * Sites opened in this settings tab, so a redraw — a test, a removal, another
 * site added — does not fold away the one being filled in.
 */
const opened = new Set<string>();

/**
 * One site, folded under a line that says what it is and whether it is ready.
 *
 * Drawn flat, two sites were twenty rows of equal look with nothing to say
 * where one ended; and an incomplete one, which the next load drops, looked
 * the same as a working one.
 */
function renderAccount(ctx: SettingsContext, position: number, account: PublishAccount): void {
  // The fields save without redrawing, so `account` is the one the rows were
  // drawn from: a test taken from it went to the target that was there before
  // the one just typed.
  const current = (): PublishAccount => ctx.plugin.settings.publishAccounts[position] ?? account;

  const details = ctx.containerEl.createEl("details", {
    cls: "schreibstube-settings-fold schreibstube-publish-site"
  });
  const summary = details.createEl("summary", { cls: "schreibstube-settings-fold-summary" });
  const title = summary.createSpan({ cls: "schreibstube-settings-fold-name" });
  const route = summary.createSpan({ cls: "schreibstube-settings-fold-desc" });
  const status = summary.createSpan({ cls: "schreibstube-publish-site-status" });
  const body = details.createDiv({ cls: "schreibstube-settings-fold-body" });
  const problemsEl = body.createDiv({
    cls: "setting-item-description schreibstube-settings-intro schreibstube-publish-site-problems"
  });
  const inner: SettingsContext = { ...ctx, containerEl: body };

  const showStatus = (): boolean => {
    const site = current();
    const problems = accountProblems(site, ctx.plugin.settings.publishAccounts, (folder) =>
      folderExists(ctx, folder)
    );
    const kept = isKept(problems);
    title.setText(site.name.trim() || t().publish.newAccountName);
    route.setText(`${site.folder.trim() || "…"} → ${site.target.trim() || "…"}`);
    status.setText(
      !kept
        ? t().publish.statusNotKept
        : problems.length > 0
          ? t().publish.statusProblems(problems.length)
          : t().publish.statusOk
    );
    status.toggleClass("is-warning", problems.length > 0);

    problemsEl.empty();
    for (const problem of problems) problemsEl.createDiv({ text: problemText(problem, site) });
    if (!kept) problemsEl.createDiv({ text: t().publish.problemNotKept });
    problemsEl.toggleClass("is-hidden", problems.length === 0);
    return problems.length > 0;
  };

  const update = async (changes: Partial<PublishAccount>): Promise<void> => {
    const accounts = [...ctx.plugin.settings.publishAccounts];
    accounts[position] = { ...current(), ...changes };
    await saveAccounts(ctx, accounts, { redraw: false });
    showStatus();
  };

  const troubled = showStatus();
  // A lone site has nothing to be told apart from, and one with something to
  // check should not wait to be opened.
  details.open =
    troubled || opened.has(account.id) || ctx.plugin.settings.publishAccounts.length === 1;
  details.addEventListener("toggle", () => {
    if (details.open) opened.add(account.id);
    else opened.delete(account.id);
  });

  new Setting(body)
    .setName(t().publish.accountName)
    .setDesc(t().publish.accountNameDesc)
    .addText((text) =>
      text
        .setPlaceholder(t().publish.newAccountName)
        .setValue(account.name)
        .onChange((value) => void update({ name: value }))
    );

  new Setting(body)
    .setName(t().publish.accountFolder)
    .setDesc(t().publish.accountFolderDesc)
    .addText((text) =>
      text
        .setPlaceholder(t().publish.accountFolder)
        .setValue(account.folder)
        .onChange((value) => void update({ folder: value }))
    );

  // A dropdown once the bridge has been asked, a plain field until then, so the
  // section stays usable before a token is configured.
  const target = new Setting(body)
    .setName(t().publish.accountTarget)
    .setDesc(t().publish.accountTargetDesc);
  const targets = knownTargets;
  if (targets && targets.length > 0) {
    target.addDropdown((dropdown) => {
      if (!targets.some((known) => known.name === account.target)) {
        dropdown.addOption(account.target, account.target || t().publish.targetPlaceholder);
      }
      for (const known of targets) {
        dropdown.addOption(known.name, `${known.name} — ${known.baseUrl}`);
      }
      dropdown.setValue(account.target).onChange((value) => void update({ target: value }));
    });
  } else {
    target.addText((text) =>
      text
        .setPlaceholder(t().publish.targetPlaceholder)
        .setValue(account.target)
        .onChange((value) => void update({ target: value }))
    );
  }

  // Three fields rather than one list to type into: the header holds three,
  // and a field per tag says so without a word of explanation.
  const headerTags = [...account.headerTags];
  const tagSetting = new Setting(body)
    .setName(t().publish.headerTags)
    .setDesc(t().publish.headerTagsDesc);
  for (let slot = 0; slot < MAX_HEADER_TAGS; slot++) {
    tagSetting.addText((text) =>
      text
        .setPlaceholder(t().publish.headerTagPlaceholder)
        .setValue(headerTags[slot] ? `#${headerTags[slot]}` : "")
        .onChange((value) => {
          headerTags[slot] = value;
          void update({ headerTags: normalizeHeaderTags(headerTags) });
        })
    );
  }

  new Setting(body)
    .setName(t().publish.language)
    .setDesc(t().publish.languageDesc)
    .addText((text) => {
      text.setPlaceholder("de").setValue(account.language ?? "");
      // Saved when the field is left rather than on every key: a word typed
      // out passes through prefixes that are tags of their own — "Deu" on the
      // way to "Deutsch" — and the last of them would have been kept unsaid.
      text.inputEl.addEventListener("change", () => {
        const language = readLanguageField(text.inputEl.value);
        if (language !== null) {
          void update({ language });
          return;
        }
        new Notice(t().common.notice(t().publish.languageInvalid(text.inputEl.value.trim())));
        text.setValue(ctx.plugin.settings.publishAccounts[position]?.language ?? "");
      });
    });

  const ai = ctx.plugin.aiReady();
  const describe = new Setting(body)
    .setName(t().publish.aiDescription)
    .setDesc(
      ai ? t().publish.aiDescriptionDesc(DESCRIPTION_TIMEOUT_MS / 1000) : t().settings.needsAiKey
    )
    .addToggle((toggle) =>
      toggle
        .setDisabled(!ai)
        .setValue(account.aiDescription)
        .onChange((value) => void update({ aiDescription: value }))
    );
  markAi(describe, ai);

  new Setting(body)
    .setName(t().publish.writeBack)
    .setDesc(t().publish.writeBackDesc)
    .addToggle((toggle) =>
      toggle.setValue(account.writeBack).onChange((value) => void update({ writeBack: value }))
    );

  renderLastRun(inner, account);

  new Setting(body)
    .setName(t().publish.checkSite)
    .setDesc(t().publish.checkSiteDesc)
    .addButton((button) =>
      button.setButtonText(t().common.testConnection).onClick(async () => {
        await testTarget(ctx, current());
      })
    )
    .addButton((button) =>
      button
        .setButtonText(t().common.remove)
        .setWarning()
        .onClick(async () => {
          const accounts = ctx.plugin.settings.publishAccounts.filter(
            (_, index) => index !== position
          );
          opened.delete(account.id);
          await saveAccounts(ctx, accounts);
        })
    );
}

function problemText(problem: AccountProblem, site: PublishAccount): string {
  const words = t().publish;
  switch (problem.kind) {
    case "noFolder":
      return words.problemNoFolder;
    case "noTarget":
      return words.problemNoTarget;
    case "folderMissing":
      return words.problemFolderMissing(site.folder.trim());
    case "badTarget":
      return words.problemBadTarget(site.target.trim());
    case "sameTarget":
      return words.problemSameTarget(problem.other);
    case "sameFolder":
      return words.problemSameFolder(problem.other);
    case "insideFolder":
      return words.problemInsideFolder(problem.other);
    case "holdsFolder":
      return words.problemHoldsFolder(problem.other);
  }
}

function folderExists(ctx: SettingsContext, folder: string): boolean {
  const normalized = normalizeVaultFolder(folder);
  if (!normalized) return false;
  return ctx.app.vault.getAbstractFileByPath(normalized) instanceof TFolder;
}

/**
 * What this account last did, and when.
 *
 * A publish is the one command whose result nobody sees twice: the notice is
 * gone in seconds and the site is somewhere else. The last summary here answers
 * "did that go through" without opening a console.
 */
function renderLastRun(ctx: SettingsContext, account: PublishAccount): void {
  const record = ctx.plugin.settings.publishLastRun[account.id];

  new Setting(ctx.containerEl)
    .setName(t().publish.lastRun)
    .setDesc(
      record
        ? t().publish.lastRunSummary(
            new Date(record.at).toLocaleString(),
            record.written,
            record.deleted
          )
        : t().publish.lastRunNever
    );
}

/** The secret a starter set saves a new token under, when none is named yet. */
const STARTER_SECRET = "schreibstube-publish-token";

/**
 * The bridge's configuration, ready to paste: the starter set for a new
 * deployment, or the site blocks alone for one already running.
 */
function renderSetup(ctx: SettingsContext): void {
  new Setting(ctx.containerEl)
    .setName(t().publish.setup)
    .setDesc(t().publish.setupDesc)
    .addButton((button) =>
      button
        .setButtonText(t().publish.setupStarter)
        .setCta()
        .onClick(async () => {
          const { secret, token, created } = await starterToken(ctx);
          const copied = await copy(
            ctx,
            starterEnvironment(
              ctx.plugin.settings.publishAccounts,
              t().publish.newAccountName,
              token
            )
          );
          if (copied) new Notice(t().common.notice(t().publish.starterCopied(secret, created)));
          if (created) ctx.refresh();
        })
    )
    .addButton((button) =>
      button.setButtonText(t().publish.setupCopy).onClick(async () => {
        const copied = await copy(
          ctx,
          bridgeEnvironment(ctx.plugin.settings.publishAccounts, t().publish.newAccountName)
        );
        if (copied) new Notice(t().common.notice(t().common.copied));
      })
    );
}

/**
 * The publish token for a starter set: the one this device holds, or a new
 * one saved before it is copied, so the plugin and the bridge it is pasted
 * into hold the same token without a second step. A token already stored is
 * never replaced: the bridge running with it would stop answering.
 */
async function starterToken(
  ctx: SettingsContext
): Promise<{ secret: string; token: string; created: boolean }> {
  const storage = ctx.app.secretStorage;
  const secret = ctx.plugin.settings.publishTokenSecretName || STARTER_SECRET;
  const stored = storage.getSecret(secret)?.trim();
  if (!ctx.plugin.settings.publishTokenSecretName) {
    await ctx.update({ publishTokenSecretName: secret });
  }
  if (stored) return { secret, token: stored, created: false };

  const token = tokenFromBytes(crypto.getRandomValues(new Uint8Array(STARTER_TOKEN_BYTES)));
  storage.setSecret(secret, token);
  return { secret, token, created: true };
}

async function copy(ctx: SettingsContext, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    createLogger(() => ctx.plugin.settings.debugLogging).warn(
      "Could not copy the bridge setup to the clipboard:",
      error
    );
    new Notice(t().common.notice(t().explorer.bookmarks.copyFailed));
    return false;
  }
}

/**
 * Which frontmatter key carries which meaning.
 *
 * A vault that already names these fields its own way should not have to
 * rename them, so each role is a field here. A blank field means "unchanged",
 * and two roles cannot share a key — the plugin would have no way to tell which
 * meaning was intended.
 */
function renderKeys(ctx: SettingsContext): void {
  const labels: Record<keyof PublishKeyMap, string> = {
    published: t().publish.keyPublished,
    title: t().publish.keyTitle,
    date: t().publish.keyDate,
    description: t().publish.keyDescription,
    slug: t().publish.keySlug,
    language: t().publish.keyLanguage,
    publishedAt: t().publish.keyPublishedAt,
    publishedUrl: t().publish.keyPublishedUrl
  };

  // Most vaults never rename these; folded, they are one line rather than seven.
  const keys = fold(ctx, t().publish.keysHeading, t().publish.keysDesc);
  for (const role of PUBLISH_KEY_ROLES) {
    new Setting(keys.containerEl)
      .setName(labels[role])
      .setDesc(t().publish.keyRoleDesc(DEFAULT_PUBLISH_KEYS[role]))
      .addText((text) => {
        text.setPlaceholder(DEFAULT_PUBLISH_KEYS[role]);
        text.setValue(ctx.plugin.settings.publishFrontmatterKeys[role]);
        text.onChange(async (value) => {
          await ctx.update({
            publishFrontmatterKeys: {
              ...ctx.plugin.settings.publishFrontmatterKeys,
              [role]: value
            }
          });
        });
      });
  }
}

async function saveAccounts(
  ctx: SettingsContext,
  accounts: PublishAccount[],
  { redraw = true }: { redraw?: boolean } = {}
): Promise<void> {
  // An incomplete account is kept here but dropped by normalisation on load, so
  // a half-typed entry does not vanish under the cursor.
  ctx.plugin.settings = { ...ctx.plugin.settings, publishAccounts: accounts };
  await ctx.plugin.saveSettings();
  if (redraw) ctx.refresh();
}

/** Ask the bridge which targets it has, and turn every target field into a list of them. */
async function loadTargets(ctx: SettingsContext): Promise<void> {
  const bridge = await resolveBridge(ctx);
  if (!bridge) return;

  try {
    knownTargets = await listTargets(bridge);
    new Notice(
      t().common.notice(t().publish.targetsLoaded(knownTargets.map((target) => target.name)))
    );
    ctx.refresh();
  } catch (error) {
    new Notice(t().common.notice(error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Prove the whole path in one request: token, target, SSH login, host key and
 * root directory, without writing anything.
 *
 * The same click fetches the bridge's targets, so a successful test turns the
 * target field into a list.
 */
async function testTarget(ctx: SettingsContext, account: PublishAccount): Promise<void> {
  const bridge = await resolveBridge(ctx);
  if (!bridge) return;

  try {
    knownTargets = await listTargets(bridge);
    const result = await checkTarget(bridge, account.target);
    new Notice(
      t().common.notice(
        result.ok
          ? t().publish.connectionOk(account.target, result.entries ?? 0)
          : t().publish.connectionFailed(result.error ?? "")
      )
    );
    ctx.refresh();
  } catch (error) {
    new Notice(t().common.notice(error instanceof Error ? error.message : String(error)));
  }
}

async function resolveBridge(ctx: SettingsContext): Promise<PublishBridgeConfig | null> {
  const settings = ctx.plugin.settings;
  const url = normalizeBaseUrl(settings.publishBridgeUrl || settings.mailBridgeUrl);
  if (!url.ok) {
    new Notice(t().common.notice(url.message));
    return null;
  }

  const token = resolveApiKey(
    ctx.app.secretStorage,
    settings.publishTokenSecretName,
    t().secrets.publishToken
  );
  if (!token.ok) {
    new Notice(token.message);
    return null;
  }

  // The test sends the token as a publish would, so it asks as a publish would.
  if (!(await confirmBridge(ctx.app, "publish", url.url))) {
    new Notice(t().common.notice(t().bridgeTrust.declined));
    return null;
  }
  return { baseUrl: url.url, token: token.apiKey };
}
