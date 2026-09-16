// help.mjs — the one place a feature is explained, and the two things that read it.
//
// WHY THIS EXISTS
//
// The cards are short on purpose: a Components V2 message holds forty components and four
// thousand characters, and a paragraph of explanation inside a card pushes the buttons off
// the bottom of it. But a shop that never says where a code lands, or a table that never
// says who takes the pot, is a feature nobody uses.
//
// So the long text lives here, keyed by feature, and is reached two ways:
//   · a "Learn more" button on the feature's own card, answered as an EPHEMERAL reply — it
//     costs the original message nothing and leaves no trace in the channel;
//   · `/help`, which browses the same entries.
// Neither can drift from the other because neither owns the text: both call helpCard().
//
// The text itself is in the dictionary (i18n.mjs, keys `help.<feature>.t` / `.b`), like every
// other string the bot says, so a translator sees it beside the rest of the bot's words and
// an admin can override it from the site's Languages screen.
import { ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import * as ui from './ui.mjs';
import { SITE_URL } from './api.mjs';
import { backButtons, origin, withOrigin } from './nav.mjs';

/**
 * Every feature the bot explains. `cmd` is what to type to use it (shown on the index so a
 * reader who came from a button learns the command too); `icon` is an icon-set key, and an
 * unmapped one simply draws nothing.
 */
export const FEATURES = [
  { key: 'link', icon: 'link', cmd: '/link' },
  { key: 'level', icon: 'level', cmd: '/level' },
  { key: 'shop', icon: 'shop', cmd: '/shop' },
  { key: 'inventory', icon: 'inventory', cmd: '/inventory' },
  { key: 'casino', icon: 'casino', cmd: '/casino' },
  { key: 'live', icon: 'multi', cmd: '/casino lobbies' },
  { key: 'giveaway', icon: 'enter', cmd: '/giveaway' },
  { key: 'voice', icon: 'voice', cmd: '/voice' },
  { key: 'logs', icon: 'history', cmd: '/logs' },
  { key: 'config', icon: 'site', cmd: '/config' },
];

export const HELP_KEYS = FEATURES.map((f) => f.key);
export const feature = (key) => FEATURES.find((f) => f.key === key) || null;

const titleOf = (t, f) => `${ui.icx(f.icon)}${t(`help.${f.key}.t`)}`;
/** The select option's one-line description: the body's opening line, stripped of markdown. */
const gist = (t, f) => String(t(`help.${f.key}.b`)).split('\n')[0].replace(/[*_`#]/g, '').replace(/<a?:\w+:\d+>/g, '').trim().slice(0, 100);

/**
 * The "Learn more" button for a feature. It never carries an origin: the reply is a new
 * ephemeral message, so the card the reader pressed it on is still there behind it — there
 * is nothing to come back to.
 */
export const learnButton = (t, key) => ui.btn(`help:more:${key}`, t('btn.learn'), ButtonStyle.Secondary);

/** One feature's page. The same card whether it came from a button or from `/help`. */
export function helpCard(t, key, { from = '' } = {}) {
  const f = feature(key);
  if (!f) return { title: t('help.title'), body: t('help.unknown'), color: ui.INFO, buttons: [ui.btn('help:index', t('btn.help'), ButtonStyle.Secondary)] };
  return {
    title: titleOf(t, f),
    color: ui.INFO,
    body: [t(`help.${f.key}.b`), '', t('help.cmd', { c: f.cmd })],
    footer: t('help.footer'),
    buttons: [
      ui.btn(withOrigin('help:index', from), t('btn.help'), ButtonStyle.Secondary),
      ui.btn(`${SITE_URL}/docs`, t('btn.docs'), ButtonStyle.Secondary, { emoji: 'site' }),
      ...backButtons(t, from),
    ],
  };
}

/** `/help` — every feature in one card, with a menu to open one. */
export function helpIndexCard(t, { from = '' } = {}) {
  const pick = new StringSelectMenuBuilder().setCustomId(withOrigin('help:pick', from)).setPlaceholder(t('help.pick'))
    .addOptions(FEATURES.map((f) => {
      const o = new StringSelectMenuOptionBuilder().setValue(f.key).setLabel(t(`help.${f.key}.t`).slice(0, 100)).setDescription(gist(t, f));
      if (ui.ic(f.icon)) { try { o.setEmoji(ui.ic(f.icon)); } catch { /* label only */ } }
      return o;
    }));
  return {
    title: `${ui.icx('games')}${t('help.title')}`,
    color: ui.INFO,
    // One text block rather than a section per feature: ten sections with an accessory each
    // is thirty components, and this card has to leave room for the menu.
    body: [t('help.body'), '', ...FEATURES.map((f) => `${ui.icx(f.icon)}**${t(`help.${f.key}.t`)}** — \`${f.cmd}\``)],
    footer: t('help.footer'),
    buttons: [pick, ui.btn(`${SITE_URL}/docs`, t('btn.docs'), ButtonStyle.Secondary, { emoji: 'site' }), ...backButtons(t, from)],
  };
}

/** The origin token for the help index, so a screen opened from it can come back. */
export const helpOrigin = () => origin('help');
