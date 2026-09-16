// Teams: who may manage what, in one place.
//
// A repo, a catalogue or a pool has an owner (the account that made it). It may also carry a
// team, and then every ACTIVE member of that team manages it alongside the owner — that is
// the whole point of a team. Billing stays with the owner: a member can publish, edit and
// answer messages, not renew somebody else's subscription.
//
// `canManage` is the one predicate the routes ask; the old `entity.ownerId !== req.user.uid`
// checks were written a dozen times and would each have needed the same second clause.

export const TEAM_ROLES = ['owner', 'admin', 'member'];

// How many teams an account may OWN: the admin's `teams.maxOwned` (3 unless set) plus the
// slots it bought (`User.extraTeamSlots`, one per TEAM_SLOT payment). Staff are not capped.
export const TEAM_LIMIT_DEFAULTS = { maxOwned: 3, slotPriceCents: 500, slotCurrency: 'eur' };
export function teamLimitFor(settings = {}, user = {}) {
  const base = Number.isFinite(Number(settings['teams.maxOwned'])) ? Math.max(0, Math.floor(Number(settings['teams.maxOwned']))) : TEAM_LIMIT_DEFAULTS.maxOwned;
  const extra = Math.max(0, Math.floor(Number(user.extraTeamSlots) || 0));
  return { base, extra, limit: base + extra };
}
export function teamSlotPrice(settings = {}) {
  const cents = Number(settings['teams.slotPriceCents']);
  const currency = String(settings['teams.slotCurrency'] || TEAM_LIMIT_DEFAULTS.slotCurrency).toLowerCase().replace(/[^a-z]/g, '').slice(0, 3) || 'eur';
  return { cents: Number.isFinite(cents) && cents >= 50 ? Math.floor(cents) : TEAM_LIMIT_DEFAULTS.slotPriceCents, currency };
}
/** Whether an invite link still admits someone. */
export function inviteUsable(inv, now = new Date()) {
  if (!inv || inv.revokedAt) return false;
  if (inv.expiresAt && new Date(inv.expiresAt).getTime() <= now.getTime()) return false;
  if (inv.maxUses && inv.uses >= inv.maxUses) return false;
  return true;
}
const STAFF = ['ADMIN', 'SUPERADMIN'];

export const isStaff = (user) => !!user && STAFF.includes(user.role);

export function slugifyTeam(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';
}

/** Ids of the teams `uid` is an active member of (optionally only with the given roles). */
export async function teamIdsOf(p, uid, roles = null) {
  if (!uid) return [];
  const rows = await p.teamMember.findMany({
    where: { userId: uid, status: 'active', ...(roles ? { role: { in: roles } } : {}) },
    select: { teamId: true },
  });
  return rows.map((r) => r.teamId);
}

export async function teamRoleOf(p, uid, teamId) {
  if (!uid || !teamId) return null;
  const m = await p.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: uid } } });
  return m && m.status === 'active' ? m.role : null;
}

/**
 * May `user` manage `entity` ({ ownerId, teamId? })? Owner, staff, or an active member of
 * the entity's team. `strictOwner` keeps a billing action to the owner (and staff).
 */
export async function canManage(p, user, entity, { strictOwner = false } = {}) {
  if (!user || !entity) return false;
  if (entity.ownerId === user.uid) return true;
  if (isStaff(user)) return true;
  if (strictOwner || !entity.teamId) return false;
  return !!(await teamRoleOf(p, user.uid, entity.teamId));
}

/** The accounts to tell about something on an entity: the owner and every active member. */
export async function managerIdsOf(p, entity) {
  const ids = new Set(entity?.ownerId ? [entity.ownerId] : []);
  if (entity?.teamId) {
    const rows = await p.teamMember.findMany({ where: { teamId: entity.teamId, status: 'active' }, select: { userId: true } });
    for (const r of rows) ids.add(r.userId);
  }
  return [...ids];
}

/** Public shape of a team, for cards and headers. */
export const serTeam = (t, extra = {}) => (t ? {
  id: t.id, slug: t.slug, name: t.name, description: t.description || '', avatar: t.avatar || null,
  contactEmail: t.contactEmail || '', contactPhone: t.contactPhone || '', website: t.website || '', discord: t.discord || '',
  ownerId: t.ownerId, createdAt: t.createdAt, ...extra,
} : null);
