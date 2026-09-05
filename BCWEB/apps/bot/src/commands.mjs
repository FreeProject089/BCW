// Slash commands + interaction routing. Every response is a Components V2 card (see ui.mjs).
import { SlashCommandBuilder, PermissionFlagsBits, ButtonStyle, MessageFlags } from 'discord.js';
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
  new SlashCommandBuilder().setName('inventory').setDescription('What you bought with points, and what is still on its way'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top members by level'),
  new SlashCommandBuilder().setName('casino').setDescription('Bet points on a game of chance')
    .addIntegerOption((o) => o.setName('bet').setDescription('How many points to bet').setRequired(true).setMinValue(1))
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
    if (i.commandName === 'leaderboard') return cmdLeaderboard(i);
    if (i.commandName === 'casino') return cmdCasino(i);
    return;
  }
  if (i.isButton() && i.customId.startsWith('gw:enter:')) return handleGiveawayButton(i);
  if (i.isButton() && i.customId.startsWith('shop:buy:')) return handleShopBuy(i);
  if (i.isButton() && i.customId.startsWith('shop:page:')) return cmdShop(i, Number(i.customId.split(':')[2]) || 0, true);
  if (i.isButton() && i.customId === 'eco:link') return cmdLink(i);
  if (i.isButton() && i.customId === 'eco:level') return cmdLevel(i);
  if (i.isButton() && i.customId === 'eco:shop') return cmdShop(i);
  if (i.isButton() && i.customId === 'eco:inventory') return cmdInventory(i);
  if (i.isButton() && i.customId === 'eco:leaderboard') return cmdLeaderboard(i, true);
  if (i.isButton() && i.customId.startsWith('casino:again:')) return casinoAgain(i);
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
  except !== 'level' && ui.btn('eco:level', 'My level', ButtonStyle.Secondary, { emoji: '⭐' }),
  except !== 'shop' && ui.btn('eco:shop', 'Shop', ButtonStyle.Secondary, { emoji: '🛒' }),
  except !== 'inventory' && ui.btn('eco:inventory', 'Inventory', ButtonStyle.Secondary, { emoji: '🎒' }),
  except !== 'leaderboard' && ui.btn('eco:leaderboard', 'Leaderboard', ButtonStyle.Secondary, { emoji: '🏆' }),
];
const notLinked = (i) => ui.reply(i, {
  title: 'Not linked yet', color: ui.INFO,
  body: 'Link your BetterCommunity account first — it takes a minute and it is how your XP and points get a home.',
  buttons: [ui.btn(`${SITE_URL}/profile`, 'Open my profile'), ui.btn('eco:link', 'Get a link code', ButtonStyle.Primary, { emoji: '🔗' })],
});

async function cmdLevel(i) {
  const e = await api.economyUser(i.user.id);
  if (!e.linked) return notLinked(i);
  const cur = curLabel(e.currency);
  const pct = ui.bar(e.xpThisLevel, e.xpForNext);
  return ui.reply(i, {
    title: `⭐ Level ${e.level}`,
    thumb: i.user.displayAvatarURL?.({ size: 128 }) || null,
    body: [
      `**${e.displayName}** · **${n(e.points)}** ${cur}`,
      `${pct}`,
      `-# ${n(e.xpThisLevel)} / ${n(e.xpForNext)} XP to level ${e.level + 1}`,
      '',
      `💬 ${n(e.stats?.messages)} messages · ✨ ${n(e.stats?.reactions)} reactions · 🎙️ ${Math.floor((e.stats?.voiceSeconds || 0) / 3600)}h in voice`,
    ],
    buttons: [...ecoButtons('level'), ui.btn(`${SITE_URL}/dashboard?s=economy`, 'Open on the site')],
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
  const png = await api.siteImage(`/og/profile/${encodeURIComponent(e.userId)}.png`);
  const files = png ? [ui.attach(png, 'profile.png')] : [];
  return ui.editReply(i, {
    title: `👤 ${e.displayName}`,
    thumb: target.displayAvatarURL?.({ size: 128 }) || null,
    body: [
      `**Level ${e.level}** · **${n(e.points)}** ${cur}`,
      `💬 ${n(e.stats?.messages)} messages · ✨ ${n(e.stats?.reactions)} reactions · 🎙️ ${Math.floor((e.stats?.voiceSeconds || 0) / 3600)}h in voice`,
    ],
    image: png ? 'attachment://profile.png' : null, files,
    buttons: [ui.btn(url, 'View full profile'), ...(target.id === i.user.id ? ecoButtons('') : [])],
  });
}

// What each shop kind hands over, phrased for the buyer.
const SHOP_KIND_LABEL = {
  badge: '🏅 profile badge', role: '🎭 Discord role', pool: '💾 storage pool',
  boost: '🚀 catalog boost', hosting: '🖥️ free hosting', promo: '🎟️ promo code', custom: '🎁 reward',
};
const PAGE = 8;

// The shop: one section per item with its own Buy button. Paged eight at a time — a section
// with a button is two components, and a V2 message holds forty.
async function cmdShop(i, page = 0, isUpdate = false) {
  const [eco, me] = await Promise.all([api.economyConfig(), api.economyUser(i.user.id)]);
  const respond = (opts) => (isUpdate ? ui.update(i, opts) : ui.reply(i, opts));
  if (!eco.enabled) return respond({ title: '🛒 Shop', body: 'The economy is currently off.' });
  const items = (Array.isArray(eco.shop) ? eco.shop : []).filter((x) => x.name && !(x.kind === 'badge' && !x.ref));
  if (!items.length) return respond({ title: '🛒 Shop', body: 'The shop is empty for now — check back later.', buttons: ecoButtons('shop') });
  const cur = eco.currencyEmoji || eco.currencyName || 'points';
  const pages = Math.ceil(items.length / PAGE);
  page = Math.max(0, Math.min(pages - 1, page));
  const slice = items.slice(page * PAGE, page * PAGE + PAGE);
  const balance = me.linked ? Number(me.points || 0) : null;
  return respond({
    title: '🛒 Points shop',
    body: balance != null ? `You have **${n(balance)}** ${cur}.` : 'Link your account to buy — **/link**.',
    sections: slice.map((x) => {
      const cost = Number(x.cost) || 0;
      const can = balance != null && balance >= cost;
      return {
        text: `**${x.name}** — ${n(cost)} ${cur}\n-# ${SHOP_KIND_LABEL[x.kind] || '🎁 reward'}${x.desc ? ` · ${x.desc}` : ''}`,
        button: ui.btn(`shop:buy:${x.id}`, can ? 'Buy' : `${n(cost)}`, can ? ButtonStyle.Success : ButtonStyle.Secondary, { disabled: !can, emoji: can ? '🛍️' : null }),
      };
    }),
    footer: pages > 1 ? `Page ${page + 1} / ${pages} · everything you buy lands in /inventory` : 'Everything you buy lands in /inventory — and on the site, under Dashboard → Shop.',
    buttons: [
      pages > 1 && ui.btn(`shop:page:${page - 1}`, 'Previous', ButtonStyle.Secondary, { disabled: page === 0 }),
      pages > 1 && ui.btn(`shop:page:${page + 1}`, 'Next', ButtonStyle.Secondary, { disabled: page >= pages - 1 }),
      ...ecoButtons('shop'),
    ],
  });
}

// A Buy button was pressed. The API is authoritative — it re-reads the price, debits atomically,
// fulfils badge/pool/boost/hosting itself and records the purchase. We only translate the result.
async function handleShopBuy(i) {
  const itemId = i.customId.slice('shop:buy:'.length);
  const r = await api.economyBuy(i.user.id, itemId);
  if (r.ok) {
    const d = r.delivery || {};
    const lines = [`You bought **${r.item?.name || 'item'}**. Balance: **${n(r.points)}**.`];
    if (d.kind === 'badge') lines.push(`🏅 The **${d.badge}** badge is now on your BCWEB profile.`);
    else if (d.code) lines.push(`🎟️ Redeem this on the site: \`${d.code}\`${d.amount ? ` (${d.amount})` : ''} — it is also kept in your inventory.`);
    else if (r.item?.kind === 'role') lines.push('🎭 An admin will assign your role shortly — it shows as *pending* in your inventory until then.');
    else lines.push('🎁 An admin has been notified to deliver it — *pending* in your inventory until then.');
    return ui.reply(i, { title: '✅ Purchase complete', color: ui.GOOD, body: lines, buttons: [ui.btn('eco:inventory', 'Inventory', ButtonStyle.Primary, { emoji: '🎒' }), ui.btn('eco:shop', 'Back to the shop')] });
  }
  if (r.error === 'not_linked') return notLinked(i);
  const why = r.error === 'insufficient' ? `You need **${n(r.cost)}** points — you have ${n(r.points)}.`
    : r.error === 'already_owned' ? 'You already own that badge.'
    : r.error === 'badge_unavailable' ? 'That badge is no longer available.'
    : r.error === 'no_such_item' ? 'That item is gone from the shop.'
    : r.error === 'economy_off' ? 'The economy is currently off.'
    : 'That purchase could not be completed.';
  return ui.reply(i, { title: '🛒 Shop', color: ui.BAD, body: why, buttons: [ui.btn('eco:shop', 'Back to the shop')] });
}

// Everything bought with points, newest first, with the codes that are theirs to see.
async function cmdInventory(i) {
  const e = await api.economyUser(i.user.id);
  if (!e.linked) return notLinked(i);
  const r = await api.economyPurchases(i.user.id);
  const rows = Array.isArray(r.purchases) ? r.purchases : [];
  if (!rows.length) return ui.reply(i, { title: '🎒 Inventory', body: 'Nothing here yet — the shop is one button away.', buttons: ecoButtons('inventory') });
  const pending = rows.filter((x) => x.status === 'pending').length;
  const lines = rows.slice(0, 15).map((x) => {
    const when = new Date(x.createdAt).toISOString().slice(0, 10);
    const d = x.delivery || {};
    const extra = d.code ? ` · code \`${d.code}\`` : d.badge ? ` · badge **${d.badge}**` : '';
    return `${x.status === 'pending' ? '⏳' : '✅'} **${x.name}** — ${n(x.cost)} pts · ${when}${extra}`;
  });
  return ui.reply(i, {
    title: '🎒 Inventory',
    body: [pending ? `**${pending}** still on the way (an admin hands those out).` : `${rows.length} purchase${rows.length === 1 ? '' : 's'}.`, '', ...lines, rows.length > 15 ? `-# …and ${rows.length - 15} more on the site.` : null],
    buttons: [ui.btn(`${SITE_URL}/dashboard?s=economy`, 'Open on the site'), ...ecoButtons('inventory')],
  });
}

async function cmdLeaderboard(i, isUpdate = false) {
  const r = await api.economyLeaderboard(i.user.id);
  const rows = (r.members || []).slice(0, 10);
  const respond = (opts) => (isUpdate ? ui.update(i, opts) : ui.reply(i, opts, { ephemeral: false }));
  if (!rows.length) return respond({ title: '🏆 Leaderboard', body: 'Nobody has earned XP yet — say something.' });
  const medal = (k) => k === 0 ? '🥇' : k === 1 ? '🥈' : k === 2 ? '🥉' : `**${k + 1}.**`;
  const body = rows.map((m, k) => `${medal(k)} **${m.displayName}** — Lv **${m.level}** · ${n(m.points)} pts`);
  const you = r.me ? `\nYou: **#${r.me.rank}** · Lv ${r.me.level} · ${n(r.me.points)} pts` : '';
  return respond({
    title: '🏆 Leaderboard',
    body: [...body, you],
    footer: r.total ? `${n(r.total)} members have a level · updates as XP lands` : null,
    buttons: [ui.btn('eco:leaderboard', 'Refresh', ButtonStyle.Secondary, { emoji: '🔄' }), ui.btn('eco:level', 'My level', ButtonStyle.Secondary, { emoji: '⭐' }), ui.btn(`${SITE_URL}/users`, 'Members on the site')],
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
  const r = await api.economyCasino(i.user.id, bet, mult);
  if (!r.ok) {
    if (r.error === 'not_linked') return notLinked(i);
    const msg = r.error === 'casino_off' ? 'The casino is off.'
      : r.error === 'insufficient' ? "You don't have enough points for that bet."
      : r.error === 'bad_bet' ? `Your bet must be between ${r.min} and ${r.max}.`
      : 'Could not place that bet.';
    return ui.reply(i, { title: '🎰 Casino', body: msg, color: ui.BAD, buttons: [ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: '⭐' })] });
  }
  // The GIF takes a moment to render; a deferred reply keeps Discord from timing the
  // interaction out, and the play is public — the table is the fun part.
  await i.deferReply();
  const won = r.delta > 0; // a 0.3× plinko bucket returns part of the bet — still a loss
  const amt = n(won ? r.delta : bet);
  // Animated GIF of the spin, seeded per play so every roll looks different, rendered by the
  // site and ATTACHED (fetched over the internal API address, so Discord never has to reach
  // the site). The PNG still is the fallback the API itself falls back to.
  const q = `d=${encodeURIComponent(card)}&a=${encodeURIComponent(amt)}&s=${Math.floor(Math.random() * 4294967295)}`;
  const gif = await api.siteImage(`/og/casino/${encodeURIComponent(game)}/${won ? 'win' : 'lose'}.gif?${q}`);
  const files = gif ? [ui.attach(gif, 'casino.gif')] : [];
  const line = won
    ? `${detail}\n🎉 You won **+${n(r.delta)}** — balance **${n(r.points)}**.`
    : `${detail}\n💀 You lost **${n(bet)}**. Balance **${n(r.points)}**.`;
  // "Play again" re-runs the same bet with the same options — the custom id carries them (and
  // the player's id, so nobody spends somebody else's points from their button).
  const again = ['casino', 'again', game, bet, opts.betOn || '', opts.num ?? '', opts.target || '', opts.risk || '', i.user.id].join(':');
  return ui.editReply(i, {
    title: won ? `🎰 ${GAME_NAME[game] || 'Casino'} — you win!` : `🎰 ${GAME_NAME[game] || 'Casino'} — you lose`,
    color: won ? 0x248046 : 0xda373c,
    thumb: i.user.displayAvatarURL?.({ size: 128 }) || null,
    body: line,
    image: gif ? 'attachment://casino.gif' : null, files,
    buttons: [ui.btn(again, `Play again (${n(bet)})`, won ? ButtonStyle.Success : ButtonStyle.Primary, { emoji: '🔁' }), ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: '⭐' })],
  });
}

async function cmdCasino(i) {
  const bet = i.options.getInteger('bet');
  const game = i.options.getString('game') || 'coinflip';
  const betOn = i.options.getString('bet_on') || 'red';
  const num = i.options.getInteger('number');
  if (game === 'roulette' && betOn === 'number' && num == null) return ui.line(i, 'Pick the number too: `/casino game:roulette bet_on:number number:17`', { title: '🎡 Roulette' });
  const target = i.options.getInteger('target') || 2;
  const risk = ['low', 'medium', 'high'].includes(i.options.getString('risk')) ? i.options.getString('risk') : 'medium';
  return playCasino(i, { bet, game, betOn, num, target, risk });
}

async function casinoAgain(i) {
  const [, , game, bet, betOn, num, target, risk, owner] = i.customId.split(':');
  if (owner && owner !== i.user.id) return ui.line(i, 'That is somebody else’s bet — run **/casino** to place your own.', { title: '🎰 Casino' });
  return playCasino(i, {
    bet: Math.max(1, Number(bet) || 1), game: GAME_NAME[game] ? game : 'coinflip',
    betOn: betOn || 'red', num: num === '' ? null : Number(num), target: Number(target) || 2, risk: ['low', 'medium', 'high'].includes(risk) ? risk : 'medium',
  });
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
    buttons: anyGranted ? [] : [ui.btn(`${SITE_URL}/profile`, 'Link on the site'), ui.btn('eco:link', 'Get a link code', ButtonStyle.Primary, { emoji: '🔗' })],
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
