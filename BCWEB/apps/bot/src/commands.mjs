// Slash commands + interaction routing.
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { api, SITE_URL } from './api.mjs';
import { clearMessages } from './features/moderation.mjs';
import { sendPanel, handlePanelInteraction } from './features/panel.mjs';
import { checkGating } from './features/gating.mjs';
import { handleGiveawayButton } from './features/giveaways.mjs';
import { handleRolePanelInteraction } from './features/rolepanel.mjs';
import { config, guildBan } from './config.mjs';

// Every bot response is an embed (brand-colored card) rather than bare text —
// consistent look across alerts/blog/tips/commands. Shared with panel.mjs.
export const BRAND = 0xf59e0b;
export const eReply = (i, text, { color = BRAND, title = null, ephemeral = true } = {}) =>
  i.reply({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(text)], ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });

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
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top members by level'),
  new SlashCommandBuilder().setName('casino').setDescription('Bet points on a game of chance')
    .addIntegerOption((o) => o.setName('bet').setDescription('How many points to bet').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('game').setDescription('Which game (default: coin flip)').addChoices(
      { name: 'Coin flip (2×, 50%)', value: 'coinflip' },
      { name: 'Dice — roll 4-6 to win (2×)', value: 'dice' },
      { name: 'Slots — match to win big', value: 'slots' },
      { name: 'Roulette — red or black (2×)', value: 'roulette' },
    )),
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
    if (i.commandName === 'leaderboard') return cmdLeaderboard(i);
    if (i.commandName === 'casino') return cmdCasino(i);
    return;
  }
  if (i.isButton() && i.customId.startsWith('gw:enter:')) return handleGiveawayButton(i);
  if (i.isButton() && i.customId.startsWith('shop:buy:')) return handleShopBuy(i);
  // Before the voice panel's catch-all, which claims every remaining component interaction.
  // It returns false when the custom id is not one of its own, so this stays a filter and
  // not a fork somebody has to keep in sync.
  if (await handleRolePanelInteraction(i)) return;
  if (i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) return handlePanelInteraction(i);
}

// ── B-econ: levelling / economy commands ─────────────────────────────────────
const curLabel = (c) => c?.emoji || c?.name || 'points';

async function cmdLevel(i) {
  const e = await api.economyUser(i.user.id);
  if (!e.linked) return eReply(i, 'Link your BetterCommunity account first — run **/link**.', { title: 'Not linked' });
  const cur = curLabel(e.currency);
  return eReply(i, `**Level ${e.level}** — ${Number(e.xpThisLevel).toLocaleString()} / ${Number(e.xpForNext).toLocaleString()} XP to next\n**${Number(e.points).toLocaleString()}** ${cur}`, { title: `⭐ ${e.displayName}` });
}

async function cmdProfile(i) {
  const target = i.options.getUser('member') || i.user;
  const e = await api.economyUser(target.id);
  if (!e.linked) return eReply(i, `${target.username} hasn't linked a BetterCommunity account.`, { title: 'No profile' });
  const url = `${SITE_URL}/u/${e.userId}`;
  const cur = curLabel(e.currency);
  const body = `**Level ${e.level}** · **${Number(e.points).toLocaleString()}** ${cur}\n`
    + `${e.stats.messages} messages · ${e.stats.reactions} reactions · ${Math.floor((e.stats.voiceSeconds || 0) / 3600)}h in voice\n\n`
    + `[View full profile →](${url})`;
  // The same 1200×630 card a shared profile link unfurls with: banner, avatar, name, level
  // and badges — drawn by the site, so it is one picture everywhere.
  const emb = new EmbedBuilder().setColor(BRAND).setTitle(`👤 ${e.displayName}`).setDescription(body)
    .setImage(`${SITE_URL}/og/profile/${encodeURIComponent(e.userId)}.png?n=${Math.floor(Date.now() / 60000)}`)
    .setThumbnail(target.displayAvatarURL?.({ size: 128 }) || null);
  return i.reply({ embeds: [emb] });
}

// What each shop kind hands over, phrased for the buyer.
const SHOP_KIND_LABEL = {
  badge: '🏅 BCWEB badge', role: '🎭 Discord role', pool: '💾 storage pool',
  boost: '🚀 catalog boost', hosting: '🖥️ free hosting', promo: '🎟️ promo code', custom: '🎁 reward',
};

async function cmdShop(i) {
  const eco = await api.economyConfig();
  if (!eco.enabled) return eReply(i, 'The economy is currently off.', { title: '🛒 Shop' });
  const items = (Array.isArray(eco.shop) ? eco.shop : []).filter((x) => x.name && !(x.kind === 'badge' && !x.ref));
  if (!items.length) return eReply(i, 'The shop is empty for now.', { title: '🛒 Shop' });
  const cur = eco.currencyEmoji || eco.currencyName || 'points';
  const lines = items.map((x) => `**${x.name}** — ${Number(x.cost).toLocaleString()} ${cur} · ${SHOP_KIND_LABEL[x.kind] || '🎁 reward'}${x.desc ? `\n${x.desc}` : ''}`).join('\n\n');
  // One Buy button per item (Discord: ≤5 per row, ≤5 rows = 25). Buttons carry the item id.
  const rows = [];
  for (let n = 0; n < items.length && n < 25; n += 5) {
    const row = new ActionRowBuilder();
    for (const x of items.slice(n, n + 5)) {
      row.addComponents(new ButtonBuilder().setCustomId(`shop:buy:${x.id}`).setLabel(`Buy: ${x.name}`.slice(0, 80)).setStyle(ButtonStyle.Secondary));
    }
    rows.push(row);
  }
  return i.reply({ embeds: [new EmbedBuilder().setColor(BRAND).setTitle('🛒 Points shop').setDescription(lines)], components: rows, flags: MessageFlags.Ephemeral });
}

// A Buy button was pressed. The API is authoritative — it re-reads the price, debits atomically,
// and fulfils badge/pool/boost/hosting itself (returning a code to DM); role/promo/custom are
// handed back for the admin/bot to deliver. We only translate the result into a message.
async function handleShopBuy(i) {
  const itemId = i.customId.slice('shop:buy:'.length);
  const r = await api.economyBuy(i.user.id, itemId);
  if (r.ok) {
    const d = r.delivery || {};
    let msg = `You bought **${r.item?.name || 'item'}**. Balance: **${Number(r.points).toLocaleString()}**.`;
    if (d.kind === 'badge') msg += `\n🏅 The **${d.badge}** badge is now on your BCWEB profile.`;
    else if (d.code) msg += `\n🎟️ Redeem this on the site: **${d.code}**${d.amount ? ` (${d.amount})` : ''}`;
    else if (r.item?.kind === 'role') msg += `\n🎭 An admin will assign your role shortly.`;
    else msg += `\n🎁 An admin has been notified to deliver it.`;
    return eReply(i, msg, { title: '✅ Purchase complete' });
  }
  const why = r.error === 'not_linked' ? 'Link your BetterCommunity account first — run **/link**.'
    : r.error === 'insufficient' ? `You need **${Number(r.cost || 0).toLocaleString()}** points — you have ${Number(r.points || 0).toLocaleString()}.`
    : r.error === 'already_owned' ? 'You already own that badge.'
    : r.error === 'badge_unavailable' ? 'That badge is no longer available.'
    : r.error === 'no_such_item' ? 'That item is gone from the shop.'
    : 'That purchase could not be completed.';
  return eReply(i, why, { title: '🛒 Shop' });
}

async function cmdLeaderboard(i) {
  const r = await api.economyLeaderboard();
  const rows = (r.members || []).slice(0, 10);
  if (!rows.length) return eReply(i, 'Nobody has earned XP yet.', { title: '🏆 Leaderboard' });
  const medal = (n) => n === 0 ? '🥇' : n === 1 ? '🥈' : n === 2 ? '🥉' : `**${n + 1}.**`;
  const body = rows.map((m, n) => `${medal(n)} ${m.displayName} — Lv **${m.level}** · ${Number(m.points).toLocaleString()} pts`).join('\n');
  return eReply(i, body, { title: '🏆 Leaderboard', ephemeral: false });
}

// The bot rolls each game and hands the API the multiplier; the API prices the house edge and
// settles the balance. Different games = different odds/payouts, but the ledger is one place.
async function cmdCasino(i) {
  const bet = i.options.getInteger('bet');
  const game = i.options.getString('game') || 'coinflip';
  let mult = 0, detail = '', card = ''; // card = the ?d= detail the result image draws
  if (game === 'roulette') {
    // European wheel: 0 is green (house), 1–36 alternate red/black. You bet a colour; a hit pays
    // 2×. Zero beats both colours — that is the whole edge of the game before the house edge.
    const pocket = Math.floor(Math.random() * 37);
    const reds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
    const colour = pocket === 0 ? 'green' : reds.has(pocket) ? 'red' : 'black';
    const pick = Math.random() < 0.5 ? 'red' : 'black'; // the bot picks for you; /casino has no colour arg
    mult = colour === pick ? 2 : 0;
    detail = `🎡 You bet **${pick}** — the ball landed on **${pocket} ${colour}**.`;
    card = `${pocket} ${colour}`;
  } else if (game === 'dice') {
    const roll = 1 + Math.floor(Math.random() * 6);
    mult = roll >= 4 ? 2 : 0;
    detail = `🎲 You rolled a **${roll}** (win on 4-6).`; card = String(roll);
  } else if (game === 'slots') {
    const S = ['🍒', '🍋', '🔔', '⭐', '💎'];
    const reels = [0, 1, 2].map(() => S[Math.floor(Math.random() * S.length)]);
    mult = reels[0] === reels[1] && reels[1] === reels[2] ? 8         // three of a kind
      : reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2] ? 1.5 // a pair
      : 0;
    detail = `${reels.join(' ')}`; card = reels.join(' ');
  } else {
    const heads = Math.random() < 0.5;
    mult = heads ? 2 : 0;
    detail = heads ? '🪙 Heads!' : '🪙 Tails.'; card = heads ? '🪙' : '🌑';
  }
  const r = await api.economyCasino(i.user.id, bet, mult);
  if (!r.ok) {
    const msg = r.error === 'casino_off' ? 'The casino is off.'
      : r.error === 'not_linked' ? 'Link your account first — **/link**.'
      : r.error === 'insufficient' ? "You don't have enough points for that bet."
      : r.error === 'bad_bet' ? `Your bet must be between ${r.min} and ${r.max}.`
      : 'Could not place that bet.';
    return eReply(i, msg, { title: '🎰 Casino' });
  }
  const won = r.delta > 0;
  const line = won
    ? `${detail}\n🎉 You won **+${Number(r.delta).toLocaleString()}** — balance **${Number(r.points).toLocaleString()}**.`
    : `${detail}\n💀 You lost **${Number(bet).toLocaleString()}**. Balance **${Number(r.points).toLocaleString()}**.`;
  // A picture of the play, rendered by the site (see /og/casino on the API): big reels / coin /
  // die / roulette pocket and a WIN/LOSE banner — a result you can see, not a line of emoji.
  const amt = Number(won ? r.delta : bet).toLocaleString();
  // Animated GIF of the spin, seeded per play so every roll looks different; the site falls
  // back to a still card if encoding ever fails.
  const img = `${SITE_URL}/og/casino/${encodeURIComponent(game)}/${won ? 'win' : 'lose'}.gif?d=${encodeURIComponent(card)}&a=${encodeURIComponent(amt)}&s=${Math.floor(Math.random() * 4294967295)}`;
  const emb = new EmbedBuilder().setColor(won ? 0x248046 : 0xda373c).setTitle(won ? '🎰 You win!' : '🎰 You lose').setDescription(line).setImage(img).setThumbnail(i.user.displayAvatarURL?.({ size: 128 }) || null);
  return i.reply({ embeds: [emb] });
}

async function cmdAppeal(i) {
  const ban = i.guildId ? guildBan(await config(), i.guildId) : null;
  if (!ban) return eReply(i, 'Good news — this server is not blocked from the bot. Everything works normally here.', { title: '✅ Appeal' });
  const ref = ban.banId || i.guildId;
  const lines = [
    'This server is blocked from the bot.',
    '',
    `**Reference:** \`${ref}\``,
    ...(ban.reason ? [`**Reason:** ${ban.reason}`] : []),
    '',
    'To contest it, contact us and quote the reference above:',
    `${SITE_URL}/contact`,
  ];
  return eReply(i, lines.join('\n'), { title: '📝 Appeal' });
}

async function cmdWarn(i) {
  const member = i.options.getUser('member');
  const reason = i.options.getString('reason');
  // A moderator warning themselves is a mis-click; warning the bot is a joke that leaves a
  // real row behind. Both refused here rather than recorded and explained later.
  if (member.id === i.user.id) return eReply(i, 'You cannot warn yourself.', { title: '⚠ Warn' });
  if (member.bot) return eReply(i, 'Bots do not get warnings.', { title: '⚠ Warn' });

  const r = await api.warn(member.id, reason, i.guildId, i.user.username);
  if (!r) return eReply(i, 'The site refused that — the warning was NOT recorded.', { title: '⚠ Warn' });

  // What it triggered is said here, in the channel, because a moderator who does not know the
  // third warning bans somebody will keep issuing them.
  const what = r.triggered
    ? (r.triggered.kind === 'timeout' ? `timed out for ${r.triggered.minutes} minute(s)`
      : r.triggered.kind === 'kick' ? 'removed from the server' : 'banned')
    : null;
  return eReply(i,
    `**${member.username}** warned — that makes **${r.count}**.\nReason: ${reason}`
    + (what ? `\n\n**Warning ${r.count} means they are ${what}.** Queued; the result shows on the site.` : ''),
    { title: '⚠ Warn', color: what ? 0xef4444 : BRAND });
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
  return eReply(i,
    `**${member.username}** — **${r.active ?? warns.filter((w) => !w.revokedAt).length}** standing\n\n${lines.join('\n')}`
    + (warns.length > 10 ? `\n\n…and ${warns.length - 10} more on the site.` : ''),
    { title: '⚠ Warnings' });
}

async function cmdGiveaway(i) {
  const prize = i.options.getString('prize');
  const minutes = i.options.getInteger('minutes');
  const winners = i.options.getInteger('winners') || 1;
  try {
    await api.giveawayCreate({ prize, channelId: i.channelId, durationMinutes: minutes, winnersCount: winners });
    return eReply(i, `Giveaway for **${prize}** created (${winners} winner${winners === 1 ? '' : 's'}, ${minutes} min). It appears here within ~30s.`, { title: '🎉 Giveaway' });
  } catch (e) {
    return eReply(i, 'Could not create the giveaway — try again in a moment.', { title: '🎉 Giveaway' });
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
  const body = `${status}\n\n${roleLines.length ? roleLines.join('\n') : 'No roles configured.'}` +
    (anyGranted ? '' : `\n\nUse **/link** and link your creator id on ${SITE_URL}, then run **/refreshroles**.`);
  return eReply(i, body, { title: anyGranted ? '✅ Roles refreshed' : '🔒 No roles yet', color: anyGranted ? 0x16a34a : BRAND });
}

async function cmdLink(i) {
  try {
    const r = await api.issueLink(i.user.id, i.user.username);
    if (r.linked) return eReply(i, 'Your Discord is already linked to a BetterCommunity account.', { title: '🔗 Already linked', color: 0x16a34a });
    return eReply(i, `Enter this code on ${SITE_URL}/profile to link your account:\n# ${r.code}\n_(expires in 15 min)_`, { title: '🔗 Link your account' });
  } catch {
    return eReply(i, 'Could not create a link code right now — try again later.', { color: 0xef4444 });
  }
}
