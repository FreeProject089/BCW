// Slash commands + interaction routing.
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { api, SITE_URL } from './api.mjs';
import { clearMessages } from './features/moderation.mjs';
import { sendPanel, handlePanelInteraction } from './features/panel.mjs';
import { checkGating } from './features/gating.mjs';

// Every bot response is an embed (brand-colored card) rather than bare text —
// consistent look across alerts/blog/tips/commands. Shared with panel.mjs.
export const BRAND = 0xf59e0b;
export const eReply = (i, text, { color = BRAND, title = null, ephemeral = true } = {}) =>
  i.reply({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(text)], ephemeral });

export const commandData = [
  new SlashCommandBuilder().setName('link').setDescription('Link your Discord to your BetterCommunity account'),
  new SlashCommandBuilder().setName('verify').setDescription('Re-check your links and update your access roles'),
  new SlashCommandBuilder().setName('refreshroles').setDescription('Re-sync your gated roles now (after linking on the website)'),
  new SlashCommandBuilder().setName('voice').setDescription('Show the control panel for your temp voice channel'),
  new SlashCommandBuilder().setName('clear').setDescription('Delete recent messages (max 100)')
    .addIntegerOption((o) => o.setName('count').setDescription('How many (1-100)').setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
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
    return;
  }
  if (i.isButton() || i.isAnySelectMenu() || i.isModalSubmit()) return handlePanelInteraction(i);
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
