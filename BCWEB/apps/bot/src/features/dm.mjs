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

/**
 * Drain an admin broadcast: the same DM, to everybody the bot has seen.
 *
 * PACED ON PURPOSE. Discord rate-limits direct messages hard and treats a burst as spam,
 * and the account that gets flagged is the BOT — the cost of going fast is not a slow
 * message, it is a dead integration. Ten per poll, spaced a second apart, and the poll runs
 * every 30 seconds: about 1200 members an hour. A broadcast is not an urgent channel.
 *
 * Progress lives server-side (the remaining recipients are a row, not a variable), so a bot
 * restart resumes where it stopped instead of starting over — which for a broadcast means
 * DMing everyone twice.
 */
let _bcRunning = false;
export async function pollDMBroadcast(client) {
    if (_bcRunning) return;
    _bcRunning = true;
    try {
        const cfg = await config();
        if (!cfg.enabled) return;
        const job = await api.dmAllPending();
        if (!job?.batch?.length) return;
        const sent = [], failed = [];
        for (const id of job.batch) {
            try {
                const user = await client.users.fetch(id);
                const content = String(job.message || '')
                    .replaceAll('{user}', `<@${id}>`)
                    .replaceAll('{username}', user?.username || 'there')
                    .replaceAll('{server}', 'BetterCommunity')
                    .slice(0, 2000);
                await user.send({ content });
                sent.push(id);
            } catch (e) {
                // Closed DMs, no shared server, a stale id. Counted as failed and never
                // retried — a broadcast that keeps knocking is exactly what gets reported.
                failed.push(id);
                console.warn(`[bot] broadcast DM to ${id} failed: ${e.message}`);
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
        // Reported even when everything failed: the server needs those ids off the pending
        // list, or the same ten are retried for ever.
        await api.dmAllResult(job.id, sent, failed);
        console.log(`[bot] broadcast: ${sent.length} sent, ${failed.length} failed this batch`);
    } finally { _bcRunning = false; }
}
