// Slash commands + interaction routing. Every response is a Components V2 card (see ui.mjs).
import { SlashCommandBuilder, PermissionFlagsBits, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { api, SITE_URL } from './api.mjs';
import { clearMessages } from './features/moderation.mjs';
import { sendPanel, handlePanelInteraction } from './features/panel.mjs';
import { checkGating } from './features/gating.mjs';
import { handleGiveawayButton } from './features/giveaways.mjs';
import { handleRolePanelInteraction } from './features/rolepanel.mjs';
import { config, guildBan } from './config.mjs';
import * as ui from './ui.mjs';

export const BRAND = ui.BRAND;
// Kept under its old name: panel.mjs and the pollers still call it. A one-card reply.
export const eReply = (i, text, { color = BRAND, title = null, ephemeral = true } = {}) => ui.line(i, text, { color, title, ephemeral });

export const commandData = [
  new SlashCommandBuilder().setName('link').setDescription('Link your Discord to your BetterCommunity account'),
  new SlashCommandBuilder().setName('verify').setDescription('Re-check your links and update your access roles'),
  new SlashCommandBuilder().setName('refreshroles').setDescription('Re-sync your gated roles now (after linking on the website)'),
  new SlashCommandBuilder().setName('voice').setDescription('Show the control panel for your temp voice channel'),
  new SlashCommandBuilder().setName('clear').setDescription('Delete recent messages (max 100)')
    .addIntegerOption((o) => o.setName('count').setDescription('How many (1-100)').setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  // Warnings are issued from Discord because that is where the moderator is standing when
  // somebody misbehaves. The RECORD lives on the site — the count, the ladder and the reason —
  // so a warning given here and one given from the admin screen are the same thing.
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member (recorded, with a reason)')
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why — they are told this, and it is kept').setRequired(true).setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('warnings').setDescription('Show the warnings on a member')
    .addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway in this channel')
    .addStringOption((o) => o.setName('prize').setDescription('What to give away').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('How long it runs (minutes)').setMinValue(1).setMaxValue(86400).setRequired(true))
    .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(50))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  // Always available — even in a banned server, since finding the appeal reference is the one
  // thing a moderator of a banned server needs the bot to still do.
  new SlashCommandBuilder().setName('appeal').setDescription('If this server is blocked from the bot, get your appeal reference and how to contest it'),
  // B-econ: levelling / economy commands.
  new SlashCommandBuilder().setName('level').setDescription('Show your level, XP and points'),
  new SlashCommandBuilder().setName('profile').setDescription('Show a member’s BetterCommunity profile')
    .addUserOption((o) => o.setName('member').setDescription('The member (defaults to you)')),
  new SlashCommandBuilder().setName('shop').setDescription('Browse the points shop'),
  new SlashCommandBuilder().setName('inventory').setDescription('What you bought with points — reveal codes, gift items'),
  new SlashCommandBuilder().setName('gift').setDescription('Give points to another member')
    .addUserOption((o) => o.setName('member').setDescription('Who gets them').setRequired(true))
    .addIntegerOption((o) => o.setName('points').setDescription('How many').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('note').setDescription('A word for them (optional)').setMaxLength(140)),
  new SlashCommandBuilder().setName('history').setDescription('Your last point movements — purchases, casino, gifts')
    .addStringOption((o) => o.setName('kind').setDescription('Only one kind').addChoices(
      { name: 'Casino', value: 'casino' }, { name: 'Purchases', value: 'purchase' }, { name: 'Gifts sent', value: 'gift_out' }, { name: 'Gifts received', value: 'gift_in' }, { name: 'Level-ups', value: 'levelup' })),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top members by level — this server or everyone')
    .addStringOption((o) => o.setName('scope').setDescription('This server, or every server the bot is in').addChoices({ name: 'This server', value: 'server' }, { name: 'Global', value: 'global' })),
  // Every option is a SHORTCUT: `/casino` alone opens the interactive table (pick the game, the
  // bet and the game's own options with menus, then Play); options given up front skip straight
  // to the roll. A game without its bet still opens the table with that game pre-selected.
  new SlashCommandBuilder().setName('casino').setDescription('Bet points on a game of chance — no options opens the interactive table')
    .addIntegerOption((o) => o.setName('bet').setDescription('How many points to bet (leave empty to pick from the table)').setMinValue(1))
    .addStringOption((o) => o.setName('game').setDescription('Which game (default: coin flip)').addChoices(
      { name: 'Coin flip (2×, 50%)', value: 'coinflip' },
      { name: 'Dice — roll 4-6 to win (2×)', value: 'dice' },
      { name: 'Slots — match to win big', value: 'slots' },
      { name: 'Roulette — colour, green or a number', value: 'roulette' },
      { name: 'Wheel — pick a multiplier, thinner slice the bigger it is', value: 'wheel' },
      { name: 'Plinko — a ball drops into a multiplier bucket', value: 'plinko' },
    ))
    .addStringOption((o) => o.setName('bet_on').setDescription('Roulette: what you bet on (default red)').addChoices(
      { name: 'Red (2×)', value: 'red' }, { name: 'Black (2×)', value: 'black' }, { name: 'Green / zero (14×)', value: 'green' }, { name: 'A number (35×)', value: 'number' }))
    .addIntegerOption((o) => o.setName('number').setDescription('Roulette: the number, 0–36 (with bet_on = number)').setMinValue(0).setMaxValue(36))
    .addIntegerOption((o) => o.setName('target').setDescription('Wheel: the multiplier you go for (default 2)').addChoices(
      { name: '2× (45%)', value: 2 }, { name: '3× (24%)', value: 3 }, { name: '5× (16%)', value: 5 }, { name: '10× (9%)', value: 10 }, { name: '20× (4%)', value: 20 }, { name: '50× (2%)', value: 50 }))
    .addStringOption((o) => o.setName('risk').setDescription('Plinko: bucket table (default medium)').addChoices(
      { name: 'Low — 0.5× to 5×', value: 'low' }, { name: 'Medium — 0.3× to 13×', value: 'medium' }, { name: 'High — 0.2× to 50×', value: 'high' })),
].map((c) => c.toJSON());

export async function handleInteraction(i) {
  // The admin's custom button emoji ride with the (cached) config.
  try { ui.setIcons((await config()).economy?.icons); } catch { /* defaults */ }
  if (i.isChatInputCommand()) {
    // A banned server: /appeal still answers (that is its whole point), everything else is
    // inert here. The ban is enforced regardless of a command's own permission gate.
    if (i.commandName === 'appeal') return cmdAppeal(i);
    if (i.guildId) {
      const ban = guildBan(await config(), i.guildId);
      if (ban) return eReply(i, 'This bot is not active in this server. Use `/appeal` to get your reference and how to contest it.', { title: 'Unavailable here' });
    }
    if (i.commandName === 'link') return cmdLink(i);
    if (i.commandName === 'verify' || i.commandName === 'refreshroles') return cmdVerify(i);
    if (i.commandName === 'voice') return sendPanel(i);
    if (i.commandName === 'clear') {
      const n = i.options.getInteger('count') || 100;
      const del = await clearMessages(i.channel, n);
      return eReply(i, `Deleted **${del}** message(s).`, { title: '🧹 Clear' });
    }
    if (i.commandName === 'warn') return cmdWarn(i);
    if (i.commandName === 'warnings') return cmdWarnings(i);
    if (i.commandName === 'giveaway') return cmdGiveaway(i);
    if (i.commandName === 'level') return cmdLevel(i);
    if (i.commandName === 'profile') return cmdProfile(i);
    if (i.commandName === 'shop') return cmdShop(i);
    if (i.commandName === 'inventory') return cmdInventory(i);
    if (i.commandName === 'gift') return cmdGift(i);
    if (i.commandName === 'history') return cmdHistory(i, i.options.getString('kind') || '');
    if (i.commandName === 'leaderboard') return cmdLeaderboard(i, false, i.options.getString('scope') || 'server');
    if (i.commandName === 'casino') return cmdCasino(i);
    return;
  }
  if (i.isButton() && i.customId.startsWith('gw:enter:')) return handleGiveawayButton(i);
  if (i.isButton() && i.customId.startsWith('shop:buy:')) return handleShopBuy(i);
  if (i.isButton() && i.customId.startsWith('shop:page:')) return cmdShop(i, Number(i.customId.split(':')[2]) || 0, true);
  if (i.isButton() && i.customId.startsWith('inv:reveal:')) return invReveal(i);
  if (i.isButton() && i.customId.startsWith('inv:gift:')) return invGiftModal(i);
  if (i.isModalSubmit() && i.customId.startsWith('invm:gift:')) return invGiftSubmit(i);
  if (i.isButton() && i.customId.startsWith('eco:lb:')) return cmdLeaderboard(i, true, i.customId.split(':')[2]);
  if (i.isButton() && i.customId === 'eco:link') return cmdLink(i);
  if (i.isButton() && i.customId === 'eco:level') return cmdLevel(i);
  if (i.isButton() && i.customId === 'eco:shop') return cmdShop(i);
  if (i.isButton() && i.customId === 'eco:inventory') return cmdInventory(i);
  if (i.isButton() && i.customId === 'eco:history') return cmdHistory(i, '');
  if (i.isButton() && i.customId === 'eco:leaderboard') return cmdLeaderboard(i, false, 'server');
  if (i.isButton() && i.customId.startsWith('casino:again:')) return casinoAgain(i);
  if ((i.isButton() || i.isStringSelectMenu()) && i.customId.startsWith('cas:')) return casinoSetup(i);
  if (i.isModalSubmit() && i.customId.startsWith('casm:')) return casinoModal(i);
  // Before the voice panel's catch-all, which claims every remaining component interaction.
  // It returns false when the custom id is not one of its own, so this stays a filter and
  // not a fork somebody has to keep in sync.
  if (await handleRolePanelInteraction(i)) return;
  if (i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) return handlePanelInteraction(i);
}

// ── B-econ: levelling / economy commands ─────────────────────────────────────
const curLabel = (c) => c?.emoji || c?.name || 'points';
const n = (x) => Number(x || 0).toLocaleString('en-US');
const ecoButtons = (except = '') => [
  except !== 'level' && ui.btn('eco:level', 'My level', ButtonStyle.Secondary, { emoji: 'level' }),
  except !== 'shop' && ui.btn('eco:shop', 'Shop', ButtonStyle.Secondary, { emoji: 'shop' }),
  except !== 'inventory' && ui.btn('eco:inventory', 'Inventory', ButtonStyle.Secondary, { emoji: 'inventory' }),
  except !== 'leaderboard' && ui.btn('eco:leaderboard', 'Leaderboard', ButtonStyle.Secondary, { emoji: 'leaderboard' }),
];
const notLinked = (i) => ui.reply(i, {
  title: 'Not linked yet', color: ui.INFO,
  body: 'Link your BetterCommunity account first — it takes a minute, and it is how your XP, points and purchases get a home. Until then nothing accrues.',
  buttons: [ui.btn(`${SITE_URL}/profile`, 'Open my profile'), ui.btn('eco:link', 'Get a link code', ButtonStyle.Primary, { emoji: 'link' })],
});

// The site's own avatar for a linked member, attached — it is drawn by the site, which Discord
// may not be able to reach. Returns { thumb, files } to spread into a card.
async function siteAvatar(e, name = 'avatar.png') {
  const png = e?.avatarPath ? await api.siteImage(e.avatarPath) : null;
  return png ? { thumb: `attachment://${name}`, files: [ui.attach(png, name)] } : { thumb: null, files: [] };
}

async function cmdLevel(i) {
  const e = await api.economyUser(i.user.id);
  if (!e.linked) return notLinked(i);
  const cur = curLabel(e.currency);
  const pct = ui.bar(e.xpThisLevel, e.xpForNext);
  const av = await siteAvatar(e);
  return ui.reply(i, {
    title: `Level ${e.level}`,
    thumb: av.thumb || i.user.displayAvatarURL?.({ size: 128 }) || null, files: av.files,
    body: [
      `**${e.displayName}** · **${n(e.points)}** ${cur}`,
      `${pct}`,
      `-# ${n(e.xpThisLevel)} / ${n(e.xpForNext)} XP to level ${e.level + 1}`,
      e.badges?.length ? `🏅 ${e.badges.map((b) => b.name).join(' · ')}` : null,
      '',
      `💬 ${n(e.stats?.messages)} messages · ✨ ${n(e.stats?.reactions)} reactions · 🎙️ ${Math.floor((e.stats?.voiceSeconds || 0) / 3600)}h in voice`,
    ],
    buttons: [...ecoButtons('level'), ui.btn('eco:history', 'History', ButtonStyle.Secondary, { emoji: 'history' }), ui.btn(`${SITE_URL}/dashboard?s=economy`, 'Open on the site')],
  });
}

async function cmdProfile(i) {
  const target = i.options.getUser('member') || i.user;
  const e = await api.economyUser(target.id);
  if (!e.linked) return ui.line(i, `${target.username} hasn't linked a BetterCommunity account.`, { title: 'No profile' });
  await i.deferReply();
  const url = `${SITE_URL}/u/${e.userId}`;
  const cur = curLabel(e.currency);
  // The same 1200×630 card a shared profile link unfurls with, drawn by the site and ATTACHED
  // here (fetched over the internal API address) — Discord never needs to reach the site.
  const [png, av] = await Promise.all([api.siteImage(`/og/profile/${encodeURIComponent(e.userId)}.png`), siteAvatar(e)]);
  const files = [...av.files, ...(png ? [ui.attach(png, 'profile.png')] : [])];
  return ui.editReply(i, {
    title: e.displayName,
    thumb: av.thumb || target.displayAvatarURL?.({ size: 128 }) || null,
    body: [
      `**Level ${e.level}** · **${n(e.points)}** ${cur}`,
      e.badges?.length ? `🏅 ${e.badges.map((b) => `**${b.name}**`).join(' · ')}` : '-# No badges yet',
      `💬 ${n(e.stats?.messages)} messages · ✨ ${n(e.stats?.reactions)} reactions · 🎙️ ${Math.floor((e.stats?.voiceSeconds || 0) / 3600)}h in voice`,
    ],
    image: png ? 'attachment://profile.png' : null, files,
    buttons: [ui.btn(url, 'View full profile'), ...(target.id === i.user.id ? ecoButtons('') : [])],
  });
}

// What each shop kind hands over, phrased for the buyer.
const SHOP_KIND_LABEL = {
  badge: '🏅 profile badge', role: '🎭 Discord role', pool: '💾 storage pool',
  boost: '🚀 catalog / repo boost', hosting: '🖥️ free hosting', promo: '🎟️ promo code', custom: '🎁 reward',
};
const TAG_LABEL = { exclusive: '💎 Exclusive', limited: '🔥 Limited', timed: '⏳ For a limited time' };
const PAGE = 8;

// The shop: one section per item with its own Buy button. Paged eight at a time — a section
// with a button is two components, and a V2 message holds forty.
async function cmdShop(i, page = 0, isUpdate = false) {
  const [eco, me] = await Promise.all([api.economyConfig(), api.economyUser(i.user.id)]);
  const respond = (opts) => (isUpdate ? ui.update(i, opts) : ui.reply(i, opts));
  if (!eco.enabled) return respond({ title: '🛒 Shop', body: 'The economy is currently off.' });
  const now = Date.now();
  const items = (Array.isArray(eco.shop) ? eco.shop : []).filter((x) => x.name && x.active !== false && !(x.kind === 'badge' && !x.ref) && !(x.availableUntil && new Date(x.availableUntil).getTime() < now));
  if (!items.length) return respond({ title: '🛒 Shop', body: 'The shop is empty for now — check back later.', buttons: ecoButtons('shop') });
  const cur = eco.currencyEmoji || eco.currencyName || 'points';
  const pages = Math.ceil(items.length / PAGE);
  page = Math.max(0, Math.min(pages - 1, page));
  const slice = items.slice(page * PAGE, page * PAGE + PAGE);
  const balance = me.linked ? Number(me.points || 0) : null;
  return respond({
    title: '🛒 Points shop',
    body: balance != null ? `You have **${n(balance)}** ${cur}. Everything here needs a linked BetterCommunity account — the codes and perks land on it.` : 'Link your account to buy — **/link**.',
    sections: slice.map((x) => {
      const cost = Number(x.cost) || 0;
      const can = balance != null && balance >= cost;
      const tag = x.exclusive ? TAG_LABEL.exclusive : x.stock != null && x.stock !== '' ? `${TAG_LABEL.limited} · ${x.stock} in stock` : x.availableUntil ? `${TAG_LABEL.timed} · until <t:${Math.floor(new Date(x.availableUntil).getTime() / 1000)}:d>` : '';
      const extra = [SHOP_KIND_LABEL[x.kind] || '🎁 reward', x.giftable === false || x.kind === 'badge' || x.kind === 'role' ? 'bound to you' : 'giftable', x.codeDays ? `code valid ${x.codeDays} d` : null].filter(Boolean).join(' · ');
      return {
        text: `**${x.name}** — ${n(cost)} ${cur}${tag ? `  ${tag}` : ''}\n-# ${extra}${x.desc ? `\n${x.desc}` : ''}`,
        button: ui.btn(`shop:buy:${x.id}`, can ? 'Buy' : `${n(cost)}`, can ? ButtonStyle.Success : ButtonStyle.Secondary, { disabled: !can, emoji: can ? 'buy' : null }),
      };
    }),
    footer: pages > 1 ? `Page ${page + 1} / ${pages} · everything you buy lands in /inventory` : 'Everything you buy lands in /inventory — and on the site, under Dashboard → Shop & inventory.',
    buttons: [
      pages > 1 && ui.btn(`shop:page:${page - 1}`, 'Previous', ButtonStyle.Secondary, { disabled: page === 0 }),
      pages > 1 && ui.btn(`shop:page:${page + 1}`, 'Next', ButtonStyle.Secondary, { disabled: page >= pages - 1 }),
      ...ecoButtons('shop'),
    ],
  });
}

// A Buy button was pressed. The API is authoritative — it re-reads the price, checks stock
// and exclusivity, debits atomically and records the purchase. We only translate the result.
async function handleShopBuy(i) {
  const itemId = i.customId.slice('shop:buy:'.length);
  const r = await api.economyBuy(i.user.id, itemId);
  if (r.ok) {
    const d = r.delivery || {};
    const lines = [`You bought **${r.item?.name || 'item'}**. Balance: **${n(r.points)}**.`];
    if (d.kind === 'badge') lines.push(`🏅 The **${d.badge}** badge is now on your BCWEB profile.`);
    else if (d.revealed === false) lines.push(`✉️ Your code is sealed in your inventory — press **Reveal** there when you want it${r.item?.giftable ? ', or **Gift** it unopened to someone else' : ''}.`);
    else if (r.item?.kind === 'role') lines.push('🎭 An admin will assign your role shortly — it shows as *pending* in your inventory until then.');
    else lines.push('🎁 An admin has been notified to deliver it — *pending* in your inventory until then.');
    return ui.reply(i, { title: '✅ Purchase complete', color: ui.GOOD, body: lines, buttons: [ui.btn('eco:inventory', 'Inventory', ButtonStyle.Primary, { emoji: 'inventory' }), ui.btn('eco:shop', 'Back to the shop', ButtonStyle.Secondary, { emoji: 'shop' })] });
  }
  if (r.error === 'not_linked') return notLinked(i);
  const why = r.error === 'insufficient' ? `You need **${n(r.cost)}** points — you have ${n(r.points)}.`
    : r.error === 'already_owned' ? 'You already own that one — it is one per account.'
    : r.error === 'sold_out' ? 'Sold out — somebody got the last one.'
    : r.error === 'badge_unavailable' ? 'That badge is no longer available.'
    : r.error === 'no_such_item' ? 'That item is gone from the shop.'
    : r.error === 'economy_off' ? 'The economy is currently off.'
    : 'That purchase could not be completed.';
  return ui.reply(i, { title: '🛒 Shop', color: ui.BAD, body: why, buttons: [ui.btn('eco:shop', 'Back to the shop', ButtonStyle.Secondary, { emoji: 'shop' })] });
}

// Everything bought with points, newest first: sealed codes to reveal, giftable items to gift.
async function cmdInventory(i) {
  const e = await api.economyUser(i.user.id);
  if (!e.linked) return notLinked(i);
  const r = await api.economyPurchases(i.user.id);
  const rows = Array.isArray(r.purchases) ? r.purchases : [];
  if (!rows.length) return ui.reply(i, { title: '🎒 Inventory', body: 'Nothing here yet — the shop is one button away.', buttons: ecoButtons('inventory') });
  const pending = rows.filter((x) => x.status === 'pending').length;
  const sections = rows.slice(0, 10).map((x) => {
    const when = `<t:${Math.floor(new Date(x.createdAt).getTime() / 1000)}:d>`;
    const d = x.delivery || {};
    const state = x.status === 'pending' ? '⏳ waiting for an admin'
      : d.revealed && d.code ? `code \`${d.code}\`${x.expiresAt ? ` · until <t:${Math.floor(new Date(x.expiresAt).getTime() / 1000)}:d>` : ''}${x.expired ? ' · expired' : ''}`
      : d.badge ? `badge **${d.badge}**`
      : x.canReveal ? '✉️ sealed — reveal when you want the code' : '✅ delivered';
    const button = x.canReveal ? ui.btn(`inv:reveal:${x.id}`, 'Reveal', ButtonStyle.Primary, { emoji: 'reveal' })
      : x.canGift ? ui.btn(`inv:gift:${x.id}`, 'Gift', ButtonStyle.Secondary, { emoji: 'gift' }) : null;
    return { text: `**${x.name}** — ${n(x.cost)} pts · ${when}${x.giftedFromId ? ' · 🎁 a gift' : ''}\n-# ${state}${x.canReveal && x.canGift ? ' · giftable unopened' : ''}`, button };
  });
  return ui.reply(i, {
    title: '🎒 Inventory',
    body: pending ? `**${pending}** still on the way (an admin hands those out).` : `${rows.length} purchase${rows.length === 1 ? '' : 's'}.`,
    sections,
    footer: rows.length > 10 ? `…and ${rows.length - 10} more on the site.` : 'Reveal mints the code for whoever holds the item; Gift hands an unopened item to someone else.',
    buttons: [ui.btn(`${SITE_URL}/dashboard?s=economy`, 'Open on the site'), ...ecoButtons('inventory')],
  });
}

async function invReveal(i) {
  const purchaseId = i.customId.slice('inv:reveal:'.length);
  const r = await api.economyReveal(i.user.id, purchaseId);
  if (!r.ok) return ui.line(i, r.error === 'not_found' ? 'That item is not in your inventory (was it gifted?).' : r.error === 'nothing_to_reveal' ? 'There is no code behind this one.' : 'Could not reveal that right now.', { color: ui.BAD });
  const d = r.delivery || {};
  return ui.reply(i, {
    title: '✉️ Your code', color: ui.GOOD,
    body: [`# ${d.code}`, `Redeem it on the site${d.target ? ` (${d.target})` : ''}.`, r.expiresAt ? `-# Valid until <t:${Math.floor(new Date(r.expiresAt).getTime() / 1000)}:f>` : '-# No expiry.', '-# It is kept in your inventory — only you can see this message.'],
    buttons: [ui.btn(`${SITE_URL}/dashboard?s=economy`, 'Open on the site'), ui.btn('eco:inventory', 'Inventory', ButtonStyle.Secondary, { emoji: 'inventory' })],
  });
}

async function invGiftModal(i) {
  const purchaseId = i.customId.slice('inv:gift:'.length);
  const modal = new ModalBuilder().setCustomId(`invm:gift:${purchaseId}`).setTitle('Gift this item')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('to').setLabel('Who? Discord id, BC id, site name or e-mail').setStyle(TextInputStyle.Short).setMaxLength(120).setRequired(true)));
  return i.showModal(modal);
}
async function invGiftSubmit(i) {
  const purchaseId = i.customId.slice('invm:gift:'.length);
  const to = i.fields.getTextInputValue('to').trim();
  const body = { discordId: i.user.id, purchaseId };
  if (/^\d{15,22}$/.test(to)) body.toDiscordId = to; else body.to = to;
  const r = await api.economyGift(body);
  if (!r.ok) return ui.line(i, giftError(r), { color: ui.BAD });
  return ui.reply(i, { title: '🎁 Gifted', color: ui.GOOD, body: `Handed to **${r.to?.displayName || to}** — it is in their inventory now, unopened.`, buttons: [ui.btn('eco:inventory', 'Inventory', ButtonStyle.Secondary, { emoji: 'inventory' })] });
}
const giftError = (r) => r.error === 'not_linked' ? 'Link your account first — **/link**.'
  : r.error === 'recipient_not_linked' ? 'They have not linked a BetterCommunity account yet.'
  : r.error === 'no_such_user' ? 'Nobody by that name, id or e-mail.'
  : r.error === 'self' ? 'That is you.'
  : r.error === 'gifts_off' ? 'Gifting is switched off.'
  : r.error === 'insufficient' ? `You do not have that many points (${n(r.points)}).`
  : r.error === 'too_small' ? `The minimum gift is ${n(r.min)}.`
  : r.error === 'daily_cap' ? `Daily gift cap reached — ${n(r.left)} left today (cap ${n(r.maxPerDay)}).`
  : r.error === 'not_giftable' ? 'That item is bound to its buyer and cannot be gifted.'
  : r.error === 'pending' ? 'Wait until an admin has handed it out.'
  : 'That gift could not be sent.';

async function cmdGift(i) {
  const member = i.options.getUser('member');
  const points = i.options.getInteger('points');
  const note = i.options.getString('note') || '';
  if (member.bot) return ui.line(i, 'Bots have no wallet.', { color: ui.BAD });
  const r = await api.economyGift({ discordId: i.user.id, toDiscordId: member.id, points, note });
  if (!r.ok) return r.error === 'not_linked' ? notLinked(i) : ui.line(i, giftError(r), { color: ui.BAD });
  return ui.reply(i, {
    title: '🎁 Gift sent', color: ui.GOOD,
    body: [`**${n(points)}** points to **${member.username}**${note ? ` — “${note}”` : ''}.`, `Your balance: **${n(r.points)}**.`],
    buttons: [ui.btn('eco:history', 'History', ButtonStyle.Secondary, { emoji: 'history' }), ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: 'level' })],
  }, { ephemeral: false });
}

const KIND_LABEL = { levelup: '⬆️ Level-up', grant: '🛡️ Staff', purchase: '🛒 Purchase', casino: '🎰 Casino', gift_out: '🎁 Gift sent', gift_in: '🎁 Gift received', gift_item_out: '🎁 Item given', gift_item_in: '🎁 Item received', refund: '↩️ Refund' };
async function cmdHistory(i, kind = '') {
  const r = await api.economyHistory(i.user.id, kind);
  if (r.linked === false) return notLinked(i);
  const rows = Array.isArray(r.history) ? r.history : [];
  if (!rows.length) return ui.reply(i, { title: '📜 History', body: kind ? 'Nothing of that kind yet.' : 'Nothing yet — earn, buy, play or gift and it shows up here.', buttons: ecoButtons('') });
  const lines = rows.slice(0, 20).map((x) => {
    const m = x.meta || {};
    const who = x.kind === 'gift_out' ? ` → ${m.toName || '?'}` : x.kind === 'gift_in' ? ` ← ${m.fromName || '?'}` : x.kind === 'purchase' ? ` · ${m.name || ''}` : x.kind === 'casino' ? ` · ${m.game || ''} ×${m.multiplier ?? '?'}` : x.kind === 'levelup' ? ` · Lv ${m.level}` : '';
    const d = x.delta > 0 ? `**+${n(x.delta)}**` : x.delta < 0 ? `**−${n(-x.delta)}**` : '±0';
    return `<t:${Math.floor(new Date(x.createdAt).getTime() / 1000)}:d> ${KIND_LABEL[x.kind] || x.kind}${who} — ${d} → ${n(x.balance)}`;
  });
  return ui.reply(i, { title: `📜 History${kind ? ` · ${KIND_LABEL[kind] || kind}` : ''}`, body: lines, footer: 'The full history, with filters, is on the site.', buttons: [ui.btn(`${SITE_URL}/dashboard?s=economy`, 'Open on the site'), ...ecoButtons('')] });
}

async function cmdLeaderboard(i, isUpdate = false, scope = 'server') {
  const guildId = scope === 'server' && i.guildId ? i.guildId : '';
  const r = await api.economyLeaderboard(i.user.id, guildId);
  const rows = (r.members || []).slice(0, 10);
  if (!isUpdate) await i.deferReply();
  const respond = (opts) => (isUpdate ? ui.update(i, opts) : ui.editReply(i, opts));
  // The board as a picture, drawn by the site with real avatars; the text list is the
  // accessible copy and what an old client falls back to.
  const meId = (await api.economyUser(i.user.id))?.userId || '';
  const png = rows.length ? await api.siteImage(`/og/leaderboard.png?guildId=${encodeURIComponent(guildId)}&me=${encodeURIComponent(meId)}&n=${Math.floor(Date.now() / 60000)}`) : null;
  const medal = (k) => k === 0 ? '🥇' : k === 1 ? '🥈' : k === 2 ? '🥉' : `**${k + 1}.**`;
  const body = rows.length ? rows.map((m, k) => `${medal(k)} **${m.displayName}** — Lv **${m.level}** · ${n(m.points)} pts`) : ['Nobody has a level yet — say something.'];
  const you = r.me ? `\nYou: **#${r.me.rank}** · Lv ${r.me.level} · ${n(r.me.points)} pts` : '';
  return respond({
    title: `🏆 Leaderboard · ${guildId ? (i.guild?.name || 'this server') : 'global'}`,
    body: png ? [you || null] : [...body, you],
    image: png ? 'attachment://leaderboard.png' : null, files: png ? [ui.attach(png, 'leaderboard.png')] : [],
    footer: r.total ? `${n(r.total)} members have a level · by level, then XP` : null,
    buttons: [
      ui.btn('eco:lb:server', 'This server', guildId ? ButtonStyle.Primary : ButtonStyle.Secondary, { disabled: !i.guildId }),
      ui.btn('eco:lb:global', 'Global', guildId ? ButtonStyle.Secondary : ButtonStyle.Primary),
      ui.btn(`eco:lb:${guildId ? 'server' : 'global'}`, 'Refresh', ButtonStyle.Secondary, { emoji: 'refresh' }),
      ui.btn('eco:level', 'My level', ButtonStyle.Secondary, { emoji: 'level' }),
    ],
  });
}

// ── Casino ───────────────────────────────────────────────────────────────────
// The bot rolls each game and hands the API the multiplier; the API prices the house edge and
// settles the balance. Different games = different odds/payouts, but the ledger is one place.
function rollGame({ game, betOn, num, target, risk }) {
  let mult = 0, detail = '', card = ''; // card = the ?d= detail the result image draws
  if (game === 'roulette') {
    // European wheel: 0 is green, 1–36 alternate red/black. Bets: a colour (2×), green (14×),
    // or an exact number (35×). The zero beating both colours is the game's own edge, before
    // the house edge the API prices on top.
    const pocket = Math.floor(Math.random() * 37);
    const reds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
    const colour = pocket === 0 ? 'green' : reds.has(pocket) ? 'red' : 'black';
    if (betOn === 'number') { mult = pocket === num ? 35 : 0; detail = `🎡 You bet on **${num}** — the ball landed on **${pocket} ${colour}**.`; }
    else if (betOn === 'green') { mult = pocket === 0 ? 14 : 0; detail = `🎡 You bet on **green** — the ball landed on **${pocket} ${colour}**.`; }
    else { mult = colour === betOn ? 2 : 0; detail = `🎡 You bet on **${betOn}** — the ball landed on **${pocket} ${colour}**.`; }
    card = String(pocket);
  } else if (game === 'wheel') {
    const SLICES = [[2, 45], [3, 24], [5, 16], [10, 9], [20, 4], [50, 2]];
    let roll = Math.random() * 100, landed = 2;
    for (const [m, w] of SLICES) { if (roll < w) { landed = m; break; } roll -= w; }
    mult = landed === target ? target : 0;
    detail = `🎯 You went for **${target}×** — the wheel stopped on **${landed}×**.`;
    card = `${landed}|${target}`;
  } else if (game === 'plinko') {
    const TABLES = { low: [5, 3, 1.5, 1.2, 1, 0.5, 1, 1.2, 1.5, 3, 5], medium: [13, 4, 2, 1.2, 0.6, 0.3, 0.6, 1.2, 2, 4, 13], high: [50, 10, 3, 1, 0.3, 0.2, 0.3, 1, 3, 10, 50] };
    let path = '', rights = 0;
    for (let k = 0; k < 10; k++) { const rgt = Math.random() < 0.5; path += rgt ? 'R' : 'L'; if (rgt) rights++; }
    mult = TABLES[risk][rights];
    detail = `🟡 Risk **${risk}** — the ball landed in the **${mult}×** bucket.`;
    card = `${risk}|${path}|${rights}`;
  } else if (game === 'dice') {
    const roll = 1 + Math.floor(Math.random() * 6);
    mult = roll >= 4 ? 2 : 0;
    detail = `🎲 You rolled a **${roll}** (win on 4-6).`; card = String(roll);
  } else if (game === 'slots') {
    const S = ['cherry', 'lemon', 'bell', 'star', 'diamond'];
    const E = { cherry: '🍒', lemon: '🍋', bell: '🔔', star: '⭐', diamond: '💎' };
    const reels = [0, 1, 2].map(() => S[Math.floor(Math.random() * S.length)]);
    mult = reels[0] === reels[1] && reels[1] === reels[2] ? 8
      : reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2] ? 1.5
      : 0;
    detail = reels.map((r) => E[r]).join(' ');
    card = reels.join(' ');
  } else {
    const heads = Math.random() < 0.5;
    mult = heads ? 2 : 0;
    detail = heads ? '🪙 Heads!' : '🪙 Tails.'; card = heads ? '🪙' : '🌑';
  }
  return { mult, detail, card };
}

const GAME_NAME = { coinflip: 'Coin flip', dice: 'Dice', slots: 'Slots', roulette: 'Roulette', wheel: 'Wheel', plinko: 'Plinko' };

async function playCasino(i, opts) {
  const { bet, game } = opts;
  const { mult, detail, card } = rollGame(opts);
  const r = await api.economyCasino(i.user.id, bet, mult, game);
  if (!r.ok) {
    if (r.error === 'not_linked') return notLinked(i);
    const msg = r.error === 'casino_off' ? 'The casino is off.'
      : r.error === 'insufficient' ? "You don't have enough points for that bet."
      : r.error === 'bad_bet' ? `Your bet must be between ${r.min} and ${r.max}.`
      : 'Could not place that bet.';
    return ui.reply(i, { title: '🎰 Casino', body: msg, color: ui.BAD, buttons: [ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: 'level' })] });
  }
  // The GIF takes a moment to render; a deferred reply keeps Discord from timing the
  // interaction out, and the play is public — the table is the fun part.
  await i.deferReply();
  // Three outcomes, not two: a win (delta > 0), a push (a 1× bucket — the bet comes back to the
  // point, nothing won, nothing lost) and a loss — which may be PARTIAL (a 0.3× bucket returns
  // 30 % of the bet), so the loss line shows what actually left the balance, not the whole bet.
  const won = r.delta > 0, push = r.delta === 0, lost = -r.delta;
  const amt = n(won ? r.delta : lost);
  // Animated GIF of the spin, seeded per play so every roll looks different, rendered by the
  // site and ATTACHED (fetched over the internal API address, so Discord never has to reach
  // the site). The PNG still is the fallback the API itself falls back to.
  const q = `d=${encodeURIComponent(card)}&a=${encodeURIComponent(amt)}&s=${Math.floor(Math.random() * 4294967295)}`;
  const gif = await api.siteImage(`/og/casino/${encodeURIComponent(game)}/${won ? 'win' : 'lose'}.gif?${q}`);
  const files = gif ? [ui.attach(gif, 'casino.gif')] : [];
  const line = won
    ? `${detail}\n🎉 You won **+${n(r.delta)}** — balance **${n(r.points)}**.`
    : push ? `${detail}\n↩️ Push — your **${n(bet)}** came back. Balance **${n(r.points)}**.`
    : `${detail}\n💀 You lost **${n(lost)}**${lost < bet ? ` of your ${n(bet)}` : ''}. Balance **${n(r.points)}**.`;
  // "Play again" re-runs the same bet with the same options — the custom id carries them (and
  // the player's id, so nobody spends somebody else's points from their button).
  const again = ['casino', 'again', game, bet, opts.betOn || '', opts.num ?? '', opts.target || '', opts.risk || '', i.user.id].join(':');
  return ui.editReply(i, {
    title: won ? `${GAME_NAME[game] || 'Casino'} — you win!` : push ? `${GAME_NAME[game] || 'Casino'} — push` : `${GAME_NAME[game] || 'Casino'} — you lose`,
    color: won ? 0x248046 : push ? ui.INFO : 0xda373c,
    thumb: i.user.displayAvatarURL?.({ size: 128 }) || null,
    body: line,
    image: gif ? 'attachment://casino.gif' : null, files,
    buttons: [ui.btn(again, `Play again (${n(bet)})`, won ? ButtonStyle.Success : ButtonStyle.Primary, { emoji: 'again' }), ui.btn(`cas:open:${packCas({ ...opts, view: 'game', bet: 0, owner: i.user.id })}`, 'Change bet / game', ButtonStyle.Secondary, { emoji: 'casino' }), ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: 'level' }), ui.btn('eco:history', 'History', ButtonStyle.Secondary, { emoji: 'history' })],
  });
}

async function cmdCasino(i) {
  const bet = i.options.getInteger('bet');
  const game = GAME_NAME[i.options.getString('game')] ? i.options.getString('game') : 'coinflip';
  const betOn = ['red', 'black', 'green', 'number'].includes(i.options.getString('bet_on')) ? i.options.getString('bet_on') : 'red';
  const num = i.options.getInteger('number');
  const target = i.options.getInteger('target') || 2;
  const risk = ['low', 'medium', 'high'].includes(i.options.getString('risk')) ? i.options.getString('risk') : 'medium';
  const st = { view: i.options.getString('game') ? 'game' : 'list', game, bet: bet || 0, betOn, num, target, risk, owner: i.user.id };
  // No bet: the table opens — on the list of games, or straight on the named game's page with
  // everything given so far already selected. A number bet without its number does the same.
  if (!bet || (game === 'roulette' && betOn === 'number' && num == null)) return casinoMenu(i, st);
  return playCasino(i, { bet, game, betOn, num, target, risk });
}

// ── Casino table (interactive) ───────────────────────────────────────────────
// `/casino` alone opens a paged table: the LIST of games first (one big entry per game with
// an Open button), then one page per game — a preview picture, the rules and odds, the bet
// menu, the game's own option menu, and Play — with ◀ Games ▶ at the bottom to move between
// pages. The whole choice lives in the custom ids (view · game · bet · bet_on · number ·
// target · risk · owner), so the table survives a bot restart and needs no session state.
const CASINO_GAMES = [
  { id: 'coinflip', emoji: '🪙', name: 'Coin flip', desc: 'Heads or tails — 2×, one chance in two',
    rules: ['Call it. **Heads** doubles your bet, **tails** loses it.', '**Odds** 50 % · **Pays** 2×'], preview: '🪙' },
  { id: 'dice', emoji: '🎲', name: 'Dice', desc: 'Roll 4, 5 or 6 to double — 2×, one chance in two',
    rules: ['One die. A **4, 5 or 6** doubles your bet; **1, 2 or 3** loses it.', '**Odds** 50 % · **Pays** 2×'], preview: '6' },
  { id: 'slots', emoji: '🎰', name: 'Slots', desc: 'Three of a kind pays 8×, any pair 1.5×',
    rules: ['Three reels. **Three of a kind** pays 8×, **any pair** 1.5×, anything else loses.', '**Triple** 4 % · **Pair** 48 %'], preview: 'cherry cherry cherry' },
  { id: 'roulette', emoji: '🎡', name: 'Roulette', desc: 'A colour 2×, green 14×, an exact number 35×',
    rules: ['European wheel, 0–36. **Red** or **black** pays 2× (18 pockets each), **green** — the zero — pays 14×, an **exact number** pays 35×.', '**Option** what you bet on; a number bet asks for the number.'], preview: '17' },
  { id: 'wheel', emoji: '🎯', name: 'Wheel', desc: 'Pick a multiplier — the bigger it is, the thinner its slice',
    rules: ['Pick the multiplier you go for. The wheel stops on one slice — you win **only if it is yours**.', '2× 45 % · 3× 24 % · 5× 16 % · 10× 9 % · 20× 4 % · 50× 2 %'], preview: '5|5' },
  { id: 'plinko', emoji: '🟡', name: 'Plinko', desc: 'A ball drops into a multiplier bucket — you pick the risk table',
    rules: ['A ball bounces down **10 rows of pegs** into one of 11 buckets. The edges pay big, the middle pays little — a 1× bucket gives your bet back, a 0.3× bucket returns 30 % of it.', '**Low** 0.5×–5× · **Medium** 0.3×–13× · **High** 0.2×–50×'], preview: 'medium|RRLRLRLRLR|5' },
];
const ROULETTE_BETS = [['red', '🔴 Red — 2×'], ['black', '⚫ Black — 2×'], ['green', '🟢 Green (zero) — 14×'], ['number', '🔢 An exact number — 35×']];
const WHEEL_TARGETS = [[2, '2× — 45 % of the wheel'], [3, '3× — 24 %'], [5, '5× — 16 %'], [10, '10× — 9 %'], [20, '20× — 4 %'], [50, '50× — 2 %']];
const PLINKO_RISKS = [['low', 'Low — buckets 0.5× to 5×'], ['medium', 'Medium — buckets 0.3× to 13×'], ['high', 'High — buckets 0.2× to 50×']];

function packCas(st) {
  return [st.view === 'list' ? 'list' : 'game', st.game || 'coinflip', st.bet || 0, st.betOn || 'red', st.num ?? '', st.target || 2, st.risk || 'medium', st.owner || ''].join(':');
}
function unpackCas(parts) {
  const [view, game, bet, betOn, num, target, risk, owner] = parts;
  return {
    view: view === 'list' ? 'list' : 'game',
    game: GAME_NAME[game] ? game : 'coinflip',
    bet: bet === 'all' ? 'all' : Math.max(0, Number(bet) || 0),
    betOn: ['red', 'black', 'green', 'number'].includes(betOn) ? betOn : 'red',
    num: num === '' || num == null ? null : Math.min(36, Math.max(0, Number(num) || 0)),
    target: WHEEL_TARGETS.some(([m]) => m === Number(target)) ? Number(target) : 2,
    risk: ['low', 'medium', 'high'].includes(risk) ? risk : 'medium',
    owner: owner || '',
  };
}
const casOpt = (value, label, selected, description = null) => {
  const o = new StringSelectMenuOptionBuilder().setValue(String(value)).setLabel(label.slice(0, 100)).setDefault(!!selected);
  if (description) o.setDescription(description.slice(0, 100));
  return o;
};
const casSelect = (id, placeholder, options) => new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25));

/** The bet presets between min and max — the config's bounds plus the usual round numbers. */
function betPresets(min, max) {
  const out = new Set([min, 5, 10, 25, 50, 100, 250, 500, 1000, max].filter((v) => v >= min && v <= max));
  return [...out].sort((a, b) => a - b).slice(0, 22);
}

async function casinoContext(i) {
  const cfg = (await config()).economy?.casino || {};
  const min = Math.max(1, Number(cfg.minBet) || 1), max = Math.max(min, Number(cfg.maxBet) || 100);
  const e = await api.economyUser(i.user.id);
  return { cfg, min, max, e, cur: curLabel(e.currency), balance: e.linked ? Number(e.points) || 0 : 0, enabled: cfg.enabled !== false };
}

/** Page 1: the games, one big entry each, with the ◀ Games ▶ bar underneath. */
async function casinoList(i, st, { update = false } = {}) {
  const { min, max, e, cur, balance, enabled } = await casinoContext(i);
  const S = (patch) => packCas({ ...st, ...patch });
  const first = CASINO_GAMES[0].id, last = CASINO_GAMES[CASINO_GAMES.length - 1].id;
  const opts = {
    title: '🎰 Casino',
    thumb: i.user.displayAvatarURL?.({ size: 128 }) || null,
    body: [
      e.linked ? `Balance **${n(balance)}** ${cur} · bets **${n(min)}–${n(max)}**` : `Bets **${n(min)}–${n(max)}** ${cur} · link your account to play`,
      !enabled ? '⛔ The casino is off right now.' : 'Pick a game — each page shows the rules, the odds and the options before you bet.',
    ],
    sections: CASINO_GAMES.map((g) => ({ text: `## ${g.emoji} ${g.name}\n-# ${g.desc}`, button: ui.btn(`cas:open:${S({ view: 'game', game: g.id })}`, 'Open', ButtonStyle.Primary) })),
    footer: 'The house edge only taxes what you win: a 1× bucket gives your bet back to the point.',
    buttons: [
      ui.btn(`cas:open:${S({ view: 'game', game: last })}`, '◀', ButtonStyle.Secondary),
      ui.btn('cas:noop', 'Games', ButtonStyle.Secondary, { disabled: true }),
      ui.btn(`cas:open:${S({ view: 'game', game: first })}`, '▶', ButtonStyle.Secondary),
      e.linked ? ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: 'level' }) : ui.btn('eco:link', 'Link my account', ButtonStyle.Primary, { emoji: 'link' }),
    ],
  };
  return update ? ui.update(i, opts) : ui.reply(i, opts);
}

/** One game's page: preview picture, rules, the bet + option menus, Play, and the nav bar. */
async function casinoMenu(i, st, { update = false } = {}) {
  if (st.view === 'list') return casinoList(i, st, { update });
  const { min, max, e, cur, balance, enabled } = await casinoContext(i);
  const idx = Math.max(0, CASINO_GAMES.findIndex((x) => x.id === st.game));
  const g = CASINO_GAMES[idx];
  const prev = CASINO_GAMES[(idx + CASINO_GAMES.length - 1) % CASINO_GAMES.length].id;
  const next = CASINO_GAMES[(idx + 1) % CASINO_GAMES.length].id;
  const bet = st.bet === 'all' ? Math.min(max, balance) : st.bet;
  const needsNumber = st.game === 'roulette' && st.betOn === 'number' && st.num == null;
  const canPlay = enabled && e.linked && bet >= min && bet <= max && bet <= balance && !needsNumber;

  const optionLine = st.game === 'roulette' ? `**Bet on** ${ROULETTE_BETS.find(([v]) => v === st.betOn)?.[1] || st.betOn}${st.betOn === 'number' ? (st.num == null ? ' — pick the number below' : ` **${st.num}**`) : ''}`
    : st.game === 'wheel' ? `**Going for** ${WHEEL_TARGETS.find(([m]) => m === st.target)?.[1] || `${st.target}×`}`
    : st.game === 'plinko' ? `**Risk** ${PLINKO_RISKS.find(([v]) => v === st.risk)?.[1] || st.risk}` : null;
  const why = !enabled ? '⛔ The casino is off right now.'
    : !e.linked ? '🔗 Link your BetterCommunity account to play — points live on the site.'
    : !bet ? `Pick a bet between **${n(min)}** and **${n(max)}** below.`
    : bet < min || bet > max ? `⚠ Bets go from **${n(min)}** to **${n(max)}**.`
    : bet > balance ? `⚠ You only have **${n(balance)}** ${cur}.`
    : needsNumber ? '🔢 Pick your number (0–36) below.' : null;

  const S = (patch) => packCas({ ...st, ...patch });
  const presets = betPresets(min, max);
  const betSel = casSelect(`cas:bet:${S({})}`, 'Bet', [
    ...presets.map((v) => casOpt(v, `${n(v)} ${cur}`, st.bet !== 'all' && v === st.bet)),
    ...(e.linked && balance >= min ? [casOpt('all', `All in — ${n(Math.min(max, balance))} ${cur}`, st.bet === 'all', balance > max ? `Capped at the ${n(max)} max bet` : 'Your whole balance')] : []),
    casOpt('custom', '✏️ Custom amount…', false, `Any amount from ${n(min)} to ${n(max)}`),
  ]);
  const optSel = st.game === 'roulette' ? casSelect(`cas:opt:${S({})}`, 'Bet on', ROULETTE_BETS.map(([v, l]) => casOpt(v, l, v === st.betOn, v === 'number' ? 'You will be asked for the number' : null)))
    : st.game === 'wheel' ? casSelect(`cas:opt:${S({})}`, 'Multiplier', WHEEL_TARGETS.map(([m, l]) => casOpt(m, l, m === st.target)))
    : st.game === 'plinko' ? casSelect(`cas:opt:${S({})}`, 'Risk', PLINKO_RISKS.map(([v, l]) => casOpt(v, l, v === st.risk)))
    : null;
  // A still of the table, drawn by the site (same renderer as the result cards) and attached.
  const png = await api.siteImage(`/og/casino/${encodeURIComponent(g.id)}/win.png?d=${encodeURIComponent(g.preview)}&a=${encodeURIComponent(n(bet || min))}`);
  const files = png ? [ui.attach(png, 'table.png')] : [];
  const buttons = [betSel, optSel,
    ui.btn(`cas:play:${S({})}`, canPlay ? `Play — ${n(bet)} ${cur}` : 'Play', ButtonStyle.Success, { emoji: 'casino', disabled: !canPlay }),
    ...(st.game === 'roulette' && st.betOn === 'number' ? [ui.btn(`cas:num:${S({})}`, st.num == null ? 'Pick a number' : `Number: ${st.num}`, ButtonStyle.Primary)] : []),
    ui.btn(`cas:open:${S({ game: prev })}`, '◀', ButtonStyle.Secondary),
    ui.btn(`cas:list:${S({ view: 'list' })}`, 'Games', ButtonStyle.Secondary),
    ui.btn(`cas:open:${S({ game: next })}`, '▶', ButtonStyle.Secondary),
    e.linked ? ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: 'level' }) : ui.btn('eco:link', 'Link my account', ButtonStyle.Primary, { emoji: 'link' }),
  ];
  const opts = {
    title: `${g.emoji} ${g.name}`,
    body: [
      ...g.rules,
      '',
      e.linked ? `Balance **${n(balance)}** ${cur} · bets **${n(min)}–${n(max)}**` : `Bets **${n(min)}–${n(max)}** ${cur}`,
      `**Bet** ${bet ? `${n(bet)} ${cur}${st.bet === 'all' ? ' (all in)' : ''}` : '—'}`,
      optionLine,
      why ? `\n${why}` : '\n✅ Ready — press **Play**. The result is posted in the channel.',
    ],
    image: png ? 'attachment://table.png' : null, files,
    footer: `Game ${idx + 1} / ${CASINO_GAMES.length} · ◀ ▶ to browse · the edge only taxes what you win`,
    buttons,
  };
  return update ? ui.update(i, opts) : ui.reply(i, opts);
}

async function casinoSetup(i) {
  const [, verb, ...rest] = i.customId.split(':');
  if (verb === 'noop') return i.deferUpdate();
  const st = unpackCas(rest);
  if (st.owner && st.owner !== i.user.id) return ui.line(i, 'That is somebody else’s table — run **/casino** to open your own.', { title: '🎰 Casino' });
  st.owner = i.user.id;
  if (verb === 'list') { st.view = 'list'; return casinoMenu(i, st, { update: true }); }
  if (verb === 'open') {
    // From a result card ("Change bet / game") this is a fresh reply; from the table itself
    // it edits in place. A message component interaction on a deferred/public reply cannot
    // be distinguished cheaply, so: update when the click comes from an ephemeral card.
    st.view = 'game';
    const ephemeral = !!(i.message?.flags?.has?.('Ephemeral'));
    return casinoMenu(i, st, { update: ephemeral });
  }
  if (verb === 'bet') {
    const v = i.values?.[0];
    if (v === 'custom') return casinoAmountModal(i, st);
    st.bet = v === 'all' ? 'all' : Math.max(0, Number(v) || 0);
    return casinoMenu(i, st, { update: true });
  }
  if (verb === 'opt') {
    const v = i.values?.[0];
    if (st.game === 'roulette') { st.betOn = ['red', 'black', 'green', 'number'].includes(v) ? v : st.betOn; if (st.betOn === 'number' && st.num == null) return casinoNumberModal(i, st); }
    else if (st.game === 'wheel') st.target = WHEEL_TARGETS.some(([m]) => m === Number(v)) ? Number(v) : st.target;
    else if (st.game === 'plinko') st.risk = ['low', 'medium', 'high'].includes(v) ? v : st.risk;
    return casinoMenu(i, st, { update: true });
  }
  if (verb === 'num') return casinoNumberModal(i, st);
  if (verb === 'play') {
    const cfg = (await config()).economy?.casino || {};
    const max = Math.max(1, Number(cfg.maxBet) || 100);
    let bet = st.bet;
    if (bet === 'all') { const e = await api.economyUser(i.user.id); bet = Math.min(max, Number(e.points) || 0); }
    if (!bet) return casinoMenu(i, st, { update: true });
    return playCasino(i, { bet, game: st.game, betOn: st.betOn, num: st.num, target: st.target, risk: st.risk });
  }
  return casinoMenu(i, st, { update: true });
}

function casinoAmountModal(i, st) {
  const modal = new ModalBuilder().setCustomId(`casm:bet:${packCas(st)}`).setTitle('Your bet')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v').setLabel('How many points?').setStyle(TextInputStyle.Short).setPlaceholder('e.g. 42').setMaxLength(9).setRequired(true)));
  return i.showModal(modal);
}
function casinoNumberModal(i, st) {
  const modal = new ModalBuilder().setCustomId(`casm:num:${packCas(st)}`).setTitle('Roulette — your number')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v').setLabel('A number from 0 to 36').setStyle(TextInputStyle.Short).setPlaceholder('17').setMaxLength(2).setRequired(true)));
  return i.showModal(modal);
}
async function casinoModal(i) {
  const [, kind, ...rest] = i.customId.split(':');
  const st = unpackCas(rest);
  if (st.owner && st.owner !== i.user.id) return ui.line(i, 'That is somebody else’s table.', { title: '🎰 Casino' });
  const raw = (i.fields.getTextInputValue('v') || '').replace(/[^0-9]/g, '');
  const v = raw === '' ? NaN : Number(raw);
  if (kind === 'bet') st.bet = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : st.bet;
  else if (kind === 'num') { st.betOn = 'number'; st.num = Number.isFinite(v) && v >= 0 && v <= 36 ? v : st.num; }
  // A modal opened from a component can edit that component's message; one opened elsewhere
  // (it cannot happen here, but a stale client can) gets a fresh card instead.
  return casinoMenu(i, st, { update: typeof i.isFromMessage === 'function' && i.isFromMessage() });
}

async function cmdAppeal(i) {
  const ban = i.guildId ? guildBan(await config(), i.guildId) : null;
  if (!ban) return ui.line(i, 'Good news — this server is not blocked from the bot. Everything works normally here.', { title: '✅ Appeal', color: ui.GOOD });
  const ref = ban.banId || i.guildId;
  return ui.reply(i, {
    title: '📝 Appeal',
    body: ['This server is blocked from the bot.', '', `**Reference:** \`${ref}\``, ...(ban.reason ? [`**Reason:** ${ban.reason}`] : []), '', 'To contest it, contact us and quote the reference above.'],
    buttons: [ui.btn(`${SITE_URL}/contact`, 'Contact us')],
  });
}

async function cmdWarn(i) {
  const member = i.options.getUser('member');
  const reason = i.options.getString('reason');
  // A moderator warning themselves is a mis-click; warning the bot is a joke that leaves a
  // real row behind. Both refused here rather than recorded and explained later.
  if (member.id === i.user.id) return eReply(i, 'You cannot warn yourself.', { title: '⚠ Warn' });
  if (member.bot) return eReply(i, 'Bots do not get warnings.', { title: '⚠ Warn' });

  const r = await api.warn(member.id, reason, i.guildId, i.user.username);
  if (!r) return eReply(i, 'The site refused that — the warning was NOT recorded.', { title: '⚠ Warn', color: ui.BAD });

  // What it triggered is said here, in the channel, because a moderator who does not know the
  // third warning bans somebody will keep issuing them.
  const what = r.triggered
    ? (r.triggered.kind === 'timeout' ? `timed out for ${r.triggered.minutes} minute(s)`
      : r.triggered.kind === 'kick' ? 'removed from the server' : 'banned')
    : null;
  return ui.reply(i, {
    title: '⚠ Warn', color: what ? ui.BAD : BRAND, thumb: member.displayAvatarURL?.({ size: 128 }) || null,
    body: [`**${member.username}** warned — that makes **${r.count}**.`, `Reason: ${reason}`, what ? `\n**Warning ${r.count} means they are ${what}.** Queued; the result shows on the site.` : null],
  });
}

async function cmdWarnings(i) {
  const member = i.options.getUser('member');
  const r = await api.warnList(member.id);
  const warns = r?.warns || [];
  if (!warns.length) return eReply(i, `**${member.username}** has no warnings.`, { title: '⚠ Warnings' });
  // Revoked ones are shown, struck through: a record that hides what was taken back is not a
  // record, and "why is he at two when I gave him three" has to have an answer here.
  const lines = warns.slice(0, 10).map((w) => {
    const when = new Date(w.createdAt).toISOString().slice(0, 10);
    const text = `${when} — ${w.reason}${w.issuedByLabel ? ` (${w.issuedByLabel.split(' · ')[0]})` : ''}`;
    return w.revokedAt ? `~~${text}~~ withdrawn` : text;
  });
  return ui.reply(i, {
    title: '⚠ Warnings', thumb: member.displayAvatarURL?.({ size: 128 }) || null,
    body: [`**${member.username}** — **${r.active ?? warns.filter((w) => !w.revokedAt).length}** standing`, '', ...lines, warns.length > 10 ? `\n…and ${warns.length - 10} more on the site.` : null],
  });
}

async function cmdGiveaway(i) {
  const prize = i.options.getString('prize');
  const minutes = i.options.getInteger('minutes');
  const winners = i.options.getInteger('winners') || 1;
  try {
    await api.giveawayCreate({ prize, channelId: i.channelId, durationMinutes: minutes, winnersCount: winners });
    return eReply(i, `Giveaway for **${prize}** created (${winners} winner${winners === 1 ? '' : 's'}, ${minutes} min). It appears here within ~30s.`, { title: '🎉 Giveaway', color: ui.GOOD });
  } catch (e) {
    return eReply(i, 'Could not create the giveaway — try again in a moment.', { title: '🎉 Giveaway', color: ui.BAD });
  }
}

async function cmdVerify(i) {
  if (!i.member) return eReply(i, 'Run this in the server.');
  const res = await checkGating(i.member).catch(() => null);
  if (res == null) return eReply(i, 'Gated access is not configured on this server.');
  const status = [`Discord linked: **${res.linked ? 'yes' : 'no'}**`, `BMM creator id: **${res.hasBmm ? 'yes' : 'no'}**`].join(' · ');
  // Per-role result lines: ✅ granted / 🔒 not eligible for each configured rule.
  const roleLines = (res.roles || []).map((r) => `${r.ok ? '✅' : '🔒'} <@&${r.roleId}> — ${r.ok ? 'granted' : 'not eligible'}`);
  const anyGranted = (res.roles || []).some((r) => r.ok);
  return ui.reply(i, {
    title: anyGranted ? '✅ Roles refreshed' : '🔒 No roles yet', color: anyGranted ? ui.GOOD : BRAND,
    body: [status, '', roleLines.length ? roleLines.join('\n') : 'No roles configured.', anyGranted ? null : '\nUse **/link**, link your creator id on the site, then run **/refreshroles**.'],
    buttons: anyGranted ? [] : [ui.btn(`${SITE_URL}/profile`, 'Link on the site'), ui.btn('eco:link', 'Get a link code', ButtonStyle.Primary, { emoji: 'link' })],
  });
}

async function cmdLink(i) {
  try {
    const r = await api.issueLink(i.user.id, i.user.username);
    if (r.linked) return ui.reply(i, { title: '🔗 Already linked', color: ui.GOOD, body: 'Your Discord is already linked to a BetterCommunity account.', buttons: ecoButtons('') });
    return ui.reply(i, {
      title: '🔗 Link your account',
      body: [`Enter this code on your profile page to link your account:`, `# ${r.code}`, '-# expires in 15 min'],
      buttons: [ui.btn(`${SITE_URL}/profile`, 'Open my profile', ButtonStyle.Link)],
    });
  } catch {
    return eReply(i, 'Could not create a link code right now — try again later.', { color: ui.BAD });
  }
}

// The "Get a link code" button on the not-linked cards runs /link.
export async function handleLinkButton(i) { return cmdLink(i); }
