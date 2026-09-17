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
import { Notice, SecretComponent, Setting } from "obsidian";
import { t } from "../i18n";
import type { PublishAccount } from "../types";
import {
  DEFAULT_PUBLISH_KEYS,
  PUBLISH_KEY_ROLES,
  type PublishKeyMap
} from "../services/publish-index";
import { normalizeBaseUrl } from "../services/bridge-protocol";
import { checkTarget, listTargets } from "../services/publish-client";
import type { PublishBridgeConfig, PublishTarget } from "../services/publish-protocol";
import { resolveApiKey } from "../services/secret";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

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

  new Setting(containerEl).setName(t().publish.heading).setHeading();
  new Setting(containerEl).setDesc(t().publish.intro);

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

  new Setting(containerEl)
    .setName(t().publish.token)
    .setDesc(t().publish.tokenDesc)
    .addComponent((el) =>
      new SecretComponent(ctx.app, el)
        .setValue(ctx.plugin.settings.publishTokenSecretName)
        .onChange(async (value) => {
          await ctx.update({ publishTokenSecretName: value });
        })
    );

  for (const [position, account] of ctx.plugin.settings.publishAccounts.entries()) {
    renderAccount(ctx, position, account);
  }

  new Setting(containerEl).addButton((button) =>
    button.setButtonText(t().publish.addAccount).onClick(async () => {
      await saveAccounts(ctx, [
        ...ctx.plugin.settings.publishAccounts,
        {
          id: `account-${Date.now()}`,
          name: t().publish.newAccountName,
          folder: "",
          target: "",
          writeBack: true
        }
      ]);
    })
  );

  new Setting(containerEl)
    .setName(t().publish.openSite)
    .setDesc(t().publish.openSiteDesc)
    .addButton((button) =>
      button.setButtonText(t().publish.openSiteButton).onClick(() => {
        void ctx.plugin.openPublishedSite();
      })
    );

  renderKeys(ctx);

  renderCommands(ctx, [t().commands.publish]);
}

function renderAccount(ctx: SettingsContext, position: number, account: PublishAccount): void {
  const { containerEl } = ctx;

  const update = async (changes: Partial<PublishAccount>): Promise<void> => {
    const accounts = [...ctx.plugin.settings.publishAccounts];
    accounts[position] = { ...(accounts[position] ?? account), ...changes };
    await saveAccounts(ctx, accounts, { redraw: false });
  };

  const identity = new Setting(containerEl)
    .setName(account.name || t().publish.accountName)
    .setDesc(t().publish.accountDesc)
    .addText((text) =>
      text
        .setPlaceholder(t().publish.accountName)
        .setValue(account.name)
        .onChange((value) => void update({ name: value }))
    )
    .addText((text) =>
      text
        .setPlaceholder(t().publish.accountFolder)
        .setValue(account.folder)
        .onChange((value) => void update({ folder: value }))
    );

  // A dropdown once the bridge has been asked, a plain field until then, so the
  // section stays usable before a token is configured.
  const targets = knownTargets;
  if (targets && targets.length > 0) {
    identity.addDropdown((dropdown) => {
      if (!targets.some((target) => target.name === account.target)) {
        dropdown.addOption(account.target, account.target || t().publish.targetPlaceholder);
      }
      for (const target of targets) {
        dropdown.addOption(target.name, `${target.name} — ${target.baseUrl}`);
      }
      dropdown.setValue(account.target).onChange((value) => void update({ target: value }));
    });
  } else {
    identity.addText((text) =>
      text
        .setPlaceholder(t().publish.accountTarget)
        .setValue(account.target)
        .onChange((value) => void update({ target: value }))
    );
  }

  new Setting(containerEl)
    .setName(t().publish.writeBack)
    .setDesc(t().publish.writeBackDesc)
    .addToggle((toggle) =>
      toggle.setValue(account.writeBack).onChange((value) => void update({ writeBack: value }))
    )
    .addButton((button) =>
      button.setButtonText(t().common.testConnection).onClick(async () => {
        await testTarget(ctx, account);
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
          await saveAccounts(ctx, accounts);
        })
    );

  renderLastRun(ctx, account);
  renderSetup(ctx, account);
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

/** The environment block for this account, ready to paste into the bridge. */
function renderSetup(ctx: SettingsContext, account: PublishAccount): void {
  new Setting(ctx.containerEl)
    .setName(t().publish.setup)
    .setDesc(t().publish.setupDesc)
    .addButton((button) =>
      button.setButtonText(t().publish.setupCopy).onClick(async () => {
        await navigator.clipboard.writeText(environmentBlock(account));
        new Notice(t().common.notice(t().common.copied));
      })
    );
}

/**
 * The half of the bridge's configuration the vault knows.
 *
 * Host, user and credentials are left blank on purpose: they belong to whoever
 * deploys the bridge, and a plausible-looking placeholder would be worse than
 * an obviously empty one.
 */
export function environmentBlock(account: PublishAccount): string {
  const target = account.target || "blog";
  const prefix = `PUBLISH_${target.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

  return [
    `PUBLISH_TARGETS=${target}`,
    `${prefix}_HOST=`,
    `${prefix}_PORT=22`,
    `${prefix}_USER=`,
    `${prefix}_PASSWORD=`,
    `${prefix}_HOST_FINGERPRINT=`,
    `${prefix}_ROOT=`,
    `${prefix}_STATE_ROOT=`,
    `${prefix}_BASE_URL=`,
    `${prefix}_SITE_TITLE=${account.name || t().publish.newAccountName}`
  ].join("\n");
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
    publishedAt: t().publish.keyPublishedAt,
    publishedUrl: t().publish.keyPublishedUrl
  };

  new Setting(ctx.containerEl).setName(t().publish.keysHeading).setDesc(t().publish.keysDesc);

  for (const role of PUBLISH_KEY_ROLES) {
    new Setting(ctx.containerEl).setName(labels[role]).addText((text) => {
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

/**
 * Prove the whole path in one request: token, target, SSH login, host key and
 * root directory, without writing anything.
 *
 * The same click fetches the bridge's targets, so a successful test turns the
 * target field into a list.
 */
async function testTarget(ctx: SettingsContext, account: PublishAccount): Promise<void> {
  const bridge = resolveBridge(ctx);
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

function resolveBridge(ctx: SettingsContext): PublishBridgeConfig | null {
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

  return { baseUrl: url.url, token: token.apiKey };
}
