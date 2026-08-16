// Slash commands + interaction routing.
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { api, SITE_URL } from './api.mjs';
import { clearMessages } from './features/moderation.mjs';
import { sendPanel, handlePanelInteraction } from './features/panel.mjs';
import { checkGating } from './features/gating.mjs';
import { handleGiveawayButton } from './features/giveaways.mjs';

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
].map((c) => c.toJSON());

export async function handleInteraction(i) {
  if (i.isChatInputCommand()) {
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
    return;
  }
  if (i.isButton() && i.customId.startsWith('gw:enter:')) return handleGiveawayButton(i);
  if (i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) return handlePanelInteraction(i);
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
