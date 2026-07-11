// Discord giveaways driven by the admin dashboard. Two jobs on each poll:
//  1. Post any active giveaway that hasn't been posted yet (embed + "Enter" button).
//  2. Draw + announce any active giveaway whose end time has passed.
// Entries arrive via the button handler in commands.mjs (customId `gw:enter:<id>`).
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
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
        const gr = gw.requirements || {};
        const reqLine = gr.creator
          ? `\n🔒 **Requires** a linked BetterCommunity account **with a BMM creator id** — link at ${SITE_URL}/profile`
          : gr.linked
            ? `\n🔒 **Requires** a linked BetterCommunity account — link at ${SITE_URL}/profile`
            : '';
        const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle('🎉 Giveaway!')
          .setDescription(`**Prize:** ${gw.prize}\n**Winners:** ${gw.winnersCount}\n**Ends:** <t:${endTs}:R>${reqLine}\n\nClick **Enter** below to join!`)
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
        // DM every winner the customizable message (English default), substituting the
        // bot variables. {code} resolves to their minted gift code when a gift is attached
        // (else the token is stripped); a redeem line is appended when there's a code.
        const gifts = res?.gifts || {};
        const tpl = (gw.winnerMessage && gw.winnerMessage.trim()) || 'Congrats {user} — you won {prize}! 🎉';
        for (const did of winners) {
          const code = gifts[did];
          try {
            const u = await client.users.fetch(did);
            let content = tpl
              .replaceAll('{user}', `<@${did}>`)
              .replaceAll('{username}', u?.username || 'there')
              .replaceAll('{server}', ch?.guild?.name || 'the server')
              .replaceAll('{prize}', gw.prize);
            content = code ? content.replaceAll('{code}', `\`${code}\``) : content.replace(/\s*`?\{code\}`?/g, '');
            if (code) content += tpl.includes('{code}')
              ? `\nRedeem it at ${SITE_URL}/dashboard (Billing → “Redeem a promo code”).`
              : `\nYour gift code: \`${code}\` — redeem it at ${SITE_URL}/dashboard (Billing → “Redeem a promo code”).`;
            await u.send({ content });
          } catch (e) { console.warn('[bot] giveaway winner DM failed', did, e.message); }
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
    await interaction.reply({ content: r.already ? "You're already entered — good luck! 🍀" : `You're in! 🎉 (${r.count} entrant${r.count === 1 ? '' : 's'})`, flags: MessageFlags.Ephemeral });
  } catch (e) {
    const err = e.body?.error;
    const msg = err === 'need_link'
      ? `🔒 You must link your Discord to a BetterCommunity account to enter. Link it at ${SITE_URL}/profile, then click Enter again.`
      : err === 'need_creator'
        ? `🔒 This giveaway requires a linked **BMM creator id** on your BetterCommunity account. Add one at ${SITE_URL}/profile, then click Enter again.`
        : (err === 'not_active' || String(e.message || '').includes('409'))
          ? 'This giveaway has ended.'
          : 'Could not enter — try again in a moment.';
    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}
