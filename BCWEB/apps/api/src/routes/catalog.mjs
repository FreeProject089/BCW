import { z } from 'zod';
import AdmZip from 'adm-zip';
import { db, requireRole, slugify, notify, hasFreeTierClaim, recordFreeTierClaim } from '../lib.mjs';
import { presignGet, getObject } from '../storage.mjs';
import { validatePlugin, fetchPluginBytes } from '../plugin.mjs';
import { powVerify } from './auth.mjs';

const KINDS = ['APP', 'PLUGIN', 'THEME', 'PRESET'];

// Re-validation (checksum/package verification, see revalidatePlugin below) can
// mark a PUBLISHED item as failed (e.g. a self-hosted download URL now serves a
// tampered/corrupt file) without un-publishing it outright — moderators still
// need to see it to fix or reject. But it must not appear as a normal, trusted
// download to the public. `meta.validation` is only ever set for kinds that get
// re-checked (currently PLUGIN); items with no validation recorded are treated
// as valid (nothing to invalidate them).
const NOT_INVALID = { NOT: { meta: { path: ['validation', 'valid'], equals: false } } };
const isInvalid = (item) => item?.meta?.validation?.valid === false;

// Storage for an our-hosted catalog file is billed by size (monthly). Admins host for
// free (they use /admin/catalog). The per-MB price is an admin-tunable knob; when it's
// 0 (default), hosting is free. The download link is auto-configured (payloadKey), so
// the author never sets a URL for our-hosted files.
let _stripe = null;
async function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) { const Stripe = (await import('stripe')).default; _stripe = new Stripe(process.env.STRIPE_SECRET_KEY); }
  return _stripe;
}
async function settings(p) { return Object.fromEntries((await p.adminSetting.findMany()).map((r) => [r.key, r.value])); }
// The first `catalogFreeMB` of ANY submission (any kind — app/plugin/theme/preset)
// are free; only the bytes ABOVE that threshold are billed. Previously every byte
// was billed (Math.ceil rounded even a 1 KB file up to a full paid MB) — there was
// no free tier at all for small, ordinary submissions.
function catalogHostCents(bytes, s) {
  const perMB = Number(s['pricing.catalogHostPerMBCents'] ?? 0);
  const freeMB = Number(s['pricing.catalogFreeMB'] ?? 25);
  const billableBytes = Math.max(0, (bytes || 0) - freeMB * 1024 * 1024);
  return Math.round(Math.ceil(billableBytes / (1024 * 1024)) * perMB);
}

// Free-tier pool for catalog hosting — total payload bytes currently held by
// items that were never billed (no _hostingSubId in meta — see stripe-webhook.mjs).
// Mirrors hosting.mjs's freeTierCapGB for repos; capped independently so the free
// catalog tier itself can go "sold out" without touching the paid capacity math.
async function catalogFreeTierStatus(p, s) {
  const capEnabled = !!s['catalog.freeTierCapEnabled'];
  const capMB = Number(s['catalog.freeTierCapMB'] ?? 2000);
  if (!capEnabled) return { capEnabled, capMB, usedMB: 0, freeMB: null };
  const items = await p.catalogItem.findMany({ where: { payloadKey: { not: null }, status: { in: ['PENDING', 'PUBLISHED'] } }, select: { payloadSize: true, meta: true } });
  const usedBytes = items.filter((it) => !it.meta?._hostingSubId).reduce((a, it) => a + (it.payloadSize || 0), 0);
  const usedMB = usedBytes / (1024 * 1024);
  return { capEnabled, capMB, usedMB, freeMB: Math.max(0, capMB - usedMB) };
}

// Download a plugin's .bmmplug (our-hosted key or a self-hosted URL), verify the
// package + per-file checksums, and store the result in meta.validation.
async function revalidatePlugin(p, item) {
  const meta = item.meta || {};
  try {
    const buf = await fetchPluginBytes({ url: meta.download_url, key: item.payloadKey, getObject });
    const res = validatePlugin(buf, meta.sha256);
    const validation = { valid: res.valid, reason: res.reason, sha256: res.sha256, files: res.files, checkedAt: res.checkedAt, manifestId: res.manifest?.id };
    await p.catalogItem.update({ where: { id: item.id }, data: { meta: { ...meta, sha256: res.sha256, validation } } });
    return { ...res, validation };
  } catch (e) {
    const validation = { valid: false, reason: String(e?.message || e), checkedAt: new Date().toISOString() };
    await p.catalogItem.update({ where: { id: item.id }, data: { meta: { ...meta, validation } } }).catch(() => {});
    return { valid: false, ...validation };
  }
}

// BSM preset shape — the metadata is always carried inside the preset itself.
// passthrough() tolerates extra fields the format may grow.
const presetSchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().regex(/^#?[0-9a-fA-F]{3,8}$/).optional(),
  version: z.string().max(24),
  UpdateNumber: z.number().optional(),
  date: z.string().max(40).optional(),
  assetPaths: z.array(z.string().max(300)).max(10000),
}).passthrough();

const submitSchema = z.object({
  projectKey: z.enum(['bmm', 'bsm', 'community']),
  kind: z.enum(['APP', 'PLUGIN', 'THEME', 'PRESET']),
  name: z.string().min(2).max(80),
  description: z.string().max(4000).default(''),
  tags: z.array(z.string().max(24)).max(12).default([]),
  version: z.string().max(24).default('1.0.0'),
  payloadKey: z.string().max(256).optional(), // S3 key uploaded via presigned URL
  payloadSize: z.number().int().nonnegative().optional(), // bytes (for size-based hosting price)
  meta: z.record(z.any()).default({}),         // preset JSON / plugin manifest
});

export default async function catalogRoutes(app) {
  const selectCard = { id: true, slug: true, kind: true, name: true, description: true, tags: true, version: true, updatedAt: true, createdAt: true, meta: true, views: true, downloads: true, owner: { select: { displayName: true } } };

  // ── Public browse (PUBLISHED only) ──
  // sort: recent (default) · popular (all-time downloads) · month (downloads this
  // month) · views (all-time views).
  app.get('/catalog', async (req) => {
    const p = await db();
    const { project, kind, q, sort = 'recent', take = '60', skip = '0' } = req.query || {};
    const where = { status: 'PUBLISHED', ...NOT_INVALID };
    if (project) where.project = { key: project };
    if (kind && KINDS.includes(kind)) where.kind = kind;
    if (q) where.OR = [{ name: { contains: String(q), mode: 'insensitive' } }, { description: { contains: String(q), mode: 'insensitive' } }];
    const limit = Math.min(Number(take) || 60, 100);

    if (sort === 'month') {
      // Rank by download events in the last 30 days, then hydrate the items.
      const since = new Date(Date.now() - 30 * 864e5);
      const top = await p.catalogEvent.groupBy({ by: ['itemId'], where: { kind: 'download', createdAt: { gte: since } }, _count: { itemId: true }, orderBy: { _count: { itemId: 'desc' } }, take: 100 });
      const ids = top.map((t) => t.itemId);
      const items = await p.catalogItem.findMany({ where: { ...where, id: { in: ids } }, select: selectCard });
      const rank = Object.fromEntries(top.map((t) => [t.itemId, t._count.itemId]));
      items.sort((a, b) => (rank[b.id] || 0) - (rank[a.id] || 0));
      return { items: items.slice(0, limit).map((it) => ({ ...it, monthDownloads: rank[it.id] || 0 })) };
    }
    const orderBy = sort === 'popular' ? { downloads: 'desc' } : sort === 'views' ? { views: 'desc' } : { updatedAt: 'desc' };
    const items = await p.catalogItem.findMany({ where, orderBy, take: limit, skip: Number(skip) || 0, select: selectCard });
    return { items };
  });

  app.get('/catalog/:slug', async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { slug: req.params.slug }, include: { owner: { select: { displayName: true } } } });
    if (!item || item.status !== 'PUBLISHED' || isInvalid(item)) return reply.code(404).send({ error: 'not_found' });
    // Count a view: one fetch of the item = one view.
    p.catalogItem.update({ where: { id: item.id }, data: { views: { increment: 1 } } }).catch(() => {});
    p.catalogEvent.create({ data: { itemId: item.id, kind: 'view' } }).catch(() => {});
    return { item: { ...item, views: item.views + 1 } };
  });

  async function countDownload(p, item) {
    await p.catalogItem.update({ where: { id: item.id }, data: { downloads: { increment: 1 } } }).catch(() => {});
    await p.catalogEvent.create({ data: { itemId: item.id, kind: 'download' } }).catch(() => {});
  }

  // ── Download: short-lived pre-signed GET for a published payload ──
  app.get('/catalog/:slug/download', async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { slug: req.params.slug } });
    if (!item || item.status !== 'PUBLISHED' || isInvalid(item)) return reply.code(404).send({ error: 'not_found' });
    if (!item.payloadKey) return reply.code(404).send({ error: 'no_payload' });
    await countDownload(p, item);
    return { url: await presignGet(item.payloadKey) };
  });

  // ── Batch download (multi-select, e.g. several BSM presets) ──
  app.post('/catalog/downloads', async (req, reply) => {
    const b = z.object({ slugs: z.array(z.string().max(120)).min(1).max(50) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const items = await p.catalogItem.findMany({ where: { slug: { in: b.data.slugs }, status: 'PUBLISHED', payloadKey: { not: null }, ...NOT_INVALID } });
    const out = [];
    for (const item of items) { await countDownload(p, item); out.push({ slug: item.slug, name: item.name, url: await presignGet(item.payloadKey) }); }
    return { files: out };
  });

  // Stable download link for an uploaded payload (302 → fresh presigned GET), so the
  // catalog.json feed can hand BMM a permanent URL instead of an expiring presigned one.
  app.get('/catalog/:slug/dl', async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { slug: req.params.slug } });
    if (!item || item.status !== 'PUBLISHED' || !item.payloadKey || isInvalid(item)) return reply.code(404).send({ error: 'not_found' });
    await countDownload(p, item);
    return reply.redirect(await presignGet(item.payloadKey));
  });

  // ── Per-item catalog.json: a single-item BMM-native catalog, so each app/plugin/
  // theme can be imported INDIVIDUALLY as a source in BMM (no global bundle needed).
  app.get('/catalog/:slug/catalog.json', async (req, reply) => {
    const p = await db();
    const origin = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
    const it = await p.catalogItem.findUnique({ where: { slug: req.params.slug }, include: { owner: { select: { displayName: true } } } });
    if (!it || it.status !== 'PUBLISHED' || !['APP', 'PLUGIN', 'THEME'].includes(it.kind) || isInvalid(it)) return reply.code(404).send({ error: 'not_found' });
    const dl = it.meta?.download_url || it.meta?.downloadUrl || (it.payloadKey ? `${origin}/api/catalog/${it.slug}/dl` : null);
    if (!dl) return reply.code(404).send({ error: 'no_payload' });
    reply.header('Cache-Control', 'public, max-age=300');
    if (it.kind === 'PLUGIN') {
      return { version: '1.0', name: it.name, plugins: [{ id: it.slug, name: it.name, version: it.version, author: it.owner?.displayName || '', description: it.description || '', game: it.meta?.game || '', official: false, download_url: dl, tags: it.tags || [], icon_url: it.meta?.icon_url || it.meta?.thumb || null }] };
    }
    if (it.kind === 'THEME') {
      return { version: '1.0', name: it.name, themes: [{ id: it.slug, name: it.name, description: it.description || '', author: it.owner?.displayName || '', version: it.version, url: dl, tags: it.tags || [] }] };
    }
    return { version: '1.0', name: it.name, description: it.description || '', apps: [{
      id: it.slug, title: it.name, description: it.description || '', md_link: it.meta?.md_link || null,
      category: it.meta?.category || 'other', price: it.meta?.price || 'free', tags: it.tags || [], version: it.version, requirements: it.meta?.requirements || null,
      images: it.meta?.images || (it.meta?.thumb ? { thumb: it.meta.thumb } : undefined),
      download: { url: dl, file_type: it.meta?.file_type || it.meta?.download?.file_type || 'exe', size: it.meta?.size || it.payloadSize || undefined, sha256: it.meta?.sha256 || undefined },
    }] };
  });

  // ── Public catalog.json feed (BMM-consumable, like repos.json) ──
  // ?project=bmm|bsm|community & ?kind=app|plugin|theme (default app). Emits the matching
  // BMM catalog format so a BMM user can add it as a source (or the official catalog).
  app.get('/catalog.json', async (req, reply) => {
    const p = await db();
    const origin = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
    const projectKey = String(req.query?.project || 'bmm').toLowerCase();
    const reqKind = String(req.query?.kind || 'app').toUpperCase();
    const kind = KINDS.includes(reqKind) ? reqKind : 'APP';
    const project = await p.project.findUnique({ where: { key: projectKey } }).catch(() => null);
    const where = { status: 'PUBLISHED', kind, ...NOT_INVALID };
    if (project) where.projectId = project.id;
    const items = await p.catalogItem.findMany({ where, orderBy: { downloads: 'desc' }, include: { owner: { select: { displayName: true } } } });
    const dlUrl = (it) => it.meta?.download_url || it.meta?.downloadUrl || (it.payloadKey ? `${origin}/api/catalog/${it.slug}/dl` : null);
    reply.header('Cache-Control', 'public, max-age=300');
    const title = `BetterCommunity ${projectKey.toUpperCase()} ${kind.toLowerCase()} catalog`;
    if (kind === 'PLUGIN') {
      return { version: '1.0', name: title, plugins: items.map((it) => ({
        id: it.slug, name: it.name, version: it.version, author: it.owner?.displayName || '', description: it.description || '',
        game: it.meta?.game || '', official: false, download_url: dlUrl(it) || '', tags: it.tags || [], icon_url: it.meta?.icon_url || it.meta?.thumb || null,
      })).filter((x) => x.download_url) };
    }
    if (kind === 'THEME') {
      return { version: '1.0', name: title, themes: items.map((it) => ({
        id: it.slug, name: it.name, description: it.description || '', author: it.owner?.displayName || '', version: it.version, url: dlUrl(it), tags: it.tags || [],
      })).filter((x) => x.url) };
    }
    return { version: '1.0', name: title, description: `Community app catalog from BetterCommunity (${projectKey.toUpperCase()}).`, apps: items.map((it) => ({
      id: it.slug, title: it.name, description: it.description || '', md_link: it.meta?.md_link || null,
      category: it.meta?.category || 'other', price: it.meta?.price || 'free', tags: it.tags || [], version: it.version, requirements: it.meta?.requirements || null,
      images: it.meta?.images || (it.meta?.thumb ? { thumb: it.meta.thumb } : undefined),
      download: { url: dlUrl(it) || '', file_type: it.meta?.file_type || 'exe', size: it.meta?.size || it.payloadSize || undefined, sha256: it.meta?.sha256 || undefined },
    })).filter((x) => x.download.url) };
  });

  // Live hosting price quote for an our-hosted catalog file of a given size.
  app.get('/catalog/hosting-quote', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const bytes = Math.max(0, Number(req.query?.bytes) || 0);
    const s = await settings(p);
    const perMB = Number(s['pricing.catalogHostPerMBCents'] ?? 0);
    return { bytes, perMBCents: perMB, monthlyCents: catalogHostCents(bytes, s), free: perMB <= 0 };
  });

  // ── Submit a NEW item (requires an account) → PENDING + a submission ──
  // Anti-spam: PoW (below) + a rate limit + a cap on PENDING submissions per user,
  // so one account can't flood the moderation queue or the temp storage margin.
  app.post('/catalog', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!powVerify(req.body?.pow)) return reply.code(400).send({ error: 'pow_required' });
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    const d = parsed.data;
    // BSM presets must match the preset schema (validated server-side).
    if (d.kind === 'PRESET') {
      const ok = presetSchema.safeParse(d.meta);
      if (!ok.success) return reply.code(400).send({ error: 'invalid_preset', details: ok.error.flatten() });
    }
    const p = await db();
    if (req.user.role === 'USER') {
      const pending = await p.submission.count({ where: { ownerId: req.user.uid, status: 'PENDING' } });
      if (pending >= 5) return reply.code(429).send({ error: 'too_many_pending', max: 5 });
    }
    const project = await p.project.findUnique({ where: { key: d.projectKey } });
    if (!project) return reply.code(400).send({ error: 'unknown_project' });

    // Our-hosted file → storage is billed by size (unless the per-MB knob is 0, or the
    // submitter is an admin/mod). If a price applies, require a Stripe checkout first;
    // the item is created flagged unpaid and published to moderation once paid.
    const s = await settings(p);
    const hostCents = d.payloadKey && req.user.role === 'USER' ? catalogHostCents(d.payloadSize || 0, s) : 0;
    // Free-tier guards only apply when this specific upload resolves to $0 for a
    // regular user — staff and already-paid uploads never touch either limit.
    if (d.payloadKey && req.user.role === 'USER' && hostCents === 0) {
      const ft = await catalogFreeTierStatus(p, s);
      if (ft.capEnabled && ft.usedMB + (d.payloadSize || 0) / (1024 * 1024) > ft.capMB) return reply.code(409).send({ error: 'free_tier_full', freeMB: ft.freeMB });
      if (await hasFreeTierClaim(p, 'CATALOG', req.user.uid)) return reply.code(409).send({ error: 'free_tier_already_used' });
    }
    const slug = `${d.projectKey}-${slugify(d.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const item = await p.catalogItem.create({
      data: { projectId: project.id, kind: d.kind, ownerId: req.user.uid, name: d.name, slug,
              description: d.description, tags: d.tags, version: d.version, payloadKey: d.payloadKey,
              payloadSize: d.payloadKey ? (d.payloadSize || 0) : 0, // counted against the temp margin
              meta: hostCents > 0 ? { ...d.meta, _hostingUnpaid: true } : d.meta, status: 'PENDING' },
    });
    if (hostCents > 0) {
      const sk = await stripe();
      if (!sk) { await p.catalogItem.delete({ where: { id: item.id } }).catch(() => {}); return reply.code(503).send({ error: 'stripe_not_configured' }); }
      const siteUrl = process.env.SITE_URL || 'http://localhost';
      const session = await sk.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: hostCents, recurring: { interval: 'month' }, product_data: { name: `Hosting — "${d.name}" (${((d.payloadSize || 0) / 1e6).toFixed(1)} MB)` } } }],
        metadata: { type: 'catalog_hosting', itemId: item.id, userId: req.user.uid },
        success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
      });
      return reply.code(201).send({ item, checkoutUrl: session.url, hostingCents: hostCents });
    }
    await p.submission.create({ data: { itemId: item.id, ownerId: req.user.uid, type: 'NEW', status: 'PENDING' } });
    if (d.payloadKey && req.user.role === 'USER') await recordFreeTierClaim(p, 'CATALOG', req.user.uid);
    // Verify the plugin's SHA / per-file checksums server-side, then leave it PENDING
    // for admin validation. The result is returned so the submitter sees it too.
    let validation;
    if (d.kind === 'PLUGIN' && (d.meta?.download_url || d.payloadKey)) {
      const v = await revalidatePlugin(p, item).catch(() => null);
      validation = v?.validation || (v ? { valid: v.valid, reason: v.reason, sha256: v.sha256 } : undefined);
    }
    return reply.code(201).send({ item, validation });
  });

  // ── Admin: create an OFFICIAL catalog item (published instantly, no moderation) ──
  app.post('/admin/catalog', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    const d = parsed.data;
    if (d.kind === 'PRESET') {
      const ok = presetSchema.safeParse(d.meta);
      if (!ok.success) return reply.code(400).send({ error: 'invalid_preset', details: ok.error.flatten() });
    }
    const p = await db();
    const project = await p.project.findUnique({ where: { key: d.projectKey } });
    if (!project) return reply.code(400).send({ error: 'unknown_project' });
    const slug = `${d.projectKey}-${slugify(d.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const item = await p.catalogItem.create({
      data: { projectId: project.id, kind: d.kind, ownerId: req.user.uid, name: d.name, slug,
              description: d.description, tags: d.tags, version: d.version, payloadKey: d.payloadKey,
              meta: { ...d.meta, official: true }, status: 'PUBLISHED' },
    });
    // Plugins are auto-validated (package + per-file checksums) on publish.
    if (d.kind === 'PLUGIN' && (d.meta?.download_url || d.payloadKey)) { const v = await revalidatePlugin(p, item); return reply.code(201).send({ item, validation: v.validation || v }); }
    return reply.code(201).send({ item });
  });

  // ── Admin: catalog list + plugin verification tools ──
  app.get('/admin/catalog', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    const where = {};
    if (req.query?.kind && KINDS.includes(req.query.kind)) where.kind = req.query.kind;
    const items = await p.catalogItem.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200,
      include: { owner: { select: { displayName: true } }, project: { select: { key: true } } } });
    return { items };
  });

  // Re-run plugin validation (download the .bmmplug, verify package + file checksums).
  app.post('/admin/catalog/:id/validate', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.kind !== 'PLUGIN') return reply.code(400).send({ error: 'not_a_plugin' });
    const res = await revalidatePlugin(p, item);
    return { valid: res.valid, reason: res.reason, sha256: res.sha256, files: res.files, manifest: res.manifest };
  });

  // Admin: a short-lived download URL for any catalog item's file (plugin, theme, app)
  // — our-hosted (presigned) or the self-hosted URL. Used by the verification tools.
  app.get('/admin/catalog/:id/file', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.payloadKey) return { url: await presignGet(item.payloadKey), hosted: true };
    const url = item.meta?.download_url || item.meta?.download?.url || item.meta?.url;
    if (url) return { url, hosted: false };
    return reply.code(404).send({ error: 'no_file' });
  });

  // Inspect the unzipped content of a plugin (file list + manifest) + a download link.
  app.get('/admin/catalog/:id/plugin-content', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item || item.kind !== 'PLUGIN') return reply.code(404).send({ error: 'not_found' });
    const meta = item.meta || {};
    try {
      const buf = await fetchPluginBytes({ url: meta.download_url, key: item.payloadKey, getObject });
      const res = validatePlugin(buf, meta.sha256);
      const url = item.payloadKey ? await presignGet(item.payloadKey) : meta.download_url;
      return { valid: res.valid, reason: res.reason, sha256: res.sha256, size: buf.length, files: res.files, manifest: res.manifest, downloadUrl: url };
    } catch (e) { return reply.code(502).send({ error: 'fetch_failed', detail: String(e?.message || e) }); }
  });

  // Admin: download a single extracted file from a plugin's .bmmplug (review each file
  // individually; the whole package is downloadable via /file). Files are never executed.
  app.get('/admin/catalog/:id/plugin-file', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item || item.kind !== 'PLUGIN') return reply.code(404).send({ error: 'not_found' });
    const path = String(req.query?.path || '');
    if (!path) return reply.code(400).send({ error: 'no_path' });
    const meta = item.meta || {};
    try {
      const buf = await fetchPluginBytes({ url: meta.download_url, key: item.payloadKey, getObject });
      const zip = new AdmZip(buf);
      const entry = zip.getEntry(path);
      if (!entry || entry.isDirectory) return reply.code(404).send({ error: 'file_not_found' });
      const name = (path.split('/').pop() || 'file').replace(/[^\w.\-]/g, '_');
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      reply.header('Cache-Control', 'no-store');
      return reply.send(entry.getData());
    } catch (e) { return reply.code(502).send({ error: 'fetch_failed', detail: String(e?.message || e) }); }
  });

  // ── Propose an UPDATE to your own item ──
  // Edits apply to the row immediately but flip the item back to PENDING and open an
  // UPDATE submission, so a moderator must re-approve before it is public again. When
  // a plugin's .bmmplug is our-hosted, a new payloadKey replaces the file and the
  // package is re-validated (checksums recomputed) so the change is re-verified first.
  app.post('/catalog/:id/update', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.ownerId !== req.user.uid && req.user.role === 'USER') return reply.code(403).send({ error: 'forbidden' });
    const patch = z.object({
      description: z.string().max(4000).optional(), version: z.string().max(24).optional(), tags: z.array(z.string()).optional(),
      payloadKey: z.string().optional(), payloadSize: z.number().int().positive().optional(), meta: z.record(z.any()).optional(),
    }).parse(req.body || {});
    // Presets must still satisfy the preset schema after an edit.
    if (item.kind === 'PRESET' && patch.meta) {
      const ok = presetSchema.safeParse(patch.meta);
      if (!ok.success) return reply.code(400).send({ error: 'invalid_preset', details: ok.error.flatten() });
    }

    // Re-uploading a payload is billed by size past the free tier, same as a brand
    // new submission — staff (mod/admin) re-uploads are always free. If it's not
    // free, the METADATA changes apply now, but the new FILE is held pending
    // payment (mirrors the create route's _hostingUnpaid pattern) so a user can't
    // swap in an arbitrarily large file for free by going through "edit" instead
    // of "submit".
    let hostCents = 0;
    if (patch.payloadKey && req.user.role === 'USER') {
      const s = await settings(p);
      hostCents = catalogHostCents(patch.payloadSize || 0, s);
    }
    const { payloadKey: newPayloadKey, payloadSize: newPayloadSize, ...rest } = patch;
    const data = { ...rest, status: 'PENDING' };
    if (newPayloadKey) {
      if (hostCents > 0) data.meta = { ...(rest.meta ?? item.meta), _pendingPayloadKey: newPayloadKey, _pendingPayloadSize: newPayloadSize || 0 };
      else { data.payloadKey = newPayloadKey; data.payloadSize = newPayloadSize || 0; }
    }
    const updated = await p.catalogItem.update({ where: { id: item.id }, data });

    if (hostCents > 0) {
      const sk = await stripe();
      if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
      const siteUrl = process.env.SITE_URL || 'http://localhost';
      const session = await sk.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: hostCents, recurring: { interval: 'month' }, product_data: { name: `Hosting update — "${item.name}" (${((newPayloadSize || 0) / 1e6).toFixed(1)} MB)` } } }],
        metadata: { type: 'catalog_hosting_update', itemId: item.id, userId: req.user.uid },
        success_url: `${siteUrl}/dashboard?hosting=ok`, cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
      });
      return { item: updated, checkoutUrl: session.url, hostingCents: hostCents };
    }

    const sub = await p.submission.create({ data: { itemId: item.id, ownerId: item.ownerId, type: 'UPDATE', status: 'PENDING' } });
    // Re-validate plugins against the (possibly new) file so moderators see fresh
    // integrity status before approving the update back to live.
    let validation;
    if (updated.kind === 'PLUGIN' && (updated.meta?.download_url || updated.payloadKey)) {
      const v = await revalidatePlugin(p, updated).catch(() => null);
      validation = v?.validation || (v ? { valid: v.valid, reason: v.reason, sha256: v.sha256 } : undefined);
    }
    return { submission: sub, validation };
  });

  // ── Owner: self-service cancellation of a recurring catalog-file-hosting
  // subscription (there is no Stripe customer portal wired up, so this is the
  // only way for a user to stop being billed monthly for our-hosted storage). ──
  app.post('/catalog/:id/hosting/cancel', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.ownerId !== req.user.uid) return reply.code(403).send({ error: 'owner_only' });
    const subId = item.meta?._hostingSubId;
    if (!subId) return reply.code(400).send({ error: 'no_active_subscription' });
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    await sk.subscriptions.cancel(subId).catch(() => {});
    const { _hostingSubId, _pendingPayloadKey, _pendingPayloadSize, ...m } = item.meta;
    await p.catalogItem.update({ where: { id: item.id }, data: { status: 'HIDDEN', meta: { ...m, _hostingUnpaid: true } } });
    return { ok: true };
  });

  // ── Owner: a short-lived pre-signed GET to review your own item's payload,
  // regardless of status (so you can download & inspect what you're editing). ──
  app.get('/me/items/:id/payload', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.ownerId !== req.user.uid && req.user.role === 'USER') return reply.code(403).send({ error: 'forbidden' });
    if (item.payloadKey) return { url: await presignGet(item.payloadKey) };
    if (item.meta?.download_url) return { url: item.meta.download_url };
    return reply.code(404).send({ error: 'no_payload' });
  });

  // ── My items ──
  app.get('/me/items', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    return { items: await p.catalogItem.findMany({ where: { ownerId: req.user.uid }, orderBy: { updatedAt: 'desc' } }) };
  });

  const GRACE_MS = 72 * 3600 * 1000; // 72h grace, in sync with the hosting-deletion policy

  // Schedule deletion: the item is unpublished now and hard-deleted (with its files)
  // after 72h. Cancellable any time before then — the files are kept until it fires.
  app.post('/catalog/:id/delete', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.ownerId !== req.user.uid && req.user.role === 'USER') return reply.code(403).send({ error: 'forbidden' });
    if (item.deleteAt) return { ok: true, deleteAt: item.deleteAt }; // already scheduled
    const deleteAt = new Date(Date.now() + GRACE_MS);
    await p.catalogItem.update({ where: { id: item.id }, data: {
      deleteAt, status: 'HIDDEN', meta: { ...(item.meta || {}), _prevStatus: item.status },
    } });
    return { ok: true, deleteAt };
  });

  // Cancel a scheduled deletion while the grace window is still open.
  app.post('/catalog/:id/delete/cancel', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findUnique({ where: { id: req.params.id } });
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (item.ownerId !== req.user.uid && req.user.role === 'USER') return reply.code(403).send({ error: 'forbidden' });
    if (!item.deleteAt) return { ok: true }; // nothing scheduled
    const meta = { ...(item.meta || {}) }; const prev = meta._prevStatus || 'PENDING'; delete meta._prevStatus;
    await p.catalogItem.update({ where: { id: item.id }, data: { deleteAt: null, status: prev, meta } });
    return { ok: true, status: prev };
  });

  // ── Moderation (MOD / ADMIN) ──
  // Search (item name / owner name+email), filter (kind, submission type, tag) and
  // sort (oldest/newest first — oldest first is the default so nothing goes stale).
  app.get('/mod/submissions', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const kind = String(req.query?.kind || '').trim();
    const type = String(req.query?.type || '').trim();
    const tag = String(req.query?.tag || '').trim();
    const sort = req.query?.sort === 'newest' ? 'desc' : 'asc';
    const where = { status: 'PENDING' };
    if (kind) where.item = { ...(where.item || {}), kind };
    if (type) where.type = type;
    if (tag) where.tags = { has: tag };
    if (q) where.OR = [
      { item: { name: { contains: q, mode: 'insensitive' } } },
      { item: { owner: { displayName: { contains: q, mode: 'insensitive' } } } },
      { item: { owner: { email: { contains: q, mode: 'insensitive' } } } },
    ];
    const submissions = await p.submission.findMany({
      where, orderBy: { createdAt: sort },
      include: {
        item: { include: { owner: { select: { displayName: true, email: true } }, project: { select: { key: true } } } },
        comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true } } } },
      },
    });
    return { submissions };
  });

  // Mod-only internal triage tags on a submission (e.g. "priority", "needs-rework")
  // — replaces the whole array each call, same pattern as other chip-list UIs.
  app.put('/mod/submissions/:id/tags', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const b = z.object({ tags: z.array(z.string().min(1).max(40)).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const out = await p.submission.update({ where: { id: req.params.id }, data: { tags: [...new Set(b.data.tags)] } }).catch(() => null);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, tags: out.tags };
  });

  // Mod-only internal note thread — never surfaced to the submitter.
  app.post('/mod/submissions/:id/comments', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const b = z.object({ body: z.string().min(1).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const sub = await p.submission.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!sub) return reply.code(404).send({ error: 'not_found' });
    const comment = await p.submissionComment.create({
      data: { submissionId: sub.id, authorId: req.user.uid, body: b.data.body },
      include: { author: { select: { displayName: true } } },
    });
    return { comment };
  });

  app.delete('/mod/submissions/:id/comments/:cid', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const c = await p.submissionComment.findUnique({ where: { id: req.params.cid } });
    if (!c || c.submissionId !== req.params.id) return reply.code(404).send({ error: 'not_found' });
    if (c.authorId !== req.user.uid && req.user.role !== 'ADMIN' && req.user.role !== 'SUPERADMIN') return reply.code(403).send({ error: 'forbidden' });
    await p.submissionComment.delete({ where: { id: c.id } });
    return { ok: true };
  });

  app.post('/mod/submissions/:id/approve', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const sub = await p.submission.findUnique({ where: { id: req.params.id }, include: { item: true } });
    if (!sub) return reply.code(404).send({ error: 'not_found' });
    await p.$transaction([
      p.submission.update({ where: { id: sub.id }, data: { status: 'PUBLISHED', reviewerId: req.user.uid } }),
      p.catalogItem.update({ where: { id: sub.itemId }, data: { status: 'PUBLISHED' } }),
    ]);
    await notify(p, sub.ownerId, 'submission_approved', `"${sub.item.name}" was approved and is now live.`);
    return { ok: true };
  });

  app.post('/mod/submissions/:id/reject', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const reason = z.object({ reason: z.string().min(1).max(500) }).safeParse(req.body);
    if (!reason.success) return reply.code(400).send({ error: 'reason_required' });
    const p = await db();
    const sub = await p.submission.findUnique({ where: { id: req.params.id }, include: { item: true } });
    if (!sub) return reply.code(404).send({ error: 'not_found' });
    await p.$transaction([
      p.submission.update({ where: { id: sub.id }, data: { status: 'REJECTED', reviewerId: req.user.uid, reason: reason.data.reason } }),
      p.catalogItem.update({ where: { id: sub.itemId }, data: { status: 'REJECTED' } }),
    ]);
    await notify(p, sub.ownerId, 'submission_rejected', `"${sub.item.name}" was rejected: ${reason.data.reason}`);
    return { ok: true };
  });
}
