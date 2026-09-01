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

/** A human-facing capacity summary for the dashboard warning. */
export function capacityStatus(quotaBytes, stored) {
  const cap = memberCapacity(quotaBytes);
  if (cap === Infinity) return { unlimited: true, stored, cap: null, remaining: null, pct: 0, near: false, full: false };
  const remaining = Math.max(0, cap - stored);
  const pct = cap ? Math.min(100, Math.round((stored / cap) * 100)) : 100;
  return { unlimited: false, stored, cap, remaining, pct, near: pct >= 85 && pct < 100, full: stored >= cap };
}
