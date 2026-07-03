// Ko-fi tip announcements: posts each new donation (recorded by the API's Ko-fi
// webhook → KofiDonation) into the configured channel as a celebratory embed with
// the running total. Same server-side announced-set polling shape as blog/alerts,
// so bot restarts never re-announce old tips.
import { EmbedBuilder } from 'discord.js';
import { config } from '../config.mjs';
import { api, SITE_URL } from '../api.mjs';

let _running = false;
export async function pollKofi(client) {
  if (_running) return;
  _running = true;
  try {
    const cfg = await config();
    const k = cfg.kofi || {};
    if (!cfg.enabled || !k.enabled || !k.channelId) return;
    const channel = client.channels.cache.get(k.channelId);
    if (!channel?.send) return;

    const { tips, totals } = await api.kofiUnannounced();
    if (!tips.length) return;
    const done = [];
    for (const tip of tips) {
      try {
        const embed = new EmbedBuilder()
          .setColor(0xff5e5b) // Ko-fi red
          .setTitle('☕ New Ko-fi tip!')
          .setDescription(`**${tip.fromName || 'Anonymous'}** just tipped **${tip.amount.toFixed(2)} ${tip.currency}**${tip.isSubscription ? ' *(monthly supporter)*' : ''} — thank you! 🧡`)
          .setURL(`${SITE_URL}`)
          .setFooter({ text: `Total raised: ${(totals.totalAmount || 0).toFixed(2)} ${tip.currency} · ${totals.tipCount || 0} tips` })
          .setTimestamp(new Date(tip.createdAt));
        await channel.send({ embeds: [embed] });
        done.push(tip.id);
      } catch (e) {
        console.warn('[bot] kofi announce failed', e.message);
        break; // channel/permission issue — retry next cycle
      }
    }
    if (done.length) {
      await api.kofiMarkAnnounced(done);
      console.log(`[bot] announced ${done.length} Ko-fi tip(s)`);
    }
  } finally { _running = false; }
}
