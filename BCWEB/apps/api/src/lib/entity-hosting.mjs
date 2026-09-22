// Hosting settings per THING (a blog, a project's contact inbox, a team's contact inbox)
// instead of one global number for all of them. See EntityHostingSettings in schema.prisma.
//
// Two questions, answered here and nowhere else:
//
//   limitsFor()      how much may this thing hold? (count and bytes, or no cap)
//   attachmentPolicy() may its messages carry files, and how big?
//
// and one bookkeeping duty: a thing in `pool` mode RESERVES bytes from a HostingGroup, and
// every place that asks "how much room is left in this pool" must subtract them, or the
// same bytes get handed to a repo as well. entityPoolQuotaBytes() is what those places add.

export const KINDS = ['blog', 'project-contact', 'team-contact'];
export const MODES = ['inherit', 'custom', 'unlimited', 'pool'];
export const ATTACH = ['inherit', 'off', 'always', 'pool_only'];

const DEFAULT = { mode: 'inherit', maxItems: 0, maxKB: 0, poolId: null, quotaBytes: 0n, attachments: 'inherit', maxAttachmentMB: 0 };

/** The stored row for (kind, ref), or the defaults. Never throws. */
export async function hostingFor(p, kind, ref) {
  const row = await p.entityHostingSettings.findUnique({ where: { kind_ref: { kind, ref } } }).catch(() => null);
  return row ? { ...DEFAULT, ...row } : { ...DEFAULT, kind, ref };
}

/**
 * The caps that apply, as `{ maxItems, maxBytes, source }`: 0 / null mean no cap on that
 * axis. `inherited` is what `inherit` falls back to (the site-wide numbers the caller
 * already reads, in the same shape), so this function never has to know where those live.
 */
export function limitsFor(s, inherited = { maxItems: 0, maxBytes: null }) {
  switch (s.mode) {
    case 'unlimited': return { maxItems: 0, maxBytes: null, source: 'unlimited' };
    case 'custom': return { maxItems: Math.max(0, s.maxItems | 0), maxBytes: s.maxKB > 0 ? s.maxKB * 1024 : null, source: 'custom' };
    // Pool: nothing of its own. The size cap IS the reservation; with no reservation the
    // answer is zero bytes, which is the honest reading of "0 limit + a pool" until the
    // pool actually gives it something.
    // No count cap either: what a pool pays for is bytes, and counting posts on top of them
    // would be a second limit the pool owner never chose.
    case 'pool': return { maxItems: 0, maxBytes: s.poolId ? Number(s.quotaBytes || 0n) : 0, source: 'pool', poolId: s.poolId };
    default: return { ...inherited, source: 'inherit' };
  }
}

/**
 * May a message on this contact carry files? `site` is the site-wide default
 * ({ attachments, maxAttachmentMB }). Returns `{ allowed, why, maxBytes, poolId }`:
 *
 *   off         never
 *   always      yes, on the site's storage, up to maxAttachmentMB
 *   pool_only   only once the thing is in `pool` mode with a reservation: the files are
 *               then counted against that reservation
 */
export function attachmentPolicy(s, site = { attachments: 'pool_only', maxAttachmentMB: 10 }) {
  const rule = s.attachments && s.attachments !== 'inherit' ? s.attachments : (site.attachments || 'pool_only');
  const mb = s.maxAttachmentMB > 0 ? s.maxAttachmentMB : Math.max(1, Number(site.maxAttachmentMB) || 10);
  const pooled = s.mode === 'pool' && s.poolId && Number(s.quotaBytes || 0n) > 0;
  if (rule === 'off') return { allowed: false, why: 'attachments_off', maxBytes: 0 };
  if (rule === 'pool_only' && !pooled) return { allowed: false, why: 'attachments_need_pool', maxBytes: 0 };
  return { allowed: true, why: '', maxBytes: mb * 1024 * 1024, poolId: pooled ? s.poolId : null };
}

/** The site-wide contact-attachment default, from AdminSetting. */
export async function siteAttachmentDefault(p) {
  const rows = await p.adminSetting.findMany({ where: { key: { in: ['contact.attachments', 'contact.maxAttachmentMB'] } } }).catch(() => []);
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const a = String(v['contact.attachments'] || 'pool_only');
  return { attachments: ATTACH.includes(a) && a !== 'inherit' ? a : 'pool_only', maxAttachmentMB: Math.max(1, Math.min(100, Number(v['contact.maxAttachmentMB']) || 10)) };
}

/** Bytes that things in `pool` mode have reserved from this pool. BigInt, like poolBytes. */
export async function entityPoolQuotaBytes(p, poolId, { exceptId = null } = {}) {
  if (!poolId) return 0n;
  const agg = await p.entityHostingSettings.aggregate({ where: { poolId, mode: 'pool', ...(exceptId ? { NOT: { id: exceptId } } : {}) }, _sum: { quotaBytes: true } }).catch(() => null);
  return agg?._sum?.quotaBytes || 0n;
}

/**
 * Free bytes in a pool once repos, catalogues AND reserved things are counted. The same
 * sum lib.mjs poolFreeBytes() makes, plus the reservations; kept here so the reservation
 * logic never needs a second copy.
 */
export async function poolRoom(p, poolId, { exceptId = null } = {}) {
  const g = await p.hostingGroup.findUnique({ where: { id: poolId }, select: { id: true, poolBytes: true } }).catch(() => null);
  if (!g) return null;
  const [r, c, e] = await Promise.all([
    p.serverRepo.aggregate({ where: { groupId: g.id }, _sum: { storageQuotaBytes: true } }),
    p.communityCatalog.aggregate({ where: { groupId: g.id }, _sum: { storageQuotaBytes: true } }),
    entityPoolQuotaBytes(p, g.id, { exceptId }),
  ]);
  return g.poolBytes - (r._sum.storageQuotaBytes || 0n) - (c._sum.storageQuotaBytes || 0n) - e;
}

/**
 * Write the settings, checking a pool reservation fits. Returns `{ row }` or `{ error }`.
 * `canUsePool(poolId)` is the caller's ownership rule (an admin: any pool; a team: its own).
 */
export async function saveHosting(p, kind, ref, input, { actorId = null, canUsePool = async () => true } = {}) {
  if (!KINDS.includes(kind)) return { error: 'invalid_kind' };
  const cur = await hostingFor(p, kind, ref);
  const next = {
    mode: input.mode ?? cur.mode,
    maxItems: input.maxItems ?? cur.maxItems,
    maxKB: input.maxKB ?? cur.maxKB,
    poolId: input.poolId !== undefined ? (input.poolId || null) : cur.poolId,
    quotaBytes: input.quotaMB !== undefined ? BigInt(Math.max(0, Math.round(Number(input.quotaMB) || 0))) * 1024n * 1024n : BigInt(cur.quotaBytes || 0n),
    attachments: input.attachments ?? cur.attachments,
    maxAttachmentMB: input.maxAttachmentMB ?? cur.maxAttachmentMB,
  };
  if (!MODES.includes(next.mode)) return { error: 'invalid_mode' };
  if (!ATTACH.includes(next.attachments)) return { error: 'invalid_attachments' };
  if (next.mode !== 'pool') { next.poolId = null; next.quotaBytes = 0n; }
  if (next.mode === 'pool') {
    if (!next.poolId) return { error: 'pool_required' };
    if (!(await canUsePool(next.poolId))) return { error: 'pool_forbidden' };
    const room = await poolRoom(p, next.poolId, { exceptId: cur.id || null });
    if (room === null) return { error: 'pool_not_found' };
    if (next.quotaBytes > room) return { error: 'pool_exceeded', freeMB: Number(room > 0n ? room : 0n) / (1024 * 1024) };
  }
  const row = await p.entityHostingSettings.upsert({ where: { kind_ref: { kind, ref } }, create: { kind, ref, ...next, updatedBy: actorId }, update: { ...next, updatedBy: actorId } });
  return { row };
}

/** A row as JSON: BigInt is not serialisable, so the quota travels as megabytes. */
export const serHosting = (s) => ({
  mode: s.mode, maxItems: s.maxItems, maxKB: s.maxKB, poolId: s.poolId || null,
  quotaMB: Number(s.quotaBytes || 0n) / (1024 * 1024), attachments: s.attachments, maxAttachmentMB: s.maxAttachmentMB,
});
