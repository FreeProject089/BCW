// Who may configure a server's bot settings from inside Discord, and what they may change.
//
// WHY THIS EXISTS
//
// Every per-guild setting lived on the site, behind a login. The bot could read them and
// never write them, so the person who actually runs the server — who is in Discord, looking
// at the bot — had to leave, find the dashboard, and come back for a log channel.
//
// Opening that up is a permission decision with an obvious expensive failure: a stranger
// reconfiguring somebody's bot. So it is written here, pure and tested, rather than inline
// in a route where the two conditions below would eventually collapse into one.

/**
 * TWO conditions, both required.
 *
 * 1. The actor is the guild's owner or one of its reported managers. The bot reports both
 *    on every heartbeat, so this is populated for every guild it is in.
 *
 * 2. Their Discord account is LINKED to a BetterCommunity account.
 *
 * The second is the one that looks redundant and is not. The bot already knows the Discord
 * id, so why require an account? Because a Discord id on its own is not somebody we have
 * any record of: no terms accepted, no audit trail, nobody to hold to anything. It is also
 * why the refusal has to say "link an account" and not "you are not allowed" — the person
 * is very often the owner, and telling them they lack permission would be a lie.
 *
 * Discord's own Manage Server permission is checked by the BOT before it calls, as a
 * pre-filter. It is deliberately not the authority here: it can be handed to anyone by
 * anyone who holds it, and this decides who writes to our records.
 *
 * @param guild  the BotGuild row, or null if the bot has never reported this server
 * @param actorDiscordId  who is asking
 * @param linked whether that Discord id resolves to a BetterCommunity account
 */
export function canConfigureGuild(guild, actorDiscordId, linked) {
  if (!guild || !linked) return false;
  const who = String(actorDiscordId || '');
  if (!who) return false;
  if (guild.ownerDiscordId && String(guild.ownerDiscordId) === who) return true;
  return (guild.managerDiscordIds || []).map(String).includes(who);
}

/** Only these; everything else is named in `rejected` so the bot can say what it ignored. */
const ALLOWED = ['language', 'logChannelId', 'storeLogs', 'memberMode'];

/**
 * What of a requested change may actually be applied from Discord.
 *
 * NOT hostingGroupId or storageQuotaBytes: they decide which storage pool a guild eats and
 * how much of it, which is the account holder's decision, made where the bill is. A server
 * manager in Discord does not have the context to choose a pool and should not be handed
 * the ability to spend somebody else's.
 *
 * NOT memberMode 'pool' either, for the same reason one step removed — it is the mode that
 * consumes a pool, and picking it without picking the pool is half a decision.
 *
 * Returns `{ data, rejected, error? }`. Junk is DROPPED into `rejected` rather than coerced:
 * a language of 'klingon' silently becoming null would be a setting changed by a typo.
 */
export function patchFromDiscord(patch, current) {
  const data = {};
  const rejected = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!ALLOWED.includes(k)) { rejected.push(k); continue; }
    if (k === 'language') {
      if (v === 'auto') { data.language = null; continue; }
      if (typeof v === 'string' && /^[a-z]{2}$/.test(v)) { data.language = v; continue; }
      rejected.push(k); continue;
    }
    if (k === 'logChannelId') {
      if (v === null || (typeof v === 'string' && /^\d{1,32}$/.test(v))) { data.logChannelId = v; continue; }
      rejected.push(k); continue;
    }
    if (k === 'storeLogs') {
      if (typeof v === 'boolean') { data.storeLogs = v; continue; }
      rejected.push(k); continue;
    }
    // memberMode: 'pool' is site-only (see above).
    if (v === 'none' || v === 'moderation') { data.memberMode = v; continue; }
    rejected.push(k);
  }

  // The same rule the admin route enforces, checked from BOTH ends. `moderation` runs bans
  // and kicks and has to log somewhere — and a check written only at "turning moderation
  // on" misses the other direction entirely: clearing the channel while it is already on.
  const next = { ...current, ...data };
  if (next.memberMode === 'moderation' && !next.logChannelId) {
    return { data, rejected, error: 'log_channel_required' };
  }
  return { data, rejected };
}
