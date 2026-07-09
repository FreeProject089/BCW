// Discord giveaways driven by the admin dashboard. Two jobs on each poll:
//  1. Post any active giveaway that hasn't been posted yet (embed + "Enter" button).
//  2. Draw + announce any active giveaway whose end time has passed.
// Entries arrive via the button handler in commands.mjs (customId `gw:enter:<id>`).
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config.mjs';
import { api, SITE_URL } from '../api.mjs';

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null);
}

let _running = false;
export async function pollGiveaways(client) {
  if (_running) return;
  _running = true;
  try {
    const cfg = await config();
    if (!cfg.enabled) return;
    const list = await api.giveawaysActive();
    for (const gw of list) {
      // 1. Post if not yet posted.
      if (!gw.messageId) {
        const ch = await resolveChannel(client, gw.channelId);
        if (!ch?.send) { console.warn('[bot] giveaway channel not found/inaccessible:', gw.channelId); continue; }
        const endTs = Math.floor(new Date(gw.endsAt).getTime() / 1000);
        const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle('🎉 Giveaway!')
          .setDescription(`**Prize:** ${gw.prize}\n**Winners:** ${gw.winnersCount}\n**Ends:** <t:${endTs}:R>\n\nClick **Enter** below to join!`)
          .setTimestamp(new Date(gw.endsAt));
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw:enter:${gw.id}`).setLabel('🎉 Enter').setStyle(ButtonStyle.Primary));
        const msg = await ch.send({ embeds: [embed], components: [row] }).catch((e) => { console.warn('[bot] giveaway post failed', e.message); return null; });
        if (msg) { await api.giveawayPosted(gw.id, msg.id); console.log(`[bot] giveaway ${gw.id} posted in ${gw.channelId}`); }
        continue;
      }
      // 2. Draw if due.
      if (gw.due) {
        const pool = [...new Set(gw.entries || [])];
        // Fisher-Yates shuffle, then take the first N as winners.
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        const winners = pool.slice(0, Math.min(gw.winnersCount, pool.length));
        const res = await api.giveawayDrawn(gw.id, winners);
        const ch = await resolveChannel(client, gw.channelId);
        if (ch?.send) {
          const content = winners.length
            ? `🎉 Congratulations ${winners.map((w) => `<@${w}>`).join(', ')}! You won **${gw.prize}**!`
            : `The giveaway for **${gw.prize}** ended with no entries. 😢`;
          await ch.send({ content }).catch(() => {});
        }
        // DM the minted gift codes to winners who have a linked account.
        const gifts = res?.gifts || {};
        for (const [did, code] of Object.entries(gifts)) {
          try { const u = await client.users.fetch(did); await u.send({ content: `🎁 You won **${gw.prize}**!\nYour gift code: \`${code}\` — redeem it at ${SITE_URL}/dashboard (Billing → “Redeem a promo code”).` }); }
          catch (e) { console.warn('[bot] giveaway gift DM failed', did, e.message); }
        }
        console.log(`[bot] giveaway ${gw.id} drawn: ${winners.length} winner(s)`);
      }
    }
  } finally { _running = false; }
}

// Called from the interaction handler when a user clicks the "Enter" button.
export async function handleGiveawayButton(interaction) {
  const [, , id] = interaction.customId.split(':');
  try {
    const r = await api.giveawayEnter(id, interaction.user.id);
    await interaction.reply({ content: r.already ? "You're already entered — good luck! 🍀" : `You're in! 🎉 (${r.count} entrant${r.count === 1 ? '' : 's'})`, ephemeral: true });
  } catch (e) {
    const notActive = String(e.message || '').includes('409');
    await interaction.reply({ content: notActive ? 'This giveaway has ended.' : 'Could not enter — try again in a moment.', ephemeral: true }).catch(() => {});
  }
}
