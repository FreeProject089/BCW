// Live consumer traffic — "who is pulling what right now" — for repos, catalogues, storage
// pools and the whole platform, from two append-only tables:
//
//   RepoAccessEvent     written by hosting-content.mjs (repo.json, a listing, a file)
//   CatalogAccessEvent  written by catalogs.mjs (the feed, an item download)
//
// ONE shape for every view. The admin's repo view (/admin/repos/traffic) was the first and
// its aggregation lived inline in the route; it is now shapeTraffic() below, and the repo
// route maps the unified rows back onto its original field names so its response did not
// change. A pool holds repos AND catalogues, so a pool view built from only one table would
// look right and quietly under-report — which is why both tables go through the same code.
//
// WHAT NEVER LEAVES THIS FILE
//
// A catalogue's `?k=` is its private share link — a bearer secret (CWE-532). The recorder
// below never reads it into a row: it computes `keyed` (a valid key was presented, decided
// with safeEqual) and drops the key. Likewise `path` is a stored relative path handed in by
// the caller ('catalog.json', an item slug), never req.url, because the URL carries the
// query string and the query string is the secret. The repo table's `accessKey` (a sandbox
// key its owner hands out) is not part of any aggregated view either: the per-repo owner
// dashboard (/repos/:id/dashboard/traffic) is the one place that shows it.
import { clientIp, safeEqual } from './lib.mjs';

/** The live feed covers the last 15 minutes; the rollup the last 24 hours. */
export const LIVE_WINDOW_MS = 15 * 60e3;
export const ROLLUP_WINDOW_MS = 24 * 3600e3;
/** At most this many rows in the live feed (per table, then merged and cut again). */
export const LIVE_TAKE = 200;

// Retention — the SAME rule RepoAccessEvent has always had (hosting-content.mjs logAccess):
// 30 days AND at most 5000 rows per subject, pruned opportunistically on ~2% of writes so a
// busy subject never pays for it on every request. Both tables go through pruneAccessEvents.
export const ACCESS_KEEP_DAYS = 30;
export const ACCESS_KEEP_ROWS = 5000;
export const ACCESS_PRUNE_ODDS = 0.02;

const TABLES = {
  repo: { model: 'repoAccessEvent', fk: 'serverRepoId' },
  catalog: { model: 'catalogAccessEvent', fk: 'catalogId' },
};

/** Delete one subject's events older than the window, then everything past the row cap. */
export async function pruneAccessEvents(p, source, subjectId, now = Date.now()) {
  const t = TABLES[source];
  if (!t) throw new Error(`unknown access source: ${source}`);
  const m = p[t.model];
  await m.deleteMany({ where: { [t.fk]: subjectId, createdAt: { lt: new Date(now - ACCESS_KEEP_DAYS * 864e5) } } });
  const excess = await m.findMany({ where: { [t.fk]: subjectId }, orderBy: { createdAt: 'desc' }, skip: ACCESS_KEEP_ROWS, take: 1000, select: { id: true } });
  if (excess.length) await m.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } });
}

/**
 * The row to write for one catalogue access. Pure, so the "no secret in the row" rule is
 * testable without a database.
 *
 * `keyed` is true only for a presented key that matches this catalogue's CURRENT share key
 * (a rotated-away key is just a wrong key). The key itself is not in the result.
 */
export function catalogAccessRow(catalog, req, { path, kind, identity }) {
  const presented = req?.query?.k;
  const keyed = !!(typeof presented === 'string' && presented && catalog.shareKey && safeEqual(presented, catalog.shareKey));
  return {
    catalogId: catalog.id,
    ip: String(identity?.ip || clientIp(req) || '').slice(0, 64),
    keyed,
    // BMM identifies itself with X-Creator-ID; a browser has a session instead. Same
    // precedence as the repo side's resolveIdentity: the linked creator id names the account.
    userId: identity?.userId || req?.user?.uid || null,
    discordId: identity?.discordId || null,
    path: String(path || '').slice(0, 220),
    kind: kind === 'download' ? 'download' : 'connect',
  };
}

/**
 * Record a catalogue access event. Fire-and-forget exactly like the repo side's logAccess:
 * never awaited by the route, never throws, and a failed write never fails the response.
 */
export function recordCatalogAccess(p, catalog, req, opts, random = Math.random) {
  let data;
  try { data = catalogAccessRow(catalog, req, opts); } catch { return; }
  p.catalogAccessEvent.create({ data })
    .then(async () => {
      if (random() >= ACCESS_PRUNE_ODDS) return;
      await pruneAccessEvents(p, 'catalog', catalog.id);
    })
    .catch(() => { /* logging must never break serving */ });
}

/**
 * Merge already-fetched rows into the one traffic shape. Pure.
 *
 *   recentRepo / recentCatalog   raw event rows (newest first, each at most LIVE_TAKE)
 *   rollupRepo / rollupCatalog   groupBy rows ({ serverRepoId | catalogId, _count: { _all } })
 *   repoMeta / catalogMeta       Map(id -> { name, owner, poolId, slug? })
 *
 * Returns { recent, rollup, pools, totals }:
 *   recent  [{ id, source, subjectId, name, ip, path, kind, keyed, userId, discordId, at }]
 *           keyed is a boolean for a catalogue and null for a repo (no such notion there).
 *   rollup  [{ source, subjectId, name, slug, owner, poolId, count }], busiest first
 *   pools   [{ poolId, repos, catalogs, count }], busiest first; poolId null = not in a pool
 *   totals  { recent, repo24h, catalog24h, all24h }
 */
export function shapeTraffic({ recentRepo = [], recentCatalog = [], rollupRepo = [], rollupCatalog = [], repoMeta = new Map(), catalogMeta = new Map(), take = LIVE_TAKE } = {}) {
  const recent = [
    ...recentRepo.map((e) => ({
      id: e.id, source: 'repo', subjectId: e.serverRepoId, name: repoMeta.get(e.serverRepoId)?.name || '?',
      ip: e.ip, path: e.path, kind: e.kind, keyed: null, userId: e.userId, discordId: e.discordId, at: e.createdAt,
    })),
    ...recentCatalog.map((e) => ({
      id: e.id, source: 'catalog', subjectId: e.catalogId, name: catalogMeta.get(e.catalogId)?.name || '?',
      ip: e.ip, path: e.path, kind: e.kind, keyed: !!e.keyed, userId: e.userId, discordId: e.discordId, at: e.createdAt,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, take);

  const row = (source, subjectId, count, meta) => ({
    source, subjectId, name: meta?.name || '?', slug: meta?.slug || null, owner: meta?.owner || '—', poolId: meta?.poolId || null, count,
  });
  const rollup = [
    ...rollupRepo.map((r) => row('repo', r.serverRepoId, r._count._all, repoMeta.get(r.serverRepoId))),
    ...rollupCatalog.map((r) => row('catalog', r.catalogId, r._count._all, catalogMeta.get(r.catalogId))),
  ].sort((a, b) => b.count - a.count);

  const byPool = new Map();
  for (const r of rollup) {
    const k = r.poolId || null;
    let g = byPool.get(k);
    if (!g) { g = { poolId: k, repos: 0, catalogs: 0, count: 0 }; byPool.set(k, g); }
    if (r.source === 'repo') g.repos++; else g.catalogs++;
    g.count += r.count;
  }
  const pools = [...byPool.values()].sort((a, b) => b.count - a.count);

  const repo24h = rollup.filter((r) => r.source === 'repo').reduce((s, r) => s + r.count, 0);
  const catalog24h = rollup.filter((r) => r.source === 'catalog').reduce((s, r) => s + r.count, 0);
  return { recent, rollup, pools, totals: { recent: recent.length, repo24h, catalog24h, all24h: repo24h + catalog24h } };
}

/**
 * Fetch and shape traffic for a scope.
 *
 *   repoIds / catalogIds   undefined = every row in that table (the global views);
 *                          an array  = only those subjects (a pool, one catalogue);
 *                          []        = none (a pool with no repos, say) — no query is run.
 *
 * Both window queries filter on createdAt alone in the global case, which is what the
 * @@index([createdAt]) on both tables exists for.
 */
export async function loadTraffic(p, { repoIds, catalogIds, now = Date.now() } = {}) {
  const since = new Date(now - LIVE_WINDOW_MS);
  const day = new Date(now - ROLLUP_WINDOW_MS);
  const scope = (fk, ids) => (ids === undefined ? {} : { [fk]: { in: ids } });
  const skipRepo = Array.isArray(repoIds) && repoIds.length === 0;
  const skipCat = Array.isArray(catalogIds) && catalogIds.length === 0;
  const none = Promise.resolve([]);

  const [recentRepo, recentCatalog, rollupRepo, rollupCatalog] = await Promise.all([
    skipRepo ? none : p.repoAccessEvent.findMany({ where: { ...scope('serverRepoId', repoIds), createdAt: { gt: since } }, orderBy: { createdAt: 'desc' }, take: LIVE_TAKE }),
    skipCat ? none : p.catalogAccessEvent.findMany({ where: { ...scope('catalogId', catalogIds), createdAt: { gt: since } }, orderBy: { createdAt: 'desc' }, take: LIVE_TAKE }),
    skipRepo ? none : p.repoAccessEvent.groupBy({ by: ['serverRepoId'], where: { ...scope('serverRepoId', repoIds), createdAt: { gt: day } }, _count: { _all: true } }),
    skipCat ? none : p.catalogAccessEvent.groupBy({ by: ['catalogId'], where: { ...scope('catalogId', catalogIds), createdAt: { gt: day } }, _count: { _all: true } }),
  ]);

  const rIds = [...new Set([...recentRepo.map((e) => e.serverRepoId), ...rollupRepo.map((r) => r.serverRepoId)])];
  const cIds = [...new Set([...recentCatalog.map((e) => e.catalogId), ...rollupCatalog.map((r) => r.catalogId)])];
  const [repos, cats] = await Promise.all([
    rIds.length ? p.serverRepo.findMany({ where: { id: { in: rIds } }, select: { id: true, name: true, groupId: true, owner: { select: { displayName: true } } } }) : [],
    cIds.length ? p.communityCatalog.findMany({ where: { id: { in: cIds } }, select: { id: true, name: true, slug: true, groupId: true, owner: { select: { displayName: true } } } }) : [],
  ]);
  const repoMeta = new Map(repos.map((r) => [r.id, { name: r.name, owner: r.owner?.displayName || '—', poolId: r.groupId || null }]));
  const catalogMeta = new Map(cats.map((c) => [c.id, { name: c.name, slug: c.slug, owner: c.owner?.displayName || '—', poolId: c.groupId || null }]));
  return shapeTraffic({ recentRepo, recentCatalog, rollupRepo, rollupCatalog, repoMeta, catalogMeta });
}

/** Name + owner for each pool id in a shaped `pools` list (null = "not in a pool"). */
export async function namePools(p, pools) {
  const ids = pools.map((g) => g.poolId).filter(Boolean);
  const rows = ids.length ? await p.hostingGroup.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, color: true, owner: { select: { displayName: true } } } }) : [];
  const m = new Map(rows.map((g) => [g.id, g]));
  return pools.map((g) => ({ ...g, name: g.poolId ? (m.get(g.poolId)?.name || '?') : null, color: g.poolId ? (m.get(g.poolId)?.color || '') : '', owner: g.poolId ? (m.get(g.poolId)?.owner?.displayName || '—') : null }));
}
