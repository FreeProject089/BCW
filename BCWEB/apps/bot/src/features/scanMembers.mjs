// Full member scan. On startup (and periodically) the bot fetches every member of every
// guild it's in and pushes the roster to BCWEB, so the admin "member database" contains
// ALL members — not just the ones who happened to send a message or join while the bot
// was online. Requires the (privileged) GuildMembers intent, which the bot already asks
// for. Sent in chunks so a large guild doesn't blow the request-size limit.
import { api } from '../api.mjs';

const CHUNK = 500;

export async function scanAllMembers(client) {
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    let members;
    try { members = await guild.members.fetch(); } catch (e) { console.warn(`[bot] member scan failed for ${guild.name}:`, e.message); continue; }
    const roster = [];
    for (const m of members.values()) {
      if (m.user.bot) continue; // real people only — the member database excludes bots
      roster.push({
        discordId: m.id,
        username: m.user.username,
        avatar: m.user.displayAvatarURL?.({ size: 128 }),
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : undefined,
      });
    }
    for (let i = 0; i < roster.length; i += CHUNK) {
      const r = await api.syncMembers(roster.slice(i, i + CHUNK));
      total += r?.synced || 0;
    }
  }
  if (total) console.log(`[bot] member scan: synced ${total} member(s) to the database`);
  return total;
}
