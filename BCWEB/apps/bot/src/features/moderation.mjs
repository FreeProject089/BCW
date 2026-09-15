// Moderation: bulk clear, a "no-post" channel that kicks + purges the poster, and the automod
// (features/automod.mjs — rules, escalation, selfbot heuristics, raid detection). All
// configurable from the BCWEB admin dashboard; `moderation` is a per-guild feature.
//
// The legacy `antiSelfbot` flag (mass mentions → 7-day timeout + 24 h purge) is kept for a
// config that has automod switched OFF; with automod on, the `mentions` and `selfbot` rules
// are the ones that decide, and they say so in the log.
import { guildConfig } from '../config.mjs';
import { api } from '../api.mjs';
import { msgReported, modStats } from '../store.mjs';
import { onAutomodMessage, automodConfig } from './automod.mjs';
import { logEvent } from './logs.mjs';

export async function clearMessages(channel, count) {
  if (!channel?.bulkDelete) return 0;
  try { const del = await channel.bulkDelete(Math.min(100, Math.max(1, count)), true); return del.size; }
  catch { return 0; }
}

const userOf = (u) => (u ? { id: u.id, tag: u.tag, avatar: u.displayAvatarURL?.({ size: 64 }) } : null);

export async function onMessage(msg) {
  if (msg.author?.bot || !msg.guild) return;

  // Report "last message" activity (throttled to once/60s per user) for telemetry.
  const last = msgReported.get(msg.author.id) || 0;
  if (Date.now() - last > 60_000) { msgReported.set(msg.author.id, Date.now()); api.activity(msg.guild.id, msg.author.id, 'message', msg.author); }

  const cfg = await guildConfig(msg.guild.id);
  const mod = cfg.moderation || {};
  if (!cfg.enabled || !mod.enabled) return;

  // No-post channels (one or many): delete the user's recent messages + kick them.
  const purgeChannels = mod.purgeChannelIds?.length ? mod.purgeChannelIds : (mod.purgeChannelId ? [mod.purgeChannelId] : []);
  if (purgeChannels.includes(msg.channelId)) {
    let purged = 0;
    try {
      const recent = await msg.channel.messages.fetch({ limit: 50 });
      const theirs = recent.filter((m) => m.author.id === msg.author.id);
      await msg.channel.bulkDelete(theirs, true).catch(() => {});
      purged = theirs.size; modStats.purged += theirs.size;
      await msg.member?.kick('Posted in the restricted channel').catch(() => {});
      modStats.kicks++;
    } catch { /* ignore */ }
    await logEvent(msg.guild.id, 'automod', { rule: 'no-post channel', action: 'kick', reason: `posted in <#${msg.channelId}>`, user: userOf(msg.author), channelId: msg.channelId, content: msg.content, outcome: { kicked: true }, deleted: purged > 0 });
    return;
  }

  // The automod, when it is on, owns everything below.
  if (await automodConfig(msg.guild.id)) return onAutomodMessage(msg);

  // Legacy anti-selfbot: crude signal — a normal user rarely mass-mentions. On trigger:
  // NO ban — the user is timed out for 7 days and every message they sent in the
  // last 24h is purged from all text channels (best-effort sweep).
  if (mod.antiSelfbot && (msg.mentions?.users?.size || 0) > 8) {
    await msg.delete().catch(() => {});
    await msg.member?.timeout(7 * 24 * 60 * 60 * 1000, 'Anti-selfbot: mass mentions').catch((e) => console.warn('[bot] selfbot timeout failed:', e.message));
    modStats.timeouts++;
    await purgeUserMessages(msg.guild, msg.author.id, 24 * 60 * 60 * 1000).catch(() => {});
    console.log(`[bot] anti-selfbot: ${msg.author.tag} timed out 7d + last-24h messages purged`);
    await logEvent(msg.guild.id, 'automod', { rule: 'antiSelfbot (legacy)', action: 'timeout', reason: `${msg.mentions.users.size} user mentions`, user: userOf(msg.author), channelId: msg.channelId, content: msg.content, outcome: { timeoutMin: 7 * 24 * 60 }, deleted: true });
  }
}

// Delete every message a user sent within `windowMs`, sweeping the most recent 100
// messages of each viewable text channel. Bounded (50 channels) so one trigger can't
// stall the bot; bulkDelete handles the under-14-days constraint for us.
export async function purgeUserMessages(guild, userId, windowMs) {
  const cutoff = Date.now() - windowMs;
  const channels = [...guild.channels.cache.values()]
    .filter((c) => c.isTextBased?.() && c.viewable && typeof c.bulkDelete === 'function')
    .slice(0, 50);
  let n = 0;
  for (const ch of channels) {
    try {
      const recent = await ch.messages.fetch({ limit: 100 });
      const theirs = recent.filter((m) => m.author?.id === userId && m.createdTimestamp >= cutoff);
      if (theirs.size) { await ch.bulkDelete(theirs, true); modStats.purged += theirs.size; n += theirs.size; }
    } catch { /* channel without perms — skip */ }
  }
  return n;
}
