// What a server sees the moment the bot arrives, and again on /setup: one card with the
// three things to do (link an account, pick the bot's language for this server, configure
// the server on the dashboard). Posted where the server talks — the system channel, else the
// first text channel the bot may write in — and, failing both, sent to the owner as a DM.
import { ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import * as ui from '../ui.mjs';
import { api, SITE_URL } from '../api.mjs';
import { config } from '../config.mjs';
import { tr, makeT, localeOf, LANGS } from '../i18n.mjs';

function langSelect(t, current) {
  const opts = [new StringSelectMenuOptionBuilder().setValue('auto').setLabel(t('onb.auto')).setDefault(!current || current === 'auto')];
  for (const l of LANGS) opts.push(new StringSelectMenuOptionBuilder().setValue(l).setLabel(t(`lang.${l}`)).setDefault(current === l));
  return new StringSelectMenuBuilder().setCustomId('onb:lang').setPlaceholder(t('onb.lang')).addOptions(opts);
}

export function onboardingCard(t, current) {
  return {
    title: t('onb.title'),
    // Step 3 used to be "configure the server on the dashboard" — the only honest thing to
    // say while the dashboard was the only place settings lived. `/config` changed that, so
    // the card names the command instead of sending somebody to a website to come back from.
    body: [t('onb.body'), '', t('onb.step1'), '', t('onb.step2'), '', t('onb.step3')],
    buttons: [
      langSelect(t, current),
      ui.btn('eco:link', t('btn.link'), ButtonStyle.Primary, { emoji: 'link' }),
      ui.btn(`${SITE_URL}/dashboard?s=discord`, t('btn.dashboard'), ButtonStyle.Secondary, { emoji: 'site' }),
      ui.btn(`${SITE_URL}/docs`, t('btn.docs'), ButtonStyle.Secondary, { emoji: 'site' }),
    ],
  };
}

/** The bot just joined `guild`. */
export async function sendOnboarding(guild) {
  const cfg = await config().catch(() => null);
  // No interaction here: the server's preferred locale is the best guess for the language.
  const pl = String(guild.preferredLocale || '').toLowerCase().slice(0, 2);
  const lang = localeOf({ guildId: guild.id, locale: pl }, cfg);
  const t = makeT(lang, cfg?.i18n);
  const card = ui.card(onboardingCard(t, cfg?.guildLanguages?.[guild.id]));
  const me = guild.members.me;
  const canWrite = (ch) => ch && ch.type === ChannelType.GuildText && me && ch.permissionsFor(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel]);
  const target = canWrite(guild.systemChannel) ? guild.systemChannel
    : [...guild.channels.cache.values()].filter(canWrite).sort((a, b) => a.rawPosition - b.rawPosition)[0];
  if (target) { await target.send(card); return; }
  const owner = await guild.fetchOwner().catch(() => null);
  if (owner) await owner.send(card).catch(() => {});
}

/** /setup — the same card, for a manager who wants it again. */
export async function cmdSetup(i) {
  const { t } = await tr(i);
  const cfg = await config().catch(() => null);
  return ui.reply(i, onboardingCard(t, cfg?.guildLanguages?.[i.guildId]), { ephemeral: true });
}

/** The language select on the card. Only a server manager may change it. */
export async function onboardingSelect(i) {
  const { t } = await tr(i);
  if (!i.guildId) return ui.line(i, t('onb.only'), { color: ui.BAD });
  const can = i.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) || i.guild?.ownerId === i.user.id;
  if (!can) return ui.line(i, t('onb.only'), { color: ui.BAD });
  const lang = String(i.values?.[0] || 'auto');
  await api.setGuildLanguage(i.guildId, lang);
  // Answer in the language just chosen — that is the confirmation.
  const cfg = await config(true).catch(() => null);
  const t2 = makeT(lang === 'auto' ? localeOf(i, { ...cfg, guildLanguages: {} }) : lang, cfg?.i18n);
  return ui.line(i, t2('onb.saved', { l: lang === 'auto' ? t2('onb.auto') : t2(`lang.${lang}`) }), { color: ui.GOOD });
}
