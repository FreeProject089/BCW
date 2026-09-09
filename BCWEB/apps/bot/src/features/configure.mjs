// Configuring the bot without leaving Discord.
//
// WHY THIS EXISTS
//
// Every per-guild setting lived on the site behind a login. The bot could read them and
// never write them, so the person who actually runs the server — who is in Discord,
// looking at the bot, wanting a log channel — had to leave, find the dashboard, sign in,
// and come back. Most never did, which is why so many guilds sit in `none` mode.
//
// WHAT IS AND IS NOT HERE
//
// The settings that make sense to somebody standing in their own server: the bot's
// language, whether it moderates, where it logs. NOT which storage pool the guild eats or
// how much of it — those are the account holder's decisions, made where the bill is, and a
// server manager in Discord has no way to choose between pools they may not own.
//
// THE ACCOUNT REQUIREMENT, AND WHY THE REFUSAL IS TWO SENTENCES
//
// Writing settings needs a Discord account LINKED to a BetterCommunity one. That looks
// redundant — the bot already knows who pressed the button — and is not: a Discord
// snowflake on its own is nobody this platform has a record of. No terms accepted, no
// audit trail, nobody to hold to anything. The audit line is written against the linked
// account for exactly that reason.
//
// So there are two refusals and they must not be merged. "You are not this server's owner"
// is final. "Link your account" is a thing to go and do, once, and an owner told they lack
// permission when the real answer is the second has been lied to.
import { ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelSelectMenuBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import * as ui from '../ui.mjs';
import { api, SITE_URL } from '../api.mjs';
import { tr } from '../i18n.mjs';

/** Discord's own Manage Server, checked BEFORE calling the API. A pre-filter, not the
 *  authority — the API checks the owner/manager list itself and does not trust this. */
const canManage = (i) => !!(i.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) || i.guild?.ownerId === i.user.id);

const modeSelect = (t, current) => new StringSelectMenuBuilder()
    .setCustomId('cfg:mode')
    .setPlaceholder(t('cfg.mode'))
    .addOptions(
        new StringSelectMenuOptionBuilder().setValue('none').setLabel(t('cfg.mode.none')).setDescription(t('cfg.mode.none.d')).setDefault(current === 'none'),
        new StringSelectMenuOptionBuilder().setValue('moderation').setLabel(t('cfg.mode.mod')).setDescription(t('cfg.mode.mod.d')).setDefault(current === 'moderation'),
    );

const logSelect = (t) => new ChannelSelectMenuBuilder()
    .setCustomId('cfg:log')
    .setPlaceholder(t('cfg.log'))
    .addChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);

/** The card. `state` is what the API just told us, so this never guesses. */
function configCard(t, state) {
    const s = state.settings || {};
    const rows = [
        `${t('cfg.cur.mode')} **${s.memberMode === 'moderation' ? t('cfg.mode.mod') : t('cfg.mode.none')}**`,
        `${t('cfg.cur.log')} ${s.logChannelId ? `<#${s.logChannelId}>` : `*${t('cfg.none')}*`}`,
    ];
    return {
        title: t('cfg.title'),
        body: [t('cfg.body'), '', ...rows],
        buttons: [modeSelect(t, s.memberMode), logSelect(t),
            ui.btn(`${SITE_URL}/dashboard?s=discord`, t('cfg.more'), ButtonStyle.Secondary, { emoji: 'site' })],
    };
}

/**
 * Fetch the state and either draw the card or explain which of the two things is missing.
 * Returns null when it has already replied, so every caller reads the same.
 */
async function stateOrRefuse(i, t) {
    if (!i.guildId) return (await ui.line(i, t('cfg.guildonly'), { color: ui.BAD }), null);
    if (!canManage(i)) return (await ui.line(i, t('cfg.notmanager'), { color: ui.BAD }), null);
    const state = await api.guildSettings(i.guildId, i.user.id);
    if (state.may) return state;
    // The order matters: an owner who has not linked must hear about linking, not about
    // permission. `manager` is what the API says they would be IF they were linked.
    if (state.manager && !state.linked) {
        await ui.reply(i, {
            title: t('cfg.link.title'),
            body: [t('cfg.link.body')],
            color: ui.INFO,
            buttons: [ui.btn('eco:link', t('btn.link'), ButtonStyle.Primary, { emoji: 'link' }),
                ui.btn(`${SITE_URL}/auth`, t('cfg.link.site'), ButtonStyle.Secondary, { emoji: 'site' })],
        });
        return null;
    }
    await ui.line(i, t('cfg.notmanager'), { color: ui.BAD });
    return null;
}

/** /config */
export async function cmdConfig(i) {
    const { t } = await tr(i);
    const state = await stateOrRefuse(i, t);
    if (!state) return undefined;
    return ui.reply(i, configCard(t, state));
}

/** Both controls on the card land here. */
export async function configComponent(i) {
    const { t } = await tr(i);
    const state = await stateOrRefuse(i, t);
    if (!state) return undefined;

    const patch = i.customId === 'cfg:mode'
        ? { memberMode: String(i.values?.[0] || 'none') }
        // A channel select with minValues 0 sends an empty array for "clear it", which is a
        // real choice and not a no-op: it is how somebody turns logging off.
        : { logChannelId: i.values?.[0] ? String(i.values[0]) : null };

    const r = await api.setGuildSettings(i.guildId, i.user.id, patch);
    if (r?.error === 'log_channel_required') {
        // The one rule that fails in both directions, and the message says which end the
        // person is at rather than restating the rule.
        return ui.line(i, t('cfg.needlog'), { color: ui.BAD });
    }
    if (!r?.ok) return ui.line(i, t('cfg.failed'), { color: ui.BAD });
    return ui.update(i, configCard(t, { ...state, settings: r.settings }));
}
