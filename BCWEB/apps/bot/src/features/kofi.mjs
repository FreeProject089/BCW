// Ko-fi tip announcements: posts each new donation (recorded by the API's Ko-fi
// webhook → KofiDonation) into the configured channel as a celebratory embed with
// the running total. Same server-side announced-set polling shape as blog/alerts,
// so bot restarts never re-announce old tips.
import * as ui from '../ui.mjs';
import { config } from '../config.mjs';
import { api, SITE_URL } from '../api.mjs';
import { adminAlert } from './logs.mjs';

let _running = false;
export async function pollKofi(client) {
  if (_running) return;
  _running = true;
  try {
    const cfg = await config();
    const k = cfg.kofi || {};
    const forum = !!cfg.alerts?.forumId; // tips also go to the admin-alerts forum (Ko-fi post)
    if (!cfg.enabled || !k.enabled || (!k.channelId && !forum)) return;
    // Cache miss is common (a channel the bot hasn't touched since startup) — fetch it
    // so tips still land in the configured salon instead of being silently dropped.
    const channel = k.channelId ? (client.channels.cache.get(k.channelId) || await client.channels.fetch(k.channelId).catch(() => null)) : null;
    if (!channel?.send && !forum) { console.warn('[bot] kofi channel not found/inaccessible:', k.channelId); return; }

    const { tips, totals } = await api.kofiUnannounced();
    if (!tips.length) return;
    const done = [];
    for (const tip of tips) {
      try {
        const card = ui.card({
          title: `${ui.icx('kofi')}New Ko-fi tip!`, color: 0xff5e5b, // Ko-fi red
          body: `**${tip.fromName || 'Anonymous'}** just tipped **${tip.amount.toFixed(2)} ${tip.currency}**${tip.isSubscription ? ' *(monthly supporter)*' : ''} — thank you!`,
          footer: `Total raised: ${(totals.totalAmount || 0).toFixed(2)} ${totals.currency || tip.currency} · ${totals.tipCount || 0} tips`,
          buttons: [ui.btn(`${SITE_URL}/about#support`, 'Support the project')],
        });
        // The public thank-you in the tips channel stays; the admin forum gets a copy in its
        // Ko-fi post. Neither replaces the other — one is for members, one for the books.
        if (channel?.send) await channel.send(card);
        await adminAlert('kofi', card);
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
