/**
 * The mail capability of the bridge.
 */
import { SecretComponent, Setting } from "obsidian";
import { t } from "../i18n";
import { MAX_MAIL_RESULTS, MIN_MAIL_RESULTS } from "../services/plugin-settings";
import type { SettingsContext } from "./context";
import { renderCommands } from "./commands";

export function renderMail(ctx: SettingsContext): void {
  new Setting(ctx.containerEl).setName(t().mail.heading).setHeading();

  new Setting(ctx.containerEl).setDesc(t().mail.intro);

  new Setting(ctx.containerEl)
    .setName(t().mail.bridgeUrl)
    .setDesc(t().mail.bridgeUrlDesc)
    .addText((text) => {
      text.setPlaceholder("https://…");
      text.setValue(ctx.plugin.settings.mailBridgeUrl);
      text.onChange(async (value) => {
        await ctx.update({ mailBridgeUrl: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().mail.token)
    .setDesc(t().mail.tokenDesc)
    .addComponent((el) =>
      new SecretComponent(ctx.app, el)
        .setValue(ctx.plugin.settings.mailTokenSecretName)
        .onChange(async (value) => {
          await ctx.update({ mailTokenSecretName: value });
        })
    );

  new Setting(ctx.containerEl)
    .setName(t().mail.from)
    .setDesc(t().mail.fromDesc)
    .addText((text) => {
      text.setPlaceholder("Name <you@your-domain.de>");
      text.setValue(ctx.plugin.settings.mailFrom);
      text.onChange(async (value) => {
        await ctx.update({ mailFrom: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().mail.mailbox)
    .setDesc(t().mail.mailboxDesc)
    .addText((text) => {
      text.setPlaceholder("INBOX");
      text.setValue(ctx.plugin.settings.mailMailbox);
      text.onChange(async (value) => {
        await ctx.update({ mailMailbox: value });
      });
    });

  new Setting(ctx.containerEl)
    .setName(t().mail.maxResults)
    .setDesc(t().mail.maxResultsDesc)
    .addSlider((slider) => {
      slider
        .setDynamicTooltip()
        .setLimits(MIN_MAIL_RESULTS, MAX_MAIL_RESULTS, 1)
        .setValue(ctx.plugin.settings.mailMaxResults)
        .onChange(async (value) => {
          await ctx.update({ mailMaxResults: value });
        });
    });

  new Setting(ctx.containerEl)
    .setName(t().mail.mergeHeading)
    .setDesc(t().mail.mergeHeadingDesc)
    .addText((text) => {
      text.setPlaceholder(ctx.plugin.settings.mailMergeHeading || "Correspondence");
      text.setValue(ctx.plugin.settings.mailMergeHeading);
      text.onChange(async (value) => {
        await ctx.update({ mailMergeHeading: value });
      });
    });

  renderCommands(ctx, [
    t().commands.sendMail,
    t().commands.queryMailbox,
    t().commands.fetchReplies
  ]);
}
