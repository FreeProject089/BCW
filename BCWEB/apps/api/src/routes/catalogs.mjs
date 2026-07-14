import { z } from 'zod';
import crypto from 'node:crypto';
import {
  db, requireRole, optionalAuth, slugify, notify,
  resolveClientIdentity, accessListMatches, policyBans, policyWhitelist,
  getGlobalAccessPolicy, getUserAccessPolicy,
} from '../lib/lib.mjs';
import { presignGet } from '../lib/storage.mjs';

const KINDS = ['APP', 'PLUGIN', 'THEME', 'PRESET'];
const SITE_URL = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');

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
      rawJson: rawFeedSchema.optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    if (b.data.mode === 'raw' && !b.data.rawJson) return reply.code(400).send({ error: 'raw_needs_json' });
    // A managed catalog must land in a pool the owner controls (fungible with repos).
    let groupId = null;
    if (b.data.mode === 'managed') {
      if (!b.data.groupId) return reply.code(400).send({ error: 'managed_needs_pool' });
      const group = await p.hostingGroup.findUnique({ where: { id: b.data.groupId } });
      if (!group || group.ownerId !== req.user.uid) return reply.code(403).send({ error: 'not_your_pool' });
      groupId = group.id;
    }
    const base = slugify(b.data.name).slice(0, 60) || 'catalog';
    let slug = base; for (let i = 2; await p.communityCatalog.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    const c = await p.communityCatalog.create({ data: {
      ownerId: req.user.uid, name: b.data.name, slug, description: b.data.description,
      mode: b.data.mode, kinds: b.data.kinds, visibility: b.data.visibility,
      listed: b.data.visibility === 'public', groupId,
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
    const c = await p.communityCatalog.findUnique({ where: { id: req.params.id } });
    if (!c || (c.ownerId !== req.user.uid && !['ADMIN', 'SUPERADMIN'].includes(req.user.role))) return reply.code(404).send({ error: 'not_found' });
    // 72h delete grace, same as repos (the sweeper purges payloads + the row).
    await p.communityCatalog.update({ where: { id: c.id }, data: { status: 'HIDDEN', listed: false, deleteAt: new Date(Date.now() + 3 * 864e5) } });
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
    const base = slugify(b.data.name).slice(0, 60) || 'item';
    let slug = base; for (let i = 2; await p.communityCatalogItem.findFirst({ where: { catalogId: c.id, slug } }); i++) slug = `${base}-${i}`;
    const item = await p.communityCatalogItem.create({ data: { catalogId: c.id, kind: b.data.kind, name: b.data.name, slug, version: b.data.version, description: b.data.description, tags: b.data.tags, payloadKey: b.data.payloadKey, payloadSize: b.data.payloadSize, meta: b.data.meta } });
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
    return { ok: true };
  });
}
