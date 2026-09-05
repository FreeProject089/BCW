// Per-guild Discord member-storage budgeting (B4). Pure and dependency-free so the admission
// rule — the thing that actually stops a 1M-member guild filling the DB — is unit-testable.
//
// The FIRST line of defence is the mode: a guild is `none` by default and stores nothing, so a
// bot joining a huge server writes zero rows until an admin opts it into `pool`. The budget is
// the SECOND line, capping how many rows an opted-in guild may keep.

export const BYTES_PER_MEMBER = 512; // a DiscordActivity row's rough footprint (id, name, roles…)
export const BYTES_PER_LOG = 256; // a ModerationLog row's rough footprint

/** How many member rows a byte budget allows. 0 (or unset) = unlimited — an admin who set
 *  `pool` with no quota chose to store everything; the mode gate already protects `none`. */
export function memberCapacity(quotaBytes) {
  const q = Number(quotaBytes) || 0;
  return q > 0 ? Math.floor(q / BYTES_PER_MEMBER) : Infinity;
}

/**
 * Resolve a member sync/activity write against a guild's mode + budget.
 * @returns {{store:boolean, reason?:string, admit?:number, full?:boolean, room?:number}}
 *   store=false + reason  → the guild does not store members (mode is not `pool`).
 *   store=true            → admit up to `admit` of `incoming` new rows; `full` when the budget
 *                           truncated the batch; `room` is the remaining capacity before this write.
 */
export function admitMembers(mode, stored, capacity, incoming = 0) {
  if (mode !== 'pool') return { store: false, reason: 'member_storage_off' };
  if (!(capacity > 0) && capacity !== Infinity) return { store: true, admit: 0, full: incoming > 0, room: 0 };
  const room = capacity === Infinity ? Infinity : Math.max(0, capacity - Math.max(0, stored));
  const admit = Math.min(incoming, room);
  return { store: true, admit: admit === Infinity ? incoming : admit, full: room !== Infinity && admit < incoming, room };
}

// Record a moderation action in a guild's ModerationLog — but only when the guild keeps logs:
// `pool` (it stores everything), or `moderation` + storeLogs. Otherwise the action is
// Discord-channel-only, the privacy-preserving default (Prmtp123 §20: rien n'est stocké par
// défaut). Takes the Prisma client so it can live in this dependency-free module (no import
// cycle between bot.mjs and warns.mjs). Best-effort: a record that fails to save must never
// fail the moderation it records.
export async function logModeration(p, { guildId, actorId, targetId, action, reason = '', auto = false }) {
  if (!guildId || !targetId || !action) return;
  try {
    const g = await p.botGuild.findUnique({ where: { guildId }, select: { memberMode: true, storeLogs: true } });
    if (!g) return;
    if (!g.storeLogs) return;
    await p.moderationLog.create({ data: { guildId, actorId: actorId || 'system', targetId, action, reason: reason || null, auto } });
  } catch { /* a moderation record that fails to save must not fail the moderation */ }
}

// ── The global member database (2026-09-06) ──────────────────────────────────
// One database for every server the bot is in, configured from the admin dashboard only —
// a server no longer chooses whether it is stored. Priority when the byte cap is reached:
// linked members are never evicted, active members are kept over inactive ones, and the
// inactive (no message / voice within `inactiveDays`, no site link) are the ones removed
// to make room — when `evictInactive` is on. Off, the database simply stops growing.
export function memberPolicy(cfg) {
  const ms = cfg?.memberStorage || {};
  const mb = Number(cfg?.limits?.storageMB) || 0;
  return {
    enabled: ms.enabled !== false,
    capRows: memberCapacity(mb * 1024 * 1024),
    storageMB: mb,
    evictInactive: ms.evictInactive !== false,
    inactiveDays: Math.max(1, Number(ms.inactiveDays) || 30),
    keepLinked: cfg?.limits?.keepLinked !== false,
  };
}

/** The `where` for rows that count as inactive under the policy: no activity within the window. */
export function inactiveWhere(policy) {
  const since = new Date(Date.now() - policy.inactiveDays * 864e5);
  return { AND: [{ OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: since } }] }, { OR: [{ lastVoiceJoinAt: null }, { lastVoiceJoinAt: { lt: since } }] }] };
}

/**
 * Free `need` rows for newcomers by evicting the least valuable rows: inactive AND unlinked
 * first (oldest refresh first), then — only when `hard` — active unlinked ones. Linked members
 * are never touched while keepLinked holds. Returns how many rows were removed.
 */
export async function evictForRoom(p, policy, need, { hard = false, protect = [] } = {}) {
  if (!(need > 0) || !policy.evictInactive) return 0;
  const linked = policy.keepLinked ? new Set((await p.discordLink.findMany({ select: { discordId: true } })).map((l) => l.discordId)) : new Set();
  const skip = new Set([...linked, ...protect]);
  let removed = 0;
  const passes = hard ? [inactiveWhere(policy), {}] : [inactiveWhere(policy)];
  for (const where of passes) {
    if (removed >= need) break;
    // Pull a little more than needed: the skip set is applied after the query.
    const rows = await p.discordActivity.findMany({ where, orderBy: { updatedAt: 'asc' }, take: Math.min(5000, (need - removed) * 2 + 50), select: { guildId: true, discordId: true } });
    const victims = rows.filter((r) => !skip.has(r.discordId)).slice(0, need - removed);
    for (const v of victims) await p.discordActivity.delete({ where: { guildId_discordId: { guildId: v.guildId, discordId: v.discordId } } }).catch(() => {});
    removed += victims.length;
    if (!rows.length) break;
  }
  return removed;
}

/** A human-facing capacity summary for the dashboard warning. */
export function capacityStatus(quotaBytes, stored) {
  const cap = memberCapacity(quotaBytes);
  if (cap === Infinity) return { unlimited: true, stored, cap: null, remaining: null, pct: 0, near: false, full: false };
  const remaining = Math.max(0, cap - stored);
  const pct = cap ? Math.min(100, Math.round((stored / cap) * 100)) : 100;
  return { unlimited: false, stored, cap, remaining, pct, near: pct >= 85 && pct < 100, full: stored >= cap };
}
