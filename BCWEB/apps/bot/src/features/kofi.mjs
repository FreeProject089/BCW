// Ko-fi tip announcements: posts each new donation (recorded by the API's Ko-fi
// webhook → KofiDonation) into the configured channel as a celebratory embed with
// the running total. Same server-side announced-set polling shape as blog/alerts,
// so bot restarts never re-announce old tips.
import * as ui from '../ui.mjs';
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
    // Cache miss is common (a channel the bot hasn't touched since startup) — fetch it
    // so tips still land in the configured salon instead of being silently dropped.
    const channel = client.channels.cache.get(k.channelId) || await client.channels.fetch(k.channelId).catch(() => null);
    if (!channel?.send) { console.warn('[bot] kofi channel not found/inaccessible:', k.channelId); return; }

    const { tips, totals } = await api.kofiUnannounced();
    if (!tips.length) return;
    const done = [];
    for (const tip of tips) {
      try {
        await channel.send(ui.card({
          title: '☕ New Ko-fi tip!', color: 0xff5e5b, // Ko-fi red
          body: `**${tip.fromName || 'Anonymous'}** just tipped **${tip.amount.toFixed(2)} ${tip.currency}**${tip.isSubscription ? ' *(monthly supporter)*' : ''} — thank you! 🧡`,
          footer: `Total raised: ${(totals.totalAmount || 0).toFixed(2)} ${tip.currency} · ${totals.tipCount || 0} tips`,
          buttons: [ui.btn(`${SITE_URL}/about#support`, 'Support the project')],
        }));
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
