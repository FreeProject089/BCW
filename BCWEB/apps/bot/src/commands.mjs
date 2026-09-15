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
import { tr } from './i18n.mjs';
import { cmdSetup, onboardingSelect } from './features/onboarding.mjs';
import { cmdConfig, configComponent } from './features/configure.mjs';
import { openLive, liveComponent, liveModal, joinByCode, listLobbies, LIVE_GAMES, MULTI_GAMES, VISIBILITIES } from './features/casino-live.mjs';

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
  // A MEMBER giveaway (anyone can start one), Discord-only, capped at 5 active per server. Prize
  // is whatever the host hands over — no site/inventory reward (staff giveaways on the dashboard
  // do the inventory prizes). Not gated to Manage-Server; the 5/server cap is the guard.
  new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway in this channel (max 5 active per server)')
    .addStringOption((o) => o.setName('prize').setDescription('What to give away').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('How long it runs (minutes)').setMinValue(1).setMaxValue(86400).setRequired(true))
    .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(50))
    .setDMPermission(false),
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
      { name: 'Crash — cash out before the multiplier breaks (live table)', value: 'crash' },
      { name: 'Race — six cars, pick yours, 6× (live table)', value: 'race' },
      { name: 'Pot — everyone stakes, one takes it all, odds ∝ stake (live, 2+ players)', value: 'pot' },
    ))
    .addStringOption((o) => o.setName('bet_on').setDescription('Roulette: what you bet on (default red)').addChoices(
      { name: 'Red (2×)', value: 'red' }, { name: 'Black (2×)', value: 'black' }, { name: 'Green / zero (14×)', value: 'green' }, { name: 'A number (35×)', value: 'number' }))
    .addIntegerOption((o) => o.setName('number').setDescription('Roulette: the number, 0–36 (with bet_on = number)').setMinValue(0).setMaxValue(36))
    .addIntegerOption((o) => o.setName('target').setDescription('Wheel: the multiplier you go for (default 2)').addChoices(
      { name: '2× (45%)', value: 2 }, { name: '3× (24%)', value: 3 }, { name: '5× (16%)', value: 5 }, { name: '10× (9%)', value: 10 }, { name: '20× (4%)', value: 20 }, { name: '50× (2%)', value: 50 }))
    .addStringOption((o) => o.setName('risk').setDescription('Plinko: bucket table (default medium)').addChoices(
      { name: 'Low — 0.5× to 5×', value: 'low' }, { name: 'Medium — 0.3× to 13×', value: 'medium' }, { name: 'High — 0.2× to 50×', value: 'high' }))
    // Live tables: who may sit (chosen when the table opens), a code to join one from ANY
    // server or DM, and the list of open tables this reader may see.
    .addStringOption((o) => o.setName('visibility').setDescription('Live table: who may join (default: this server)').addChoices(
      { name: 'Public — listed everywhere, anyone with the code', value: 'public' }, { name: 'This server — members only, listed here', value: 'server' }, { name: 'Private — code only, unlisted', value: 'private' }))
    .addStringOption((o) => o.setName('join').setDescription('Join a live table by its 6-character code (from any server or DM)').setMinLength(6).setMaxLength(8))
    .addBooleanOption((o) => o.setName('lobbies').setDescription('List the open live tables you can join')),
  // The welcome card again — link, language for this server, dashboard. Posted on join too.
  new SlashCommandBuilder().setName('config').setDescription('Configure this server’s bot — moderation and its log channel (server managers)'),
  new SlashCommandBuilder().setName('setup').setDescription('The bot’s welcome card: link your account, pick its language here, open the dashboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
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
    if (i.commandName === 'setup') return cmdSetup(i);
    if (i.commandName === 'config') return cmdConfig(i);
    return;
  }
  if (i.isButton() && i.customId.startsWith('gw:enter:')) return handleGiveawayButton(i);
  if (i.isButton() && i.customId.startsWith('shop:buy:')) return handleShopBuy(i);
  if (i.isButton() && i.customId.startsWith('shop:page:')) return cmdShop(i, Number(i.customId.split(':')[2]) || 0, true);
  if (i.isButton() && i.customId.startsWith('inv:reveal:')) return invReveal(i);
  if (i.isButton() && i.customId.startsWith('inv:gift:')) return invGiftModal(i);
  if (i.isModalSubmit() && i.customId.startsWith('invm:gift:')) return invGiftSubmit(i);
  if (i.isButton() && i.customId.startsWith('eco:lb:')) { const seg = i.customId.split(':'); return cmdLeaderboard(i, true, seg[2] === 'refresh' ? seg[3] : seg[2]); }
  if (i.isButton() && i.customId === 'eco:link') return cmdLink(i);
  if (i.isButton() && i.customId === 'eco:level') return cmdLevel(i);
  if (i.isButton() && i.customId === 'eco:shop') return cmdShop(i);
  if (i.isButton() && i.customId === 'eco:inventory') return cmdInventory(i);
  if (i.isButton() && i.customId === 'eco:history') return cmdHistory(i, '');
  if (i.isButton() && i.customId === 'eco:leaderboard') return cmdLeaderboard(i, false, 'server');
  if (i.isButton() && i.customId.startsWith('casino:again:')) return casinoAgain(i);
  if (i.isStringSelectMenu() && i.customId === 'onb:lang') return onboardingSelect(i);
  // Before the panel catch-all below, which claims every remaining component.
  if ((i.isStringSelectMenu() || i.isChannelSelectMenu()) && i.customId.startsWith('cfg:')) return configComponent(i);
  if ((i.isButton() || i.isStringSelectMenu()) && i.customId.startsWith('cas:')) return casinoSetup(i);
  if (i.isModalSubmit() && i.customId.startsWith('casm:')) return casinoModal(i);
  // The live tables (features/casino-live.mjs): join / pick / start / cash out / new round.
  if (i.isButton() && i.customId.startsWith('cl:')) return liveComponent(i);
  if (i.isModalSubmit() && i.customId.startsWith('clm:')) return liveModal(i);
  // Before the voice panel's catch-all, which claims every remaining component interaction.
  // It returns false when the custom id is not one of its own, so this stays a filter and
  // not a fork somebody has to keep in sync.
  if (await handleRolePanelInteraction(i)) return;
  if (i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) return handlePanelInteraction(i);
}

// ── B-econ: levelling / economy commands ─────────────────────────────────────
const curLabel = (c) => c?.emoji || c?.name || 'points';
const n = (x) => Number(x || 0).toLocaleString('en-US');
// `t` is the reader's translator when the caller has one; without it the English labels
// stand, so a call site not yet converted still renders.
const ecoButtons = (except = '', t = null) => {
  const L = (k, d) => (t ? t(k) : d);
  return [
    except !== 'level' && ui.btn('eco:level', L('btn.level', 'My level'), ButtonStyle.Secondary, { emoji: 'level' }),
    except !== 'shop' && ui.btn('eco:shop', L('btn.shop', 'Shop'), ButtonStyle.Secondary, { emoji: 'shop' }),
    except !== 'inventory' && ui.btn('eco:inventory', L('btn.inventory', 'Inventory'), ButtonStyle.Secondary, { emoji: 'inventory' }),
    except !== 'leaderboard' && ui.btn('eco:leaderboard', L('btn.leaderboard', 'Leaderboard'), ButtonStyle.Secondary, { emoji: 'leaderboard' }),
  ];
};
const notLinked = async (i) => {
  const { t } = await tr(i);
  return ui.reply(i, {
    title: t('notlinked.title'), color: ui.INFO,
    body: t('notlinked.body'),
    buttons: [ui.btn(`${SITE_URL}/profile`, t('link.open'), ButtonStyle.Secondary, { emoji: 'site' }), ui.btn('eco:link', t('btn.link'), ButtonStyle.Primary, { emoji: 'link' })],
  });
};

// The site's own avatar for a linked member, attached — it is drawn by the site, which Discord
// may not be able to reach. Returns { thumb, files } to spread into a card.
async function siteAvatar(e, name = 'avatar.png') {
  const png = e?.avatarPath ? await api.siteImage(e.avatarPath) : null;
  return png ? { thumb: `attachment://${name}`, files: [ui.attach(png, name)] } : { thumb: null, files: [] };
}

async function cmdLevel(i) {
  const [{ t }, e] = await Promise.all([tr(i), api.economyUser(i.user.id)]);
  const cur = curLabel(e.currency);
  const rates = e.rates || {};
  const rateLine = t('level.rates', { m: n(rates.message), r: n(rates.reaction), v: n(rates.voiceMinute) });
  const statsOf = (st) => [
    { text: t('stat.messages', { i: ui.ic('messages'), n: n(st?.messages) }) },
    { text: t('stat.reactions', { i: ui.ic('reactions'), n: n(st?.reactions) }) },
    { text: t('stat.voice', { i: ui.ic('voice'), h: Math.floor((st?.voiceSeconds || 0) / 3600), m: Math.floor(((st?.voiceSeconds || 0) % 3600) / 60) }) },
  ];
  // Not linked: the member still earns — the card shows what is waiting, and the one thing
  // to do about it. The old reply said "nothing accrues", which had become untrue.
  if (!e.linked) {
    const sh = e.shadow;
    const body = sh
      ? [
        `**${i.user.displayName || i.user.username}** · ${t('level.unlinked')}`,
        `${ui.bar(sh.xpThisLevel, sh.xpForNext)}  ${t('level.xp', { a: n(sh.xpThisLevel), b: n(sh.xpForNext) })}`,
        t('level.waiting', { i: ui.ic('wallet'), n: n(sh.points), cur }),
      ]
      : [t('level.nothing'), '', t('level.nothing2')];
    return ui.reply(i, {
      title: t('level.title', { n: sh ? sh.level : 0 }),
      thumb: i.user.displayAvatarURL?.({ size: 128 }) || null,
      color: ui.INFO,
      body,
      sections: sh ? statsOf(sh.stats) : [],
      footer: rateLine,
      buttons: [ui.btn('eco:link', t('btn.link'), ButtonStyle.Primary, { emoji: 'link' }), ui.btn('eco:leaderboard', t('btn.leaderboard'), ButtonStyle.Secondary, { emoji: 'leaderboard' })],
    });
  }
  const av = await siteAvatar(e);
  const next = Math.max(0, (e.xpForNext || 0) - (e.xpThisLevel || 0));
  return ui.reply(i, {
    title: t('level.title', { n: e.level }),
    thumb: av.thumb || i.user.displayAvatarURL?.({ size: 128 }) || null, files: av.files,
    body: [
      `**${e.displayName}**${e.badges?.length ? ` · ${ui.ic('medal')} ${e.badges.map((b) => b.name).join(' · ')}` : ''}`,
      `${ui.bar(e.xpThisLevel, e.xpForNext)}  ${t('level.xp', { a: n(e.xpThisLevel), b: n(e.xpForNext) })}`,
      `-# ${t('level.next', { n: n(next), l: e.level + 1 })}`,
      `${ui.ic('coin')} **${n(e.points)}** ${cur}`,
    ],
    sections: statsOf(e.stats),
    footer: rateLine,
    buttons: [...ecoButtons('level', t), ui.btn('eco:history', t('btn.history'), ButtonStyle.Secondary, { emoji: 'history' }), ui.btn(`${SITE_URL}/dashboard?s=economy`, t('btn.site'), ButtonStyle.Secondary, { emoji: 'site' })],
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
      e.badges?.length ? `${ui.ic('medal')} ${e.badges.map((b) => `**${b.name}**`).join(' · ')}` : '-# No badges yet',
      `${ui.ic('messages')} ${n(e.stats?.messages)} messages · ${ui.ic('reactions')} ${n(e.stats?.reactions)} reactions · ${ui.ic('voice')} ${Math.floor((e.stats?.voiceSeconds || 0) / 3600)}h in voice`,
    ],
    image: png ? 'attachment://profile.png' : null, files,
    buttons: [ui.btn(url, 'View full profile', ButtonStyle.Secondary, { emoji: 'site' }), ...(target.id === i.user.id ? ecoButtons('') : [])],
  });
}

// What each shop kind hands over, phrased for the buyer. Functions, not a frozen map, so the
// glyph resolves through ui.ic() at call time — an admin's custom icon wins, and the default
// is the same unicode as before. (A module-load-time map would freeze the default.)
const SHOP_KIND_WORD = {
  badge: 'profile badge', role: 'Discord role', pool: 'storage pool',
  boost: 'catalog / repo boost', hosting: 'free hosting', promo: 'promo code', custom: 'reward',
};
const SHOP_KIND_ICON = { badge: 'badge', role: 'role', pool: 'pool', boost: 'boost', hosting: 'hosting', promo: 'promo', custom: 'gift' };
const shopKindLabel = (k) => `${ui.ic(SHOP_KIND_ICON[k] || 'gift') || ''} ${SHOP_KIND_WORD[k] || 'reward'}`.trim();
const tagLabel = (k) => `${ui.ic(k) || ''} ${k === 'exclusive' ? 'Exclusive' : k === 'limited' ? 'Limited' : 'For a limited time'}`.trim();
const PAGE = 8;

// The shop: one section per item with its own Buy button. Paged eight at a time — a section
// with a button is two components, and a V2 message holds forty.
async function cmdShop(i, page = 0, isUpdate = false) {
  const [{ t }, eco, me] = await Promise.all([tr(i), api.economyConfig(), api.economyUser(i.user.id)]);
  const respond = (opts) => (isUpdate ? ui.update(i, opts) : ui.reply(i, opts));
  if (!eco.enabled) return respond({ title: `${ui.ic('shop')} ${t('shop.title')}`, body: t('shop.off') });
  const now = Date.now();
  // `onBot !== false`: an admin can hide an item from the Discord shop while keeping it on the
  // site (and vice-versa). Undefined = shown, so existing items are unaffected.
  const items = (Array.isArray(eco.shop) ? eco.shop : []).filter((x) => x.name && x.active !== false && x.onBot !== false && !(x.kind === 'badge' && !x.ref) && !(x.availableUntil && new Date(x.availableUntil).getTime() < now));
  if (!items.length) return respond({ title: `${ui.ic('shop')} ${t('shop.title')}`, body: t('shop.empty'), buttons: ecoButtons('shop', t) });
  const cur = eco.currencyEmoji || eco.currencyName || 'points';
  const pages = Math.ceil(items.length / PAGE);
  page = Math.max(0, Math.min(pages - 1, page));
  const slice = items.slice(page * PAGE, page * PAGE + PAGE);
  const balance = me.linked ? Number(me.points || 0) : null;
  return respond({
    title: `${ui.ic('shop')} ${t('shop.title')}`,
    body: balance != null ? t('shop.balance', { n: n(balance), cur }) : t('shop.link'),
    sections: slice.map((x) => {
      const cost = Number(x.cost) || 0;
      const can = balance != null && balance >= cost;
      const tag = x.exclusive ? tagLabel('exclusive') : x.stock != null && x.stock !== '' ? `${tagLabel('limited')} · ${x.stock} in stock` : x.availableUntil ? `${tagLabel('timed')} · until <t:${Math.floor(new Date(x.availableUntil).getTime() / 1000)}:d>` : '';
      const extra = [shopKindLabel(x.kind), x.giftable === false || x.kind === 'badge' || x.kind === 'role' ? 'bound to you' : 'giftable', x.codeDays ? `code valid ${x.codeDays} d` : null].filter(Boolean).join(' · ');
      return {
        text: `**${x.name}** — ${n(cost)} ${cur}${tag ? `  ${tag}` : ''}\n-# ${extra}${x.desc ? `\n${x.desc}` : ''}`,
        button: ui.btn(`shop:buy:${x.id}`, can ? t('btn.buy') : `${n(cost)}`, can ? ButtonStyle.Success : ButtonStyle.Secondary, { disabled: !can, emoji: can ? 'buy' : null }),
      };
    }),
    footer: pages > 1 ? t('shop.page', { p: page + 1, t: pages }) : t('shop.footer'),
    buttons: [
      pages > 1 && ui.btn(`shop:page:${page - 1}`, t('btn.prev'), ButtonStyle.Secondary, { disabled: page === 0 }),
      pages > 1 && ui.btn(`shop:page:${page + 1}`, t('btn.next'), ButtonStyle.Secondary, { disabled: page >= pages - 1 }),
      ...ecoButtons('shop', t),
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
    if (d.kind === 'badge') lines.push(`${ui.ic('medal')} The **${d.badge}** badge is now on your BCWEB profile.`);
    else if (d.revealed === false) lines.push(`${ui.ic('reveal')} Your code is sealed in your inventory — press **Reveal** there when you want it${r.item?.giftable ? ', or **Gift** it unopened to someone else' : ''}.`);
    else if (r.item?.kind === 'role') lines.push('🎭 An admin will assign your role shortly — it shows as *pending* in your inventory until then.');
    else lines.push(`${ui.ic('gift')} An admin has been notified to deliver it — *pending* in your inventory until then.`);
    return ui.reply(i, { title: `${ui.ic('done')} Purchase complete`, color: ui.GOOD, body: lines, buttons: [ui.btn('eco:inventory', 'Inventory', ButtonStyle.Primary, { emoji: 'inventory' }), ui.btn('eco:shop', 'Back to the shop', ButtonStyle.Secondary, { emoji: 'shop' })] });
  }
  if (r.error === 'not_linked') return notLinked(i);
  const why = r.error === 'insufficient' ? `You need **${n(r.cost)}** points — you have ${n(r.points)}.`
    : r.error === 'already_owned' ? 'You already own that one — it is one per account.'
    : r.error === 'sold_out' ? 'Sold out — somebody got the last one.'
    : r.error === 'badge_unavailable' ? 'That badge is no longer available.'
    : r.error === 'no_such_item' ? 'That item is gone from the shop.'
    : r.error === 'economy_off' ? 'The economy is currently off.'
    : 'That purchase could not be completed.';
  return ui.reply(i, { title: `${ui.ic('shop')} Shop`, color: ui.BAD, body: why, buttons: [ui.btn('eco:shop', 'Back to the shop', ButtonStyle.Secondary, { emoji: 'shop' })] });
}

// Everything bought with points, newest first: sealed codes to reveal, giftable items to gift.
async function cmdInventory(i) {
  const [{ t }, e] = await Promise.all([tr(i), api.economyUser(i.user.id)]);
  if (!e.linked) return notLinked(i);
  const r = await api.economyPurchases(i.user.id);
  const rows = Array.isArray(r.purchases) ? r.purchases : [];
  if (!rows.length) return ui.reply(i, { title: `${ui.ic('inventory')} ${t('inv.title')}`, body: t('inv.empty'), buttons: ecoButtons('inventory', t) });
  const pending = rows.filter((x) => x.status === 'pending').length;
  const sections = rows.slice(0, 10).map((x) => {
    const when = `<t:${Math.floor(new Date(x.createdAt).getTime() / 1000)}:d>`;
    const d = x.delivery || {};
    const state = x.status === 'pending' ? '⏳ waiting for an admin'
      : d.revealed && d.code ? `code \`${d.code}\`${x.expiresAt ? ` · until <t:${Math.floor(new Date(x.expiresAt).getTime() / 1000)}:d>` : ''}${x.expired ? ' · expired' : ''}`
      : d.badge ? `badge **${d.badge}**`
      : x.canReveal ? `${ui.ic('reveal')} sealed — reveal when you want the code` : `${ui.ic('done')} delivered`;
    const button = x.canReveal ? ui.btn(`inv:reveal:${x.id}`, t('btn.reveal'), ButtonStyle.Primary, { emoji: 'reveal' })
      : x.canGift ? ui.btn(`inv:gift:${x.id}`, t('btn.gift'), ButtonStyle.Secondary, { emoji: 'gift' }) : null;
    return { text: `**${x.name}** — ${n(x.cost)} pts · ${when}${x.giftedFromId ? ` · ${ui.ic('gift')} a gift` : ''}\n-# ${state}${x.canReveal && x.canGift ? ' · giftable unopened' : ''}`, button };
  });
  return ui.reply(i, {
    title: `${ui.ic('inventory')} ${t('inv.title')}`,
    body: pending ? t('inv.pending', { n: pending }) : t('inv.count', { n: rows.length }),
    sections,
    footer: rows.length > 10 ? t('inv.more', { n: rows.length - 10 }) : t('inv.footer'),
    buttons: [ui.btn(`${SITE_URL}/dashboard?s=economy`, t('btn.site'), ButtonStyle.Secondary, { emoji: 'site' }), ...ecoButtons('inventory', t)],
  });
}

async function invReveal(i) {
  const purchaseId = i.customId.slice('inv:reveal:'.length);
  const r = await api.economyReveal(i.user.id, purchaseId);
  if (!r.ok) return ui.line(i, r.error === 'not_found' ? 'That item is not in your inventory (was it gifted?).' : r.error === 'nothing_to_reveal' ? 'There is no code behind this one.' : 'Could not reveal that right now.', { color: ui.BAD });
  const d = r.delivery || {};
  return ui.reply(i, {
    title: `${ui.ic('reveal')} Your code`, color: ui.GOOD,
    body: [`# ${d.code}`, `Redeem it on the site${d.target ? ` (${d.target})` : ''}.`, r.expiresAt ? `-# Valid until <t:${Math.floor(new Date(r.expiresAt).getTime() / 1000)}:f>` : '-# No expiry.', '-# It is kept in your inventory — only you can see this message.'],
    buttons: [ui.btn(`${SITE_URL}/dashboard?s=economy`, 'Open on the site', ButtonStyle.Secondary, { emoji: 'site' }), ui.btn('eco:inventory', 'Inventory', ButtonStyle.Secondary, { emoji: 'inventory' })],
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
  return ui.reply(i, { title: `${ui.ic('gift')} Gifted`, color: ui.GOOD, body: `Handed to **${r.to?.displayName || to}** — it is in their inventory now, unopened.`, buttons: [ui.btn('eco:inventory', 'Inventory', ButtonStyle.Secondary, { emoji: 'inventory' })] });
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
    title: `${ui.ic('gift')} Gift sent`, color: ui.GOOD,
    body: [`**${n(points)}** points to **${member.username}**${note ? ` — “${note}”` : ''}.`, `Your balance: **${n(r.points)}**.`],
    buttons: [ui.btn('eco:history', 'History', ButtonStyle.Secondary, { emoji: 'history' }), ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: 'level' })],
  }, { ephemeral: false });
}

const KIND_TEXT = { levelup: 'Level-up', grant: 'Staff', purchase: 'Purchase', casino: 'Casino', gift_out: 'Gift sent', gift_in: 'Gift received', gift_item_out: 'Item given', gift_item_in: 'Item received', refund: 'Refund' };
const KIND_ICON = { levelup: 'levelup', grant: 'staff', purchase: 'purchase', casino: 'casino', gift_out: 'gift', gift_in: 'gift', gift_item_out: 'coin', gift_item_in: 'coin', refund: 'coin' };
// The emoji comes from the icon catalogue, so an admin's custom emoji reaches the ledger too.
const kindLabel = (k) => (KIND_TEXT[k] ? `${ui.ic(KIND_ICON[k] || 'coin')} ${KIND_TEXT[k]}` : '');
async function cmdHistory(i, kind = '') {
  const [{ t }, r] = await Promise.all([tr(i), api.economyHistory(i.user.id, kind)]);
  if (r.linked === false) return notLinked(i);
  const rows = Array.isArray(r.history) ? r.history : [];
  if (!rows.length) return ui.reply(i, { title: `${ui.ic('history')} ${t('hist.title')}`, body: kind ? t('hist.emptyKind') : t('hist.empty'), buttons: ecoButtons('', t) });
  const lines = rows.slice(0, 20).map((x) => {
    const m = x.meta || {};
    const who = x.kind === 'gift_out' ? ` → ${m.toName || '?'}` : x.kind === 'gift_in' ? ` ← ${m.fromName || '?'}` : x.kind === 'purchase' ? ` · ${m.name || ''}` : x.kind === 'casino' ? ` · ${m.game || ''} ×${m.multiplier ?? '?'}` : x.kind === 'levelup' ? ` · Lv ${m.level}` : '';
    const d = x.delta > 0 ? `**+${n(x.delta)}**` : x.delta < 0 ? `**−${n(-x.delta)}**` : '±0';
    return `<t:${Math.floor(new Date(x.createdAt).getTime() / 1000)}:d> ${kindLabel(x.kind) || x.kind}${who} — ${d} → ${n(x.balance)}`;
  });
  return ui.reply(i, { title: `${ui.ic('history')} ${t('hist.title')}${kind ? ` · ${kindLabel(kind) || kind}` : ''}`, body: lines, footer: t('hist.footer'), buttons: [ui.btn(`${SITE_URL}/dashboard?s=economy`, t('btn.site'), ButtonStyle.Secondary, { emoji: 'site' }), ...ecoButtons('')] });
}

async function cmdLeaderboard(i, isUpdate = false, scope = 'server') {
  const guildId = scope === 'server' && i.guildId ? i.guildId : '';
  const [{ t }, r] = await Promise.all([tr(i), api.economyLeaderboard(i.user.id, guildId)]);
  const rows = (r.members || []).slice(0, 10);
  if (!isUpdate) await i.deferReply();
  const respond = (opts) => (isUpdate ? ui.update(i, opts) : ui.editReply(i, opts));
  // The board as a picture, drawn by the site with real avatars; the text list is the
  // accessible copy and what an old client falls back to.
  const meId = (await api.economyUser(i.user.id))?.userId || '';
  const png = rows.length ? await api.siteImage(`/og/leaderboard.png?guildId=${encodeURIComponent(guildId)}&me=${encodeURIComponent(meId)}&n=${Math.floor(Date.now() / 60000)}`) : null;
  const medal = (k) => k === 0 ? ui.ic('gold') : k === 1 ? ui.ic('silver') : k === 2 ? ui.ic('bronze') : `**${k + 1}.**`;
  const body = rows.length ? rows.map((m, k) => `${medal(k)} **${m.displayName}** — Lv **${m.level}** · ${n(m.points)} pts`) : [t('lb.empty')];
  const you = r.me ? `\n${t('lb.you', { r: r.me.rank, l: r.me.level, p: n(r.me.points) })}` : '';
  return respond({
    title: `${ui.ic('leaderboard')} ${t('lb.title', { scope: guildId ? (i.guild?.name || t('lb.thisServer')) : t('lb.global') })}`,
    body: png ? [you || null] : [...body, you],
    image: png ? 'attachment://leaderboard.png' : null, files: png ? [ui.attach(png, 'leaderboard.png')] : [],
    footer: r.total ? t('lb.footer', { n: n(r.total) }) : null,
    buttons: [
      ui.btn('eco:lb:server', t('btn.server'), guildId ? ButtonStyle.Primary : ButtonStyle.Secondary, { disabled: !i.guildId }),
      ui.btn('eco:lb:global', t('btn.global'), guildId ? ButtonStyle.Secondary : ButtonStyle.Primary),
      // Its own id: it used to reuse the scope button's, and Discord refuses a message whose
      // components share a custom id (COMPONENT_CUSTOM_ID_DUPLICATED) — the whole card failed.
      ui.btn(`eco:lb:refresh:${guildId ? 'server' : 'global'}`, t('btn.refresh'), ButtonStyle.Secondary, { emoji: 'refresh' }),
      ui.btn('eco:level', t('btn.level'), ButtonStyle.Secondary, { emoji: 'level' }),
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
    if (betOn === 'number') { mult = pocket === num ? 35 : 0; detail = `${ui.ic('roulette')} You bet on **${num}** — the ball landed on **${pocket} ${colour}**.`; }
    else if (betOn === 'green') { mult = pocket === 0 ? 14 : 0; detail = `${ui.ic('roulette')} You bet on **green** — the ball landed on **${pocket} ${colour}**.`; }
    else { mult = colour === betOn ? 2 : 0; detail = `${ui.ic('roulette')} You bet on **${betOn}** — the ball landed on **${pocket} ${colour}**.`; }
    card = String(pocket);
  } else if (game === 'wheel') {
    const SLICES = [[2, 45], [3, 24], [5, 16], [10, 9], [20, 4], [50, 2]];
    let roll = Math.random() * 100, landed = 2;
    for (const [m, w] of SLICES) { if (roll < w) { landed = m; break; } roll -= w; }
    mult = landed === target ? target : 0;
    detail = `${ui.ic('wheel')} You went for **${target}×** — the wheel stopped on **${landed}×**.`;
    card = `${landed}|${target}`;
  } else if (game === 'plinko') {
    const TABLES = { low: [5, 3, 1.5, 1.2, 1, 0.5, 1, 1.2, 1.5, 3, 5], medium: [13, 4, 2, 1.2, 0.6, 0.3, 0.6, 1.2, 2, 4, 13], high: [50, 10, 3, 1, 0.3, 0.2, 0.3, 1, 3, 10, 50] };
    let path = '', rights = 0;
    for (let k = 0; k < 10; k++) { const rgt = Math.random() < 0.5; path += rgt ? 'R' : 'L'; if (rgt) rights++; }
    mult = TABLES[risk][rights];
    detail = `${ui.ic('plinko')} Risk **${risk}** — the ball landed in the **${mult}×** bucket.`;
    card = `${risk}|${path}|${rights}`;
  } else if (game === 'dice') {
    const roll = 1 + Math.floor(Math.random() * 6);
    mult = roll >= 4 ? 2 : 0;
    detail = `${ui.ic('dice')} You rolled a **${roll}** (win on 4-6).`; card = String(roll);
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

const GAME_NAME = { coinflip: 'Coin flip', dice: 'Dice', slots: 'Slots', roulette: 'Roulette', wheel: 'Wheel', plinko: 'Plinko', crash: 'Crash', race: 'Race', pot: 'Pot' };

// The "Play again" button re-runs the same bet with the same options. Its custom id carries
// them plus the player's id, so nobody spends someone else's points from their button.
async function casinoAgain(i) {
  const [, , game, bet, betOn, num, target, risk, userId] = i.customId.split(':');
  if (userId && userId !== i.user.id) {
    const { t } = await tr(i);
    return i.reply({ content: t('cas.notyours', 'That is not your game — start your own with /casino.'), ephemeral: true }).catch(() => {});
  }
  return playCasino(i, {
    game: GAME_NAME[game] ? game : 'coinflip',
    bet: Math.max(1, parseInt(bet, 10) || 0),
    betOn: ['red', 'black', 'green', 'number'].includes(betOn) ? betOn : 'red',
    num: num === '' || num == null ? null : (parseInt(num, 10) || 0),
    target: parseInt(target, 10) || 2,
    risk: ['low', 'medium', 'high'].includes(risk) ? risk : 'medium',
  });
}

async function playCasino(i, opts) {
  const { bet, game } = opts;
  const { t } = await tr(i);
  const gameName = t(`game.${game}`);
  const { mult, detail, card } = rollGame(opts);
  const r = await api.economyCasino(i.user.id, bet, mult, game);
  if (!r.ok) {
    if (r.error === 'not_linked') return notLinked(i);
    const msg = r.error === 'casino_off' ? 'The casino is off.'
      : r.error === 'insufficient' ? "You don't have enough points for that bet."
      : r.error === 'bad_bet' ? t('cas.betRange', { a: n(r.min), b: r.max == null ? t('live.noCap') : n(r.max) })
      : 'Could not place that bet.';
    return ui.reply(i, { title: `${ui.ic('casino')} Casino`, body: msg, color: ui.BAD, buttons: [ui.btn('eco:level', 'My balance', ButtonStyle.Secondary, { emoji: 'level' })] });
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
    ? `${detail}\n${t('cas.won', { i: ui.ic('win'), n: n(r.delta), b: n(r.points) })}`
    : push ? `${detail}\n${t('cas.pushed', { i: ui.ic('push'), n: n(bet), b: n(r.points) })}`
    : `${detail}\n${t('cas.lost', { n: n(lost), b: n(r.points), of: lost < bet ? t('cas.of', { n: n(bet) }) : '' })}`;
  // "Play again" re-runs the same bet with the same options — the custom id carries them (and
  // the player's id, so nobody spends somebody else's points from their button).
  const again = ['casino', 'again', game, bet, opts.betOn || '', opts.num ?? '', opts.target || '', opts.risk || '', i.user.id].join(':');
  return ui.editReply(i, {
    // Deliberately NOT green/red: the accent colour would spoil the result before you read it
    // (and it is the whole point of the reveal). One calm neutral for win, push and loss alike.
    title: won ? t('cas.win', { g: gameName }) : push ? t('cas.push', { g: gameName }) : t('cas.lose', { g: gameName }),
    color: 0x6b7280,
    thumb: i.user.displayAvatarURL?.({ size: 128 }) || null,
    body: line,
    image: gif ? 'attachment://casino.gif' : null, files,
    buttons: [ui.btn(again, t('btn.again', { n: n(bet) }), ButtonStyle.Primary, { emoji: 'again' }), ui.btn(`cas:open:${packCas({ ...opts, view: 'game', bet: 0, owner: i.user.id })}`, t('btn.change'), ButtonStyle.Secondary, { emoji: 'casino' }), ui.btn('eco:level', t('btn.balance'), ButtonStyle.Secondary, { emoji: 'level' }), ui.btn('eco:history', t('btn.history'), ButtonStyle.Secondary, { emoji: 'history' })],
  });
}

async function cmdCasino(i) {
  // `/casino join:<code>` and `/casino lobbies:true` are the live tables' front door.
  const code = i.options.getString('join');
  if (code) return joinByCode(i, code);
  if (i.options.getBoolean('lobbies')) return listLobbies(i);
  const visibility = VISIBILITIES.includes(i.options.getString('visibility')) ? i.options.getString('visibility') : 'server';
  const bet = i.options.getInteger('bet');
  const game = GAME_NAME[i.options.getString('game')] ? i.options.getString('game') : 'coinflip';
  const betOn = ['red', 'black', 'green', 'number'].includes(i.options.getString('bet_on')) ? i.options.getString('bet_on') : 'red';
  const num = i.options.getInteger('number');
  const target = i.options.getInteger('target') || 2;
  const risk = ['low', 'medium', 'high'].includes(i.options.getString('risk')) ? i.options.getString('risk') : 'medium';
  // Crash, race and the pot are tables in the channel, not private pages: a bet given up
  // front seats the host, the rest join from the card.
  if (LIVE_GAMES.includes(game)) return openLive(i, game, { bet: bet || 0, target: game === 'crash' && target > 1 ? target : null, visibility });
  const st = { view: i.options.getString('game') ? 'game' : 'list', game, bet: bet || 0, betOn, num, target, risk, owner: i.user.id };
  // No bet: the table opens — on the list of games, or straight on the named game's page with
  // everything given so far already selected. A number bet without its number does the same.
  if (!bet || (game === 'roulette' && betOn === 'number' && num == null)) return casinoMenu(i, st);
  return playCasino(i, { bet, game, betOn, num, target, risk });
}

// ── Casino table (interactive) ───────────────────────────────────────────────
// `/casino` alone opens a paged table: the LIST of games first (one big entry per game with
// an Open button), then one page per game — an ANIMATED preview of a real round drawn by the
// site's renderer, the rules and odds as a short list, the bet menu, the game's own option
// menu, and Play — with ◀ Games ▶ at the bottom. The whole choice lives in the custom ids
// (view · game · bet · bet_on · number · target · risk · owner), so the table survives a bot
// restart and needs no session state. Every word comes from the reader's language.
const CASINO_GAMES = [
  { id: 'coinflip', emoji: '🪙', preview: '🪙', odds: [['2×', '50 %']] },
  { id: 'dice', emoji: '🎲', preview: '6', odds: [['2×', '50 %']] },
  { id: 'slots', emoji: '🎰', preview: 'cherry cherry cherry', odds: [['8×', '4 %'], ['1.5×', '48 %']] },
  { id: 'roulette', emoji: '🎡', preview: '17', odds: [['2×', '18 / 37'], ['14×', '1 / 37'], ['35×', '1 / 37']] },
  { id: 'wheel', emoji: '🎯', preview: '5|5', odds: [['2×', '45 %'], ['3×', '24 %'], ['5×', '16 %'], ['10×', '9 %'], ['20×', '4 %'], ['50×', '2 %']] },
  { id: 'plinko', emoji: '🟡', preview: 'medium|RRLRLRLRLR|5', odds: [['low', '0.5×–5×'], ['medium', '0.3×–13×'], ['high', '0.2×–50×']] },
  // Live tables — see features/casino-live.mjs. No private page; the list's button opens
  // the table in the channel.
  { id: 'crash', emoji: '📈', live: true, preview: '2.4|1.8', odds: [['cash out at M', 'reaches M (1−e)/M of the time']] },
  { id: 'race', emoji: '🏎️', live: true, preview: '2|2', odds: [['6×', '1 / 6']] },
  { id: 'pot', emoji: '🎁', live: true, preview: '1|10,30,60|A,B,C', odds: [['the pot', 'your stake / the pot']] },
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

/**
 * The bet limits. `max` is Infinity when the admin set 0 — "no cap", like every other 0 in
 * this config. `Number(cfg.maxBet) || 100` used to turn that 0 into a 100 here and on the API,
 * and every "Tapis" was silently capped at 100 with nothing saying so.
 */
function betLimits(cfg = {}) {
  const min = Math.max(1, Math.floor(Number(cfg.minBet) || 1));
  const raw = Number(cfg.maxBet);
  const max = Number.isFinite(raw) && raw > 0 ? Math.max(min, Math.floor(raw)) : Infinity;
  return { min, max };
}
/** `max` as words: a number, or "no cap". */
const maxLabel = (t, max) => (Number.isFinite(max) ? n(max) : t('live.noCap'));

/** The bet presets between min and max — the config's bounds plus the usual round numbers. */
function betPresets(min, max) {
  // `max` only when it is a number: with no cap it is Infinity, and an "Infinity" preset is
  // not a bet anybody can place.
  const out = new Set([min, 5, 10, 25, 50, 100, 250, 500, 1000, ...(Number.isFinite(max) ? [max] : [])].filter((v) => v >= min && v <= max));
  return [...out].sort((a, b) => a - b).slice(0, 22);
}

async function casinoContext(i) {
  const [{ t }, cfgAll, e] = await Promise.all([tr(i), config(), api.economyUser(i.user.id)]);
  const cfg = cfgAll.economy?.casino || {};
  const { min, max } = betLimits(cfg);
  const live = { multi: true, crash: true, race: true, pot: true, ...(cfg.live || {}) };
  return { t, cfg, min, max, live, e, cur: curLabel(e.currency), balance: e.linked ? Number(e.points) || 0 : 0, enabled: cfg.enabled !== false };
}

/** Page 1: the games, one big entry each, with the ◀ Games ▶ bar underneath. */
async function casinoList(i, st, { update = false } = {}) {
  const { t, min, max, e, cur, balance, enabled } = await casinoContext(i);
  const S = (patch) => packCas({ ...st, ...patch });
  const first = CASINO_GAMES[0].id, last = CASINO_GAMES[CASINO_GAMES.length - 1].id;
  const opts = {
    title: `${ui.ic('casino')} ${t('cas.title')}`,
    thumb: i.user.displayAvatarURL?.({ size: 128 }) || null,
    body: [
      e.linked ? t('cas.balance', { n: n(balance), cur, a: n(min), b: maxLabel(t, max) }) : t('cas.bets', { a: n(min), b: maxLabel(t, max), cur }),
      !enabled ? t('cas.off') : t('cas.pick'),
    ],
    // The live games open a TABLE in the channel rather than a page: there is no bet to pick
    // in private first, the table is where you bet.
    sections: CASINO_GAMES.map((g) => ({ text: `## ${ui.ic(g.id) || g.emoji} ${t(`game.${g.id}`)}\n-# ${t(`game.${g.id}.d`)}`, button: g.live ? ui.btn(`cl:new:${g.id}`, t('live.openTable'), ButtonStyle.Success) : ui.btn(`cas:open:${S({ view: 'game', game: g.id })}`, t('cas.open'), ButtonStyle.Primary) })),
    footer: t('cas.footer'),
    buttons: [
      // `:p` / `:n` after the payload: every custom id on a message must be unique, and the
      // arrows' targets are also the first and last section's Open button. unpackCas reads
      // eight fields and ignores the ninth.
      ui.btn(`cas:open:${S({ view: 'game', game: last })}:p`, '◀', ButtonStyle.Secondary),
      ui.btn('cas:noop', t('btn.games'), ButtonStyle.Secondary, { disabled: true }),
      ui.btn(`cas:open:${S({ view: 'game', game: first })}:n`, '▶', ButtonStyle.Secondary),
      e.linked ? ui.btn('eco:level', t('btn.balance'), ButtonStyle.Secondary, { emoji: 'level' }) : ui.btn('eco:link', t('btn.link'), ButtonStyle.Primary, { emoji: 'link' }),
      // The live tables' doors: a code typed into a modal, or the list of open tables.
      ui.btn('cl:code', t('live.joinCode'), ButtonStyle.Secondary, { emoji: 'link' }),
      ui.btn('cl:lobbies', t('live.lobbiesBtn'), ButtonStyle.Secondary, { emoji: 'multi' }),
    ],
  };
  return update ? ui.update(i, opts) : ui.reply(i, opts);
}

/** One game's page: an animated round as preview, rules, the bet + option menus, Play, and the nav bar. */
async function casinoMenu(i, st, { update = false } = {}) {
  if (st.view === 'list') return casinoList(i, st, { update });
  const { t, min, max, live, e, cur, balance, enabled } = await casinoContext(i);
  const idx = Math.max(0, CASINO_GAMES.findIndex((x) => x.id === st.game));
  // A live-only game has no private page: its ◀ ▶ neighbours land here, so open its table.
  if (CASINO_GAMES[idx].live) return openLive(i, CASINO_GAMES[idx].id, {});
  const g = CASINO_GAMES[idx];
  const prev = CASINO_GAMES[(idx + CASINO_GAMES.length - 1) % CASINO_GAMES.length].id;
  const next = CASINO_GAMES[(idx + 1) % CASINO_GAMES.length].id;
  const bet = st.bet === 'all' ? Math.min(max, balance) : st.bet;
  const needsNumber = st.game === 'roulette' && st.betOn === 'number' && st.num == null;
  const canPlay = enabled && e.linked && bet >= min && bet <= max && bet <= balance && !needsNumber;

  const optionLine = st.game === 'roulette' ? `**${t('cas.betOn')}** ${ROULETTE_BETS.find(([v]) => v === st.betOn)?.[1] || st.betOn}${st.betOn === 'number' ? (st.num == null ? ` — ${t('cas.pickNumber')}` : ` **${st.num}**`) : ''}`
    : st.game === 'wheel' ? `**${t('cas.goingFor')}** ${WHEEL_TARGETS.find(([m]) => m === st.target)?.[1] || `${st.target}×`}`
    : st.game === 'plinko' ? `**${t('cas.risk')}** ${PLINKO_RISKS.find(([v]) => v === st.risk)?.[1] || st.risk}` : null;
  const why = !enabled ? t('cas.off')
    : !e.linked ? t('cas.linkFirst')
    : !bet ? t('cas.pickBet', { a: n(min), b: maxLabel(t, max) })
    : bet < min || bet > max ? t('cas.betRange', { a: n(min), b: maxLabel(t, max) })
    : bet > balance ? t('cas.onlyHave', { n: n(balance), cur })
    : needsNumber ? t('cas.pickNumber') : null;

  const S = (patch) => packCas({ ...st, ...patch });
  const presets = betPresets(min, max);
  const betSel = casSelect(`cas:bet:${S({})}`, t('cas.bet'), [
    ...presets.map((v) => casOpt(v, `${n(v)} ${cur}`, st.bet !== 'all' && v === st.bet)),
    // The all-in SAYS when the cap cut it: "All in — 100 (capped at the max)" rather than a
    // number smaller than the balance with no explanation, which is what the report was.
    ...(e.linked && balance >= min ? [casOpt('all', balance > max ? t('cas.allInCap', { n: n(max), cur }) : t('cas.allIn', { n: n(Math.min(max, balance)), cur }), st.bet === 'all')] : []),
    casOpt('custom', t('cas.custom'), false, t('cas.customDesc', { a: n(min), b: maxLabel(t, max) })),
  ]);
  const optSel = st.game === 'roulette' ? casSelect(`cas:opt:${S({})}`, t('cas.betOn'), ROULETTE_BETS.map(([v, l]) => casOpt(v, l, v === st.betOn)))
    : st.game === 'wheel' ? casSelect(`cas:opt:${S({})}`, t('cas.goingFor'), WHEEL_TARGETS.map(([m, l]) => casOpt(m, l, m === st.target)))
    : st.game === 'plinko' ? casSelect(`cas:opt:${S({})}`, t('cas.risk'), PLINKO_RISKS.map(([v, l]) => casOpt(v, l, v === st.risk)))
    : null;
  // A real round, animated — the same renderer as the result cards, seeded per page view so
  // the demo differs each time. Not a placeholder still.
  const gif = await api.siteImage(`/og/casino/${encodeURIComponent(g.id)}/win.gif?d=${encodeURIComponent(g.preview)}&a=${encodeURIComponent(n(bet || min))}&s=${Math.floor(Math.random() * 4294967295)}`);
  const files = gif ? [ui.attach(gif, 'table.gif')] : [];
  const buttons = [betSel, optSel,
    ui.btn(`cas:play:${S({})}`, canPlay ? t('btn.play', { n: n(bet), cur }) : t('btn.playPlain'), ButtonStyle.Success, { emoji: 'casino', disabled: !canPlay }),
    ...(st.game === 'roulette' && st.betOn === 'number' ? [ui.btn(`cas:num:${S({})}`, st.num == null ? t('btn.pickNumber') : t('btn.number', { n: st.num }), ButtonStyle.Primary)] : []),
    // Multi: the same game on one shared roll, at a table in the channel.
    ...(live.multi !== false && MULTI_GAMES.includes(st.game) ? [ui.btn(`cl:new:${st.game}`, t('live.multiBtn'), ButtonStyle.Secondary, { emoji: 'multi' })] : []),
    ui.btn(`cas:open:${S({ game: prev })}:p`, '◀', ButtonStyle.Secondary),
    ui.btn(`cas:list:${S({ view: 'list' })}`, t('btn.games'), ButtonStyle.Secondary),
    ui.btn(`cas:open:${S({ game: next })}:n`, '▶', ButtonStyle.Secondary),
    e.linked ? ui.btn('eco:level', t('btn.balance'), ButtonStyle.Secondary, { emoji: 'level' }) : ui.btn('eco:link', t('btn.link'), ButtonStyle.Primary, { emoji: 'link' }),
  ];
  const opts = {
    title: `${ui.ic(g.id) || g.emoji} ${t(`game.${g.id}`)}`,
    body: [
      `### ${t('cas.howTo')}`,
      t(`game.${g.id}.how`),
      `### ${t('cas.odds')}`,
      ...g.odds.map(([pays, chance]) => `- **${pays}** · ${chance}`),
      '',
      e.linked ? t('cas.balance', { n: n(balance), cur, a: n(min), b: maxLabel(t, max) }) : t('cas.bets', { a: n(min), b: maxLabel(t, max), cur }),
      `**${t('cas.bet')}** ${bet ? `${n(bet)} ${cur}${st.bet === 'all' ? (balance > max ? ` (${t('cas.cappedShort', { m: n(max) })})` : ' (all in)') : ''}` : '—'}`,
      optionLine,
      why ? `\n${why}` : `\n${t('cas.ready')}`,
    ],
    image: gif ? 'attachment://table.gif' : null, files,
    footer: t('cas.page', { i: idx + 1, n: CASINO_GAMES.length }),
    buttons,
  };
  return update ? ui.update(i, opts) : ui.reply(i, opts);
}

async function casinoSetup(i) {
  const [, verb, ...rest] = i.customId.split(':');
  if (verb === 'noop') return i.deferUpdate();
  const st = unpackCas(rest);
  if (st.owner && st.owner !== i.user.id) { const { t } = await tr(i); return ui.line(i, t('cas.someoneElse'), { title: `${ui.ic('casino')} ${t('cas.title')}` }); }
  st.owner = i.user.id;
  if (verb === 'list') { st.view = 'list'; return casinoMenu(i, st, { update: true }); }
  if (verb === 'open') {
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
    const { max } = betLimits(cfg);
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
  if (st.owner && st.owner !== i.user.id) { const { t } = await tr(i); return ui.line(i, t('cas.someoneElse'), { title: `${ui.ic('casino')} ${t('cas.title')}` }); }
  const raw = (i.fields.getTextInputValue('v') || '').replace(/[^0-9]/g, '');
  const v = raw === '' ? NaN : Number(raw);
  if (kind === 'bet') st.bet = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : st.bet;
  else if (kind === 'num') { st.betOn = 'number'; st.num = Number.isFinite(v) && v >= 0 && v <= 36 ? v : st.num; }
  return casinoMenu(i, st, { update: typeof i.isFromMessage === 'function' && i.isFromMessage() });
}

async function cmdAppeal(i) {
  const ban = i.guildId ? guildBan(await config(), i.guildId) : null;
  if (!ban) return ui.line(i, 'Good news — this server is not blocked from the bot. Everything works normally here.', { title: '✅ Appeal', color: ui.GOOD });
  const ref = ban.banId || i.guildId;
  return ui.reply(i, {
    title: '📝 Appeal',
    body: ['This server is blocked from the bot.', '', `**Reference:** \`${ref}\``, ...(ban.reason ? [`**Reason:** ${ban.reason}`] : []), '', 'To contest it, contact us and quote the reference above.'],
    buttons: [ui.btn(`${SITE_URL}/contact`, 'Contact us', ButtonStyle.Secondary, { emoji: 'site' })],
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
  if (!i.guildId) return eReply(i, 'Run this in a server.', { title: `${ui.ic('enter')} Giveaway` });
  const prize = i.options.getString('prize');
  const minutes = i.options.getInteger('minutes');
  const winners = i.options.getInteger('winners') || 1;
  try {
    await api.giveawayCreate({ prize, channelId: i.channelId, guildId: i.guildId, hostDiscordId: i.user.id, durationMinutes: minutes, winnersCount: winners });
    return eReply(i, `Giveaway for **${prize}** created (${winners} winner${winners === 1 ? '' : 's'}, ${minutes} min). It appears here within ~30s.`, { title: `${ui.ic('enter')} Giveaway`, color: ui.GOOD });
  } catch (e) {
    const err = e?.body?.error;
    const msg = err === 'guild_giveaway_cap'
      ? 'This server already has **5 active giveaways** — wait for one to end (or ask a mod to end one) before starting another.'
      : 'Could not create the giveaway — try again in a moment.';
    return eReply(i, msg, { title: `${ui.ic('enter')} Giveaway`, color: ui.BAD });
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
    buttons: anyGranted ? [] : [ui.btn(`${SITE_URL}/profile`, 'Link on the site', ButtonStyle.Secondary, { emoji: 'site' }), ui.btn('eco:link', 'Get a link code', ButtonStyle.Primary, { emoji: 'link' })],
  });
}

async function cmdLink(i) {
  const { t } = await tr(i);
  try {
    const r = await api.issueLink(i.user.id, i.user.username);
    if (r.linked) return ui.reply(i, { title: `${ui.ic('link')} ${t('link.already')}`, color: ui.GOOD, body: t('link.alreadyBody'), buttons: ecoButtons('', t) });
    return ui.reply(i, {
      title: `${ui.ic('link')} ${t('link.title')}`,
      body: [t('link.body'), `# ${r.code}`, `-# ${t('link.expires')}`],
      buttons: [ui.btn(`${SITE_URL}/profile`, t('link.open'), ButtonStyle.Secondary, { emoji: 'site' })],
    });
  } catch {
    return eReply(i, t('link.fail'), { color: ui.BAD });
  }
}

// The "Get a link code" button on the not-linked cards runs /link.
export async function handleLinkButton(i) { return cmdLink(i); }
