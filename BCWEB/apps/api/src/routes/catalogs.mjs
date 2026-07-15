import { z } from 'zod';
import crypto from 'node:crypto';
import { zipReadAll, zipEntry } from '../lib/native.mjs';
import {
  db, requireRole, requireCap, optionalAuth, slugify, notify,
  resolveClientIdentity, accessListMatches, policyBans, policyWhitelist,
  getGlobalAccessPolicy, getUserAccessPolicy,
} from '../lib/lib.mjs';
import { presignGet, deleteObject, getObject } from '../lib/storage.mjs';
import { userBcId } from '../lib/repofingerprint.mjs';

// Read an object-storage stream fully into a Buffer (bounded by the payload's stored size).
async function readObject(key) {
  const { body } = await getObject(key);
  const chunks = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
}
// Entries in a .bmmplug/.bmmtheme (ZIP) whose text is safe to preview inline for review.
const TEXT_EXT = /\.(json|txt|md|css|js|mjs|cjs|ts|lua|cfg|ini|yml|yaml|xml|toml|csv|log|sh)$/i;
const TEXT_PREVIEW_MAX = 256 * 1024; // don't inline more than 256 KB of a single entry

const KINDS = ['APP', 'PLUGIN', 'THEME', 'PRESET'];
const SITE_URL = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
const GiB = 1024 ** 3;

// Free bytes left in a storage pool: its poolBytes minus what repos AND catalogs in it
// have already reserved. Storage is fungible — a repo and a catalog draw from the same
// poolBytes, so both must be subtracted.
async function poolFreeBytes(p, group) {
  const [repoAgg, catAgg] = await Promise.all([
    p.serverRepo.aggregate({ where: { groupId: group.id }, _sum: { storageQuotaBytes: true } }),
    p.communityCatalog.aggregate({ where: { groupId: group.id }, _sum: { storageQuotaBytes: true } }),
  ]);
  return group.poolBytes - (repoAgg._sum.storageQuotaBytes || 0n) - (catAgg._sum.storageQuotaBytes || 0n);
}

// A community catalog is served ONLY when it's ACTIVE (not admin-suspended / unpaid).
// SUSPENDED and HIDDEN return 404 to everyone, owner included on the public routes.
const isServable = (c) => c && c.status === 'ACTIVE';

// The 3-layer ban + private-whitelist gate for a community catalog. Bans (site policy,
// owner policy, the catalog's own bans) apply even to a PUBLIC catalog; the whitelist
// only gates PRIVATE ones (or a site-wide whitelistOnly mode). Returns null when allowed,
// else { code, error }.
function catalogGate(catalog, identity, globalPolicy, ownerPolicy, key) {
  const acc = catalog.access || {};
  if (policyBans(globalPolicy, identity) || policyBans(ownerPolicy, identity) || accessListMatches(acc.bans, identity)) {
    return { code: 403, error: 'banned' };
  }
  if (globalPolicy.whitelistOnly && !policyWhitelist(globalPolicy, identity) && !policyWhitelist(ownerPolicy, identity)) {
    return { code: 403, error: 'not_whitelisted' };
  }
  if (catalog.visibility === 'private') {
    const shareOk = !!(key && catalog.shareKey && key === catalog.shareKey);
    if (!shareOk && !accessListMatches(acc, identity)) return { code: 403, error: 'not_whitelisted' };
  }
  return null;
}

// Emit a BMM-native feed for the requested kind from a managed catalog's items.
function emitManagedFeed(catalog, items, kind, priv) {
  const title = catalog.name || 'Community catalog';
  const dl = (it) => it.meta?.download_url || it.meta?.downloadUrl
    || (it.payloadKey ? `${SITE_URL}/api/c/${catalog.slug}/items/${it.slug}/dl${priv && catalog.shareKey ? `?k=${catalog.shareKey}` : ''}` : '');
  const rows = items.filter((it) => it.kind === kind);
  if (kind === 'PLUGIN') {
    return { version: '1.0', name: title, plugins: rows.map((it) => ({
      id: it.slug, name: it.name, version: it.version, author: catalog.owner?.displayName || '', description: it.description || '',
      game: it.meta?.game || '', official: false, download_url: dl(it), tags: it.tags || [], icon_url: it.meta?.icon_url || it.meta?.thumb || null,
    })).filter((x) => x.download_url) };
  }
  if (kind === 'THEME') {
    return { version: '1.0', name: title, themes: rows.map((it) => ({
      id: it.slug, name: it.name, description: it.description || '', author: catalog.owner?.displayName || '', version: it.version, url: dl(it), tags: it.tags || [],
    })).filter((x) => x.url) };
  }
  return { version: '1.0', name: title, description: catalog.description || '', apps: rows.map((it) => ({
    id: it.slug, title: it.name, description: it.description || '', md_link: it.meta?.md_link || null,
    category: it.meta?.category || 'other', price: it.meta?.price || 'free', tags: it.tags || [], version: it.version, requirements: it.meta?.requirements || null,
    images: it.meta?.images || (it.meta?.thumb ? { thumb: it.meta.thumb } : undefined),
    download: { url: dl(it), file_type: it.meta?.file_type || 'exe', size: it.meta?.size || it.payloadSize || undefined, sha256: it.meta?.sha256 || undefined },
  })).filter((x) => x.download.url) };
}

// Raw catalogs: the owner uploaded a whole BMM-native feed. Serve it verbatim (already
// validated on save), narrowed to the requested kind's top-level array when possible.
function emitRawFeed(catalog, kind) {
  const raw = catalog.rawJson || {};
  const key = kind === 'PLUGIN' ? 'plugins' : kind === 'THEME' ? 'themes' : 'apps';
  return { version: raw.version || '1.0', name: raw.name || catalog.name, [key]: Array.isArray(raw[key]) ? raw[key] : [] };
}

// zod for a raw feed upload — accept the 3 BMM shapes, tolerant of extra fields.
const rawFeedSchema = z.object({
  version: z.string().max(16).optional(),
  name: z.string().max(120).optional(),
  plugins: z.array(z.record(z.any())).max(2000).optional(),
  themes: z.array(z.record(z.any())).max(2000).optional(),
  apps: z.array(z.record(z.any())).max(2000).optional(),
}).passthrough();

// Access config the owner can set: whitelist (ips/keys/accounts) + a bans sub-object.
// Email / BC id / username are resolved to a bcweb account BEFORE reaching here.
const acctEntry = z.object({ type: z.enum(['bcweb', 'discord', 'creator']), id: z.string().min(1).max(120), label: z.string().max(120).optional() });
const accessList = z.object({ ips: z.array(z.string().max(64)).max(500).optional(), keys: z.array(z.string().max(120)).max(500).optional(), accounts: z.array(acctEntry).max(500).optional() });
const accessSchema = accessList.extend({ bans: accessList.optional() });

const ser = (c) => ({
  id: c.id, name: c.name, slug: c.slug, description: c.description, kinds: c.kinds, mode: c.mode,
  status: c.status, visibility: c.visibility, listed: c.listed, shareKey: c.shareKey,
  groupId: c.groupId, storageQuotaBytes: Number(c.storageQuotaBytes || 0n), storageUsedBytes: Number(c.storageUsedBytes || 0n),
  views: c.views, downloads: c.downloads, itemCount: c._count?.items, createdAt: c.createdAt, updatedAt: c.updatedAt,
});

export default async function communityCatalogRoutes(app) {
  // ── Public: browse listed community catalogs ──
  app.get('/c', async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const where = { status: 'ACTIVE', listed: true, visibility: 'public' };
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }];
    const rows = await p.communityCatalog.findMany({
      where, orderBy: [{ featuredUntil: 'desc' }, { downloads: 'desc' }], take: 60,
      include: { owner: { select: { displayName: true } }, _count: { select: { items: true } } },
    });
    return { catalogs: rows.map((c) => ({ ...ser(c), owner: c.owner?.displayName })) };
  });

  // ── Public: a community catalog's metadata (for its /c/:slug page) ──
  app.get('/c/:slug', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { slug: req.params.slug }, include: { owner: { select: { displayName: true } }, items: { select: { kind: true } }, _count: { select: { items: true } } } });
    if (!isServable(c)) return reply.code(404).send({ error: 'not_found' });
    const [globalPolicy, ownerPolicy, identity] = await Promise.all([
      getGlobalAccessPolicy(p), getUserAccessPolicy(p, c.ownerId), resolveClientIdentity(p, req),
    ]);
    const denied = catalogGate(c, identity, globalPolicy, ownerPolicy, req.query?.k);
    if (denied) return reply.code(denied.code).send({ error: denied.error });
    // Which kinds this catalog actually serves (config union with what items carry).
    const raw = c.rawJson || {};
    const present = new Set(c.mode === 'raw'
      ? [...(raw.plugins?.length ? ['PLUGIN'] : []), ...(raw.themes?.length ? ['THEME'] : []), ...(raw.apps?.length ? ['APP'] : [])]
      : c.items.map((i) => i.kind));
    for (const k of c.kinds || []) present.add(k.toUpperCase());
    return { catalog: {
      ...ser(c), owner: c.owner?.displayName, ownerId: c.ownerId, ownerBcId: userBcId(c.ownerId), kindsPresent: [...present],
      private: c.visibility === 'private', keySuffix: c.visibility === 'private' && req.query?.k ? `?k=${encodeURIComponent(String(req.query.k))}` : '',
    } };
  });

  // ── Public: the gated BMM-native feed for a community catalog ──
  // ?kind=app|plugin|theme (default = the catalog's first kind, else app).
  app.get('/c/:slug/catalog.json', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { slug: req.params.slug }, include: { owner: { select: { displayName: true } }, items: true } });
    if (!isServable(c)) return reply.code(404).send({ error: 'not_found' });
    const [globalPolicy, ownerPolicy, identity] = await Promise.all([
      getGlobalAccessPolicy(p), getUserAccessPolicy(p, c.ownerId), resolveClientIdentity(p, req),
    ]);
    const denied = catalogGate(c, identity, globalPolicy, ownerPolicy, req.query?.k);
    if (denied) return reply.code(denied.code).send({ error: denied.error });

    const reqKind = String(req.query?.kind || (c.kinds?.[0] || 'app')).toUpperCase();
    const kind = KINDS.includes(reqKind) ? reqKind : 'APP';
    const priv = c.visibility === 'private';
    reply.header('Cache-Control', priv || c.access?.bans ? 'private, no-store' : 'public, max-age=300');
    // Count a public feed hit as a view (not for private share-link traffic).
    if (!priv) p.communityCatalog.update({ where: { id: c.id }, data: { views: { increment: 1 } } }).catch(() => {});
    return c.mode === 'raw' ? emitRawFeed(c, kind) : emitManagedFeed(c, c.items, kind, priv);
  });

  // ── Public: gated per-item download (managed catalogs) ──
  app.get('/c/:slug/items/:islug/dl', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { slug: req.params.slug }, include: { items: { where: { slug: req.params.islug } } } });
    if (!isServable(c)) return reply.code(404).send({ error: 'not_found' });
    const [globalPolicy, ownerPolicy, identity] = await Promise.all([
      getGlobalAccessPolicy(p), getUserAccessPolicy(p, c.ownerId), resolveClientIdentity(p, req),
    ]);
    const denied = catalogGate(c, identity, globalPolicy, ownerPolicy, req.query?.k);
    if (denied) return reply.code(denied.code).send({ error: denied.error });
    const it = c.items[0];
    if (!it?.payloadKey) return reply.code(404).send({ error: 'no_payload' });
    p.communityCatalog.update({ where: { id: c.id }, data: { downloads: { increment: 1 } } }).catch(() => {});
    p.communityCatalogItem.update({ where: { id: it.id }, data: { downloads: { increment: 1 } } }).catch(() => {});
    return reply.redirect(await presignGet(it.payloadKey));
  });

  // ── Owner: my catalogs ──
  app.get('/me/catalogs', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.communityCatalog.findMany({ where: { ownerId: req.user.uid }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { items: true } } } });
    return { catalogs: rows.map(ser) };
  });

  app.get('/me/catalogs/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id }, include: { items: true, _count: { select: { items: true } } } });
    if (!c || (c.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role))) return reply.code(404).send({ error: 'not_found' });
    return { catalog: { ...ser(c), access: c.access || {}, rawJson: c.rawJson || null, items: c.items } };
  });

  // Create a catalog. mode "raw" is free (self-hosted downloads); "managed" attaches to
  // one of the owner's existing storage pools (groupId) — full checkout wiring is B2/P5.
  app.post('/me/catalogs', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(2).max(80),
      description: z.string().max(2000).optional().default(''),
      mode: z.enum(['managed', 'raw']).default('managed'),
      kinds: z.array(z.enum(['app', 'plugin', 'theme', 'preset'])).max(4).optional().default([]),
      visibility: z.enum(['public', 'private']).default('public'),
      groupId: z.string().optional(),
      storageGB: z.number().min(0.5).max(2000).optional().default(1),
      rawJson: rawFeedSchema.optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Hosting a catalog requires a linked BMM identity (creator id) — it's what gates
    // private access and identifies the author beyond an email. Staff are exempt.
    if (!['ADMIN', 'SUPERADMIN'].includes(req.user.role)) {
      const linked = await p.creatorLink.count({ where: { userId: req.user.uid } });
      if (!linked) return reply.code(403).send({ error: 'creator_link_required' });
    }
    if (b.data.mode === 'raw' && !b.data.rawJson) return reply.code(400).send({ error: 'raw_needs_json' });
    // A managed catalog reserves a slice of a pool the owner controls (fungible with
    // repos — the same poolBytes). The slice is checked against the pool's free space.
    let groupId = null, quotaBytes = 0n;
    if (b.data.mode === 'managed') {
      if (!b.data.groupId) return reply.code(400).send({ error: 'managed_needs_pool' });
      const group = await p.hostingGroup.findUnique({ where: { id: b.data.groupId } });
      if (!group || group.ownerId !== req.user.uid) return reply.code(403).send({ error: 'not_your_pool' });
      quotaBytes = BigInt(Math.round(b.data.storageGB * GiB));
      const free = await poolFreeBytes(p, group);
      if (quotaBytes > free) return reply.code(409).send({ error: 'pool_exceeded', freeGB: Number(free) / GiB });
      groupId = group.id;
    }
    const base = slugify(b.data.name).slice(0, 60) || 'catalog';
    let slug = base; for (let i = 2; await p.communityCatalog.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    const c = await p.communityCatalog.create({ data: {
      ownerId: req.user.uid, name: b.data.name, slug, description: b.data.description,
      mode: b.data.mode, kinds: b.data.kinds, visibility: b.data.visibility,
      listed: b.data.visibility === 'public', groupId, storageQuotaBytes: quotaBytes,
      freePlan: b.data.mode === 'raw',
      shareKey: crypto.randomBytes(12).toString('base64url'),
      rawJson: b.data.mode === 'raw' ? b.data.rawJson : undefined,
    } });
    return reply.code(201).send({ catalog: ser(c), slug: c.slug });
  });

  // Update meta, visibility, access lists, listing, or the raw feed.
  app.patch('/me/catalogs/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(2).max(80).optional(),
      description: z.string().max(2000).optional(),
      kinds: z.array(z.enum(['app', 'plugin', 'theme', 'preset'])).max(4).optional(),
      visibility: z.enum(['public', 'private']).optional(),
      listed: z.boolean().optional(),
      access: accessSchema.optional(),
      rawJson: rawFeedSchema.optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id } });
    if (!c || (c.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role))) return reply.code(404).send({ error: 'not_found' });
    const data = { ...b.data };
    // A private catalog is never publicly listed, whatever `listed` said.
    if (data.visibility === 'private') data.listed = false;
    if (data.rawJson && c.mode !== 'raw') delete data.rawJson;
    await p.communityCatalog.update({ where: { id: c.id }, data });
    return { ok: true };
  });

  // Rotate the private share link.
  app.post('/me/catalogs/:id/rotate-key', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id } });
    if (!c || c.ownerId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    const shareKey = crypto.randomBytes(12).toString('base64url');
    await p.communityCatalog.update({ where: { id: c.id }, data: { shareKey } });
    return { shareKey };
  });

  app.delete('/me/catalogs/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id }, include: { items: { select: { payloadKey: true } } } });
    if (!c || (c.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role))) return reply.code(404).send({ error: 'not_found' });
    // Delete now (no grace) — a catalog holds no paid subscription of its own; its pool
    // space frees immediately. Best-effort payload purge, then the row (items cascade).
    for (const it of c.items) { if (it.payloadKey) await deleteObject(it.payloadKey).catch(() => {}); }
    await p.communityCatalog.delete({ where: { id: c.id } });
    return { ok: true };
  });

  // ── Owner: items in a MANAGED catalog ──
  app.post('/me/catalogs/:id/items', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(['APP', 'PLUGIN', 'THEME', 'PRESET']),
      name: z.string().trim().min(1).max(120),
      version: z.string().max(24).optional().default('1.0.0'),
      description: z.string().max(4000).optional().default(''),
      tags: z.array(z.string().max(40)).max(20).optional().default([]),
      payloadKey: z.string().optional(),
      payloadSize: z.number().int().nonnegative().optional().default(0),
      meta: z.record(z.any()).optional().default({}),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id } });
    if (!c || c.ownerId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (c.mode !== 'managed') return reply.code(400).send({ error: 'not_managed' });
    // Defence in depth: a payloadKey must be one the caller themselves uploaded (presign
    // returns `uploads/<uid>/…`), never an arbitrary object key pointing at someone else's
    // upload — otherwise the gated /dl route could presign+serve another user's object.
    if (b.data.payloadKey && !b.data.payloadKey.startsWith(`uploads/${req.user.uid}/`)) return reply.code(400).send({ error: 'invalid_payload_key' });
    // A payload draws from the catalog's reserved quota (which itself came from the pool).
    const addBytes = b.data.payloadKey ? BigInt(b.data.payloadSize || 0) : 0n;
    if (addBytes > 0n && c.storageUsedBytes + addBytes > c.storageQuotaBytes) {
      return reply.code(409).send({ error: 'catalog_full', freeMB: Number(c.storageQuotaBytes - c.storageUsedBytes) / (1024 * 1024) });
    }
    const base = slugify(b.data.name).slice(0, 60) || 'item';
    let slug = base; for (let i = 2; await p.communityCatalogItem.findFirst({ where: { catalogId: c.id, slug } }); i++) slug = `${base}-${i}`;
    const item = await p.communityCatalogItem.create({ data: { catalogId: c.id, kind: b.data.kind, name: b.data.name, slug, version: b.data.version, description: b.data.description, tags: b.data.tags, payloadKey: b.data.payloadKey, payloadSize: b.data.payloadSize, meta: b.data.meta } });
    if (addBytes > 0n) await p.communityCatalog.update({ where: { id: c.id }, data: { storageUsedBytes: { increment: addBytes } } });
    return reply.code(201).send({ item });
  });

  app.patch('/me/catalogs/:id/items/:iid', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      version: z.string().max(24).optional(),
      description: z.string().max(4000).optional(),
      tags: z.array(z.string().max(40)).max(20).optional(),
      payloadKey: z.string().optional(),
      payloadSize: z.number().int().nonnegative().optional(),
      meta: z.record(z.any()).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id } });
    if (!c || c.ownerId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    const item = await p.communityCatalogItem.findUnique({ where: { id: req.params.iid } });
    if (!item || item.catalogId !== c.id) return reply.code(404).send({ error: 'not_found' });
    if (b.data.payloadKey && !b.data.payloadKey.startsWith(`uploads/${req.user.uid}/`)) return reply.code(400).send({ error: 'invalid_payload_key' });
    // If the payload size changed (a re-upload), re-check + adjust the catalog's usage.
    if (b.data.payloadSize != null && b.data.payloadSize !== item.payloadSize) {
      const delta = BigInt(b.data.payloadSize) - BigInt(item.payloadSize || 0);
      if (delta > 0n && c.storageUsedBytes + delta > c.storageQuotaBytes) return reply.code(409).send({ error: 'catalog_full', freeMB: Number(c.storageQuotaBytes - c.storageUsedBytes) / (1024 * 1024) });
      await p.communityCatalog.update({ where: { id: c.id }, data: { storageUsedBytes: { increment: delta } } });
    }
    await p.communityCatalogItem.update({ where: { id: item.id }, data: b.data });
    return { ok: true };
  });

  app.delete('/me/catalogs/:id/items/:iid', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id } });
    if (!c || c.ownerId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    const item = await p.communityCatalogItem.findUnique({ where: { id: req.params.iid } });
    if (!item || item.catalogId !== c.id) return reply.code(404).send({ error: 'not_found' });
    await p.communityCatalogItem.delete({ where: { id: item.id } });
    // Return the item's bytes to the catalog's (and thus the pool's) free space.
    if (item.payloadKey && item.payloadSize > 0) {
      await p.communityCatalog.update({ where: { id: c.id }, data: { storageUsedBytes: { decrement: BigInt(item.payloadSize) } } }).catch(() => {});
    }
    return { ok: true };
  });

  // ── Admin/mod: moderate community catalogs (cap: manage_catalogs) ──
  app.get('/admin/catalogs', { preHandler: requireCap('manage_catalogs', 'MOD') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const where = q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {};
    const rows = await p.communityCatalog.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
      include: {
        owner: { select: { id: true, displayName: true, email: true, role: true, creatorLinks: { select: { creatorId: true, displayName: true } } } },
        _count: { select: { items: true } },
      },
    });
    return { catalogs: rows.map((c) => ({
      ...ser(c),
      views: c.views, downloads: c.downloads,
      owner: c.owner?.displayName, email: c.owner?.email, ownerId: c.owner?.id, ownerRole: c.owner?.role,
      // Who really posted it: the linked BMM creator id(s), not just an email.
      creators: (c.owner?.creatorLinks || []).map((l) => ({ id: l.creatorId, name: l.displayName })),
    })) };
  });

  // Suspend (offline for everyone, owner notified), unsuspend (back online), unlist/relist,
  // or hard-delete (payloads purged, pool space freed — irreversible).
  app.post('/admin/catalogs/:id/:action', { preHandler: requireCap('manage_catalogs') }, async (req, reply) => {
    const action = req.params.action;
    if (!['suspend', 'unsuspend', 'unlist', 'relist', 'delete'].includes(action)) return reply.code(400).send({ error: 'bad_action' });
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id }, include: action === 'delete' ? { items: { select: { payloadKey: true } } } : undefined });
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (action === 'delete') {
      for (const it of c.items) if (it.payloadKey) await deleteObject(it.payloadKey).catch(() => {});
      await p.communityCatalog.delete({ where: { id: c.id } });
      await notify(p, c.ownerId, 'catalog_deleted', `Your catalog "${c.name}" was removed by a moderator.`).catch(() => {});
      return { ok: true, deleted: true };
    }
    const data = action === 'suspend' ? { status: 'SUSPENDED', listed: false }
      : action === 'unsuspend' ? { status: 'ACTIVE' }
      : action === 'unlist' ? { listed: false }
      : { listed: c.visibility === 'public' }; // relist (only if public)
    await p.communityCatalog.update({ where: { id: c.id }, data });
    if (action === 'suspend') await notify(p, c.ownerId, 'catalog_suspended', `Your catalog "${c.name}" was suspended by a moderator.`);
    return { ok: true };
  });

  // Admin review: list a catalog's items with payload info (which are examinable/downloadable).
  app.get('/admin/catalogs/:id/items', { preHandler: requireCap('manage_catalogs', 'MOD') }, async (req, reply) => {
    const p = await db();
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id }, include: { items: { orderBy: { createdAt: 'desc' } } } });
    if (!c) return reply.code(404).send({ error: 'not_found' });
    return { name: c.name, mode: c.mode, items: c.items.map((it) => ({
      id: it.id, kind: it.kind, name: it.name, slug: it.slug, version: it.version,
      payloadKey: it.payloadKey, payloadSize: it.payloadSize, downloads: it.downloads,
      downloadUrl: it.payloadKey ? null : (it.meta?.download_url || null),
    })) };
  });

  // Admin review: examine a hosted item's payload WITHOUT downloading. Lists the zip
  // entries (for a .bmmplug/.bmmtheme) with an inline text preview of readable files, or
  // returns the whole text for a plain json/css/text payload. Files are never executed.
  app.get('/admin/catalogs/:id/items/:itemId/inspect', { preHandler: requireCap('manage_catalogs', 'MOD') }, async (req, reply) => {
    const p = await db();
    const it = await p.communityCatalogItem.findFirst({ where: { id: req.params.itemId, catalogId: req.params.id } });
    if (!it) return reply.code(404).send({ error: 'not_found' });
    if (!it.payloadKey) return reply.code(404).send({ error: 'no_payload', downloadUrl: it.meta?.download_url || null });
    try {
      const buf = await readObject(it.payloadKey);
      const zipFiles = await zipReadAll(buf).catch(() => null); // off-thread parse; null if not a zip
      if (zipFiles && zipFiles.length) {
        const entries = zipFiles.map((e) => {
          const data = Buffer.from(e.data);
          const isText = TEXT_EXT.test(e.name) && data.length <= TEXT_PREVIEW_MAX;
          let text = null;
          if (isText) { try { text = data.toString('utf-8'); } catch { text = null; } }
          return { name: e.name, size: data.length, text };
        });
        return { type: 'zip', size: buf.length, entries };
      }
      const isText = TEXT_EXT.test(it.payloadKey) || buf.length <= TEXT_PREVIEW_MAX;
      return { type: 'file', size: buf.length, name: it.payloadKey.split('/').pop(), text: isText ? buf.slice(0, TEXT_PREVIEW_MAX).toString('utf-8') : null };
    } catch (e) { return reply.code(502).send({ error: 'read_failed', detail: String(e?.message || e) }); }
  });

  // Admin review: download the whole payload, or a single entry from within a zip payload
  // (?path=…). Never executed — served as an attachment.
  app.get('/admin/catalogs/:id/items/:itemId/download', { preHandler: requireCap('manage_catalogs', 'MOD') }, async (req, reply) => {
    const p = await db();
    const it = await p.communityCatalogItem.findFirst({ where: { id: req.params.itemId, catalogId: req.params.id } });
    if (!it?.payloadKey) return reply.code(404).send({ error: 'no_payload' });
    const path = String(req.query?.path || '');
    if (!path) return reply.redirect(await presignGet(it.payloadKey)); // whole file
    try {
      const buf = await readObject(it.payloadKey);
      const data = await zipEntry(buf, path); // off-thread single-entry extract
      if (!data) return reply.code(404).send({ error: 'file_not_found' });
      const name = (path.split('/').pop() || 'file').replace(/[^\w.\-]/g, '_');
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      reply.header('Cache-Control', 'no-store');
      return reply.send(Buffer.from(data));
    } catch (e) { return reply.code(502).send({ error: 'read_failed', detail: String(e?.message || e) }); }
  });
}
