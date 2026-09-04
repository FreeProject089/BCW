// Full member scan. On startup (and periodically) the bot fetches every member of every
// guild it's in and pushes the roster to BCWEB, so the admin "member database" contains
// ALL members — not just the ones who happened to send a message or join while the bot
// was online. Requires the (privileged) GuildMembers intent, which the bot already asks
// for. Sent in chunks so a large guild doesn't blow the request-size limit.
import { api } from '../api.mjs';

const CHUNK = 500;

export async function scanAllMembers(client) {
  // The GLOBAL member-storage strategy decides which guilds are worth a full roster fetch.
  const cfg = await api.getConfig().catch(() => ({}));
  const ms = cfg?.memberStorage || { mode: 'managed', scope: 'linked' };
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    if (ms.mode === 'free' || ms.mode === 'unified') {
      // Both store across every server (unified just collapses to one row per person in the
      // view). 'active' scope (free only) means "members the bot has seen act" — a full roster
      // scan would store inactive members too, so skip it and let activity/event writes populate
      // the DB. Everything else full-scans every guild; the API applies the who-filter on sync.
      if (ms.mode === 'free' && ms.scope === 'active') continue;
    } else {
      // 'managed' (and, for now, 'unified'): only guilds the admin opted into `pool` store
      // members. Check the mode BEFORE the (expensive, privileged) full-roster fetch — this is
      // what stops the bot pulling a million members for a server that stores nothing.
      const mode = await api.guildMode(guild.id);
      if (mode !== 'pool') continue;
    }
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
        // Role NAMES, minus @everyone — which every member has and so tells a moderator
        // nothing. Names because the admin screen cannot resolve a snowflake.
        roles: m.roles?.cache ? [...m.roles.cache.values()].filter((r) => r.name !== '@everyone').map((r) => r.name).slice(0, 50) : undefined,
        nickname: m.nickname ?? null,
      });
    }
    for (let i = 0; i < roster.length; i += CHUNK) {
      const r = await api.syncMembers(guild.id, guild.name, guild.memberCount, roster.slice(i, i + CHUNK));
      total += r?.synced || 0;
      if (r && r.stored === false) break; // guild not storing (mode changed mid-scan) — stop
      // The API admits new rows only while the guild's byte budget has room and reports `full`
      // once it does not. Stop pushing chunks then: the rest of the roster would be fetched,
      // serialised and posted for nothing. The owner's dashboard shows the capacity bar.
      if (r && r.full) { console.log(`[bot] member scan: ${guild.name} storage budget full — stopping at ${total}`); break; }
    }
  }
  if (total) console.log(`[bot] member scan: synced ${total} member(s) to the database`);
  return total;
}
