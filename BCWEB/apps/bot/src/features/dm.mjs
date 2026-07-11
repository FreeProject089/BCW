// Deliver pending admin DMs (a plain message, optionally carrying a gift promo code)
// to Discord users. Queued server-side by the admin dashboard; the bot fetches the
// user and DMs them, then marks the item delivered so it isn't re-sent. A user with
// DMs closed simply can't be reached — logged, and the item is still cleared (we
// don't retry a closed DM forever).
import { config } from '../config.mjs';
import { api } from '../api.mjs';

let _running = false;
export async function pollDMs(client) {
  if (_running) return;
  _running = true;
  try {
    const cfg = await config();
    if (!cfg.enabled) return;
    const items = await api.dmPending();
    if (!items.length) return;
    const done = [];
    for (const it of items) {
      try {
        const user = await client.users.fetch(it.discordId);
        // Substitute the recipient-scoped variables ({code} was already resolved server-
        // side, where the minted code is known).
        const content = String(it.message || '')
          .replaceAll('{user}', `<@${it.discordId}>`)
          .replaceAll('{username}', user?.username || 'there')
          .replaceAll('{server}', 'BetterCommunity')
          .slice(0, 2000);
        await user.send({ content });
        done.push(it.id);
        console.log(`[bot] DM delivered to ${it.discordId}`);
      } catch (e) {
        // Unreachable (DMs closed, not a shared server, invalid id) — drop it, don't loop.
        done.push(it.id);
        console.warn(`[bot] DM to ${it.discordId} failed (dropped): ${e.message}`);
      }
    }
    if (done.length) await api.dmSent(done);
  } finally { _running = false; }
}
