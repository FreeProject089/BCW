// Link buffer: when someone signs in on the website with Discord, a DiscordLink is
// created and flagged pendingSync. This poll drains that buffer and refreshes the member's
// gated roles PROMPTLY (across whatever guilds they share with the bot), instead of waiting
// for the periodic 5-min full sync. Each id is cleared once processed.
import { config } from '../config.mjs';
import { api } from '../api.mjs';
import { checkGating } from './gating.mjs';

let _running = false;
export async function pollLinks(client) {
  if (_running) return;
  _running = true;
  try {
    const cfg = await config();
    if (!cfg.enabled) return;
    const ids = await api.linksPending();
    if (!ids.length) return;
    const done = [];
    for (const discordId of ids) {
      let touched = false;
      for (const guild of client.guilds.cache.values()) {
        try {
          const member = await guild.members.fetch(discordId);
          if (member && !member.user.bot) { await checkGating(member).catch(() => {}); touched = true; }
        } catch { /* not in this guild — try the next */ }
      }
      done.push(discordId); // clear regardless: a member the bot can't see needs no roles yet
      if (touched) console.log(`[bot] refreshed roles for freshly linked ${discordId}`);
    }
    if (done.length) await api.linksSynced(done);
  } finally { _running = false; }
}
