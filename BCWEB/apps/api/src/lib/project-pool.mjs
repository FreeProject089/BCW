// agent-bcw-pools: a storage pool DEDICATED to one project.
//
// A project (an official one or an "other project") can be attached to ONE HostingGroup
// (HostingGroup.projectTarget, the ProjectRelease target convention: a key, or `sc:<id>`).
// From then on the pool is where that project lives on our disk:
//
//   · the repos and catalogues placed in the pool, as for any pool (their QUOTA counts);
//   · the project's own files, which had no pool before: its pre-release files
//     (PreRelease.downloadSize, uploaded ones only), its shop files (ProjectProduct.fileBytes)
//     and its blog (the article bodies, the measure the blog caps already use).
//
// The files are USAGE, not a reservation: they count for what they weigh. They are added to
// the pool's "given away" bytes through entityPoolQuotaBytes (lib/entity-hosting.mjs), the one
// function every "how much room is left in this pool" already calls, so the repo, catalogue,
// transfer and reservation checks all see them without a second copy of the sum.
//
// A project WITHOUT a pool keeps the site's own limits (the marketplace ceiling, the blog caps):
// nothing changes for it. Pure helpers first; the DB ones take the Prisma client.

const SC = 'sc:';

/** The ProjectRelease target of a project, from its kind and id. */
export const targetOf = ({ projectKey, showcaseProjectId }) => (showcaseProjectId ? `${SC}${showcaseProjectId}` : (projectKey || null));

/** What a target names: { projectKey } or { showcaseProjectId }. */
export function splitTarget(target) {
  const t = String(target || '');
  if (!t) return null;
  return t.startsWith(SC) ? { showcaseProjectId: t.slice(SC.length) } : { projectKey: t };
}

/** Is `target` a plausible target string? (key: lower-case slug; sc: + a cuid-ish id) */
export const isTargetShaped = (t) => typeof t === 'string' && /^(?:[a-z][a-z0-9-]{0,39}|sc:[a-z0-9]{8,40})$/.test(t);

/** The pool dedicated to this target, or null. */
export async function poolOfTarget(p, target) {
  if (!target) return null;
  return p.hostingGroup.findUnique({ where: { projectTarget: target } }).catch(() => null);
}

/** Bytes the project's own files weigh, by kind, as BigInt: { prerelease, products, blog, total }. */
export async function projectFileBytes(p, target) {
  const where = splitTarget(target);
  const zero = { prerelease: 0n, products: 0n, blog: 0n, total: 0n };
  if (!where) return zero;
  const [pr, prod, blog] = await Promise.all([
    p.preRelease.aggregate({ where: { target, downloadKey: { not: null } }, _sum: { downloadSize: true } }).catch(() => null),
    p.projectProduct.aggregate({ where: { ...where, fileKey: { not: null } }, _sum: { fileBytes: true } }).catch(() => null),
    blogBytes(p, where).catch(() => 0n),
  ]);
  const out = {
    prerelease: BigInt(pr?._sum?.downloadSize || 0),
    products: BigInt(prod?._sum?.fileBytes || 0),
    blog: BigInt(blog || 0),
  };
  out.total = out.prerelease + out.products + out.blog;
  return out;
}

async function blogBytes(p, where) {
  let projectId = null;
  if (where.projectKey) {
    const row = await p.project.findUnique({ where: { key: where.projectKey }, select: { id: true } }).catch(() => null);
    if (!row) return 0n;
    projectId = row.id;
  }
  if (!p.$queryRaw) return 0n;
  const rows = projectId
    ? await p.$queryRaw`SELECT COALESCE(SUM(octet_length(body) + octet_length(COALESCE("bodyFr",''))),0)::bigint AS bytes FROM "BlogPost" WHERE "projectId" = ${projectId}`
    : await p.$queryRaw`SELECT COALESCE(SUM(octet_length(body) + octet_length(COALESCE("bodyFr",''))),0)::bigint AS bytes FROM "BlogPost" WHERE "showcaseProjectId" = ${where.showcaseProjectId}`;
  return BigInt(rows?.[0]?.bytes || 0);
}

/** The bytes a dedicated pool's project files occupy (0 for a pool with no project). Called
 *  from entityPoolQuotaBytes, so every room computation subtracts them. */
export async function projectBytesOnPool(p, poolId) {
  if (!poolId) return 0n;
  const g = await p.hostingGroup.findUnique({ where: { id: poolId }, select: { projectTarget: true } }).catch(() => null);
  if (!g?.projectTarget) return 0n;
  return (await projectFileBytes(p, g.projectTarget)).total;
}

/**
 * May the project behind `target` store `addBytes` more (replacing `replacedBytes`)?
 * `{ ok: true, pooled: false }` when it has no pool (the caller applies the site's own limits),
 * `{ ok, pooled: true, poolId, freeBytes, needBytes }` otherwise. `room` is lib/entity-hosting
 * poolRoom, passed in so this leaf imports nothing that imports it.
 */
export async function checkProjectRoom(p, target, addBytes, { replacedBytes = 0, room } = {}) {
  const pool = await poolOfTarget(p, target);
  if (!pool) return { ok: true, pooled: false };
  const free = await room(p, pool.id);
  const need = BigInt(Math.max(0, Math.round(Number(addBytes) || 0) - Math.round(Number(replacedBytes) || 0)));
  const freeBytes = free == null ? 0n : free;
  return { ok: need === 0n || freeBytes >= need, pooled: true, poolId: pool.id, poolName: pool.name, freeBytes: Number(freeBytes > 0n ? freeBytes : 0n), needBytes: Number(need) };
}

/** A pool's figures for a screen: size, what repos/catalogues reserve, what the project's files
 *  weigh, and what is left. Numbers, not BigInt (JSON). */
export async function poolSummary(p, pool, { room } = {}) {
  const files = pool.projectTarget ? await projectFileBytes(p, pool.projectTarget) : { prerelease: 0n, products: 0n, blog: 0n, total: 0n };
  const free = room ? await room(p, pool.id) : null;
  return {
    id: pool.id, name: pool.name, projectTarget: pool.projectTarget || null,
    poolBytes: Number(pool.poolBytes || 0n),
    files: { prerelease: Number(files.prerelease), products: Number(files.products), blog: Number(files.blog), total: Number(files.total) },
    freeBytes: free == null ? null : Number(free > 0n ? free : 0n),
  };
}
